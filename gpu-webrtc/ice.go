package main

// Servidores ICE (STUN/TURN) de cada par. El servidor Node es quien sabe si hay un
// TURN configurado y quien genera las credenciales temporales (caducan), así que las
// manda con cada oferta en la cabecera X-Nexo-Ice: el puente, que vive días, nunca
// guarda una credencial vencida. Sin cabecera se usa el STUN de siempre.

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pion/webrtc/v4"
)

const (
	cabeceraIce      = "X-Nexo-Ice"
	maxServidoresIce = 8
	maxURLsIce       = 16
)

var stunPorDefecto = []webrtc.ICEServer{{URLs: []string{"stun:stun.cloudflare.com:3478"}}}

// ajustarMotorICE permite a las pruebas limitar el motor de ICE a la interfaz de bucle local. En
// producción es nil. Sin esto, cada `go test` abre sockets UDP en todas las interfaces desde un
// ejecutable nuevo y Windows muestra el aviso del firewall (y crea una regla permanente) por cada uno.
var ajustarMotorICE func(*webrtc.SettingEngine)

func nuevaAPIParaProbar() *webrtc.API {
	var motor webrtc.SettingEngine
	if ajustarMotorICE != nil {
		ajustarMotorICE(&motor)
	}
	return webrtc.NewAPI(webrtc.WithSettingEngine(motor))
}

// servidorIce es el formato de RTCIceServer del navegador.
type servidorIce struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

func esURLIce(url string) bool {
	return strings.HasPrefix(url, "stun:") || strings.HasPrefix(url, "turn:") || strings.HasPrefix(url, "turns:")
}

// convertirIce valida y traduce la lista; devuelve nil si no queda ningún servidor válido.
func convertirIce(lista []servidorIce) []webrtc.ICEServer {
	var salida []webrtc.ICEServer
	urls := 0
	for _, s := range lista {
		if len(salida) >= maxServidoresIce {
			break
		}
		var validas []string
		for _, u := range s.URLs {
			u = strings.TrimSpace(u)
			if esURLIce(u) && urls < maxURLsIce {
				validas = append(validas, u)
				urls++
			}
		}
		if len(validas) == 0 {
			continue
		}
		servidor := webrtc.ICEServer{URLs: validas}
		if s.Username != "" {
			servidor.Username = s.Username
			servidor.Credential = s.Credential
			servidor.CredentialType = webrtc.ICECredentialTypePassword
		}
		salida = append(salida, servidor)
	}
	return salida
}

// servidoresIce lee X-Nexo-Ice (base64 estándar de un JSON con la lista). Cualquier
// problema —ausente, mal codificada, sin servidores válidos— cae al STUN por defecto:
// una cabecera rota no puede dejar a nadie sin vídeo.
func servidoresIce(r *http.Request) []webrtc.ICEServer {
	crudo := strings.TrimSpace(r.Header.Get(cabeceraIce))
	if crudo == "" {
		return stunPorDefecto
	}
	datos, err := base64.StdEncoding.DecodeString(crudo)
	if err != nil || len(datos) > 16*1024 {
		return stunPorDefecto
	}
	var lista []servidorIce
	if json.Unmarshal(datos, &lista) != nil {
		return stunPorDefecto
	}
	if servidores := convertirIce(lista); len(servidores) > 0 {
		return servidores
	}
	return stunPorDefecto
}

// resumenCandidatos cuenta los candidatos de un SDP por tipo (host, srflx, relay).
func resumenCandidatos(sdp string) map[string]int {
	cuentas := map[string]int{"host": 0, "srflx": 0, "relay": 0}
	for _, linea := range strings.Split(sdp, "\n") {
		if !strings.HasPrefix(linea, "a=candidate:") {
			continue
		}
		campos := strings.Fields(linea)
		for i := 0; i+1 < len(campos); i++ {
			if campos[i] == "typ" {
				cuentas[campos[i+1]]++
				break
			}
		}
	}
	return cuentas
}

// probarIce abre un par de prueba con los servidores recibidos y dice qué candidatos
// consiguió: «relay» > 0 significa que el TURN acepta las credenciales y ofrece ruta.
// No toca el vídeo ni los pares reales.
func (b *bridge) probarIce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var cuerpo struct {
		IceServers []servidorIce `json:"iceServers"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&cuerpo) != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}
	servidores := convertirIce(cuerpo.IceServers)
	if len(servidores) == 0 {
		http.Error(w, "sin servidores ICE válidos", http.StatusBadRequest)
		return
	}
	inicio := time.Now()
	pc, err := nuevaAPIParaProbar().NewPeerConnection(webrtc.Configuration{ICEServers: servidores})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer pc.Close()
	if _, err = pc.CreateDataChannel("prueba-ice", nil); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	oferta, err := pc.CreateOffer(nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	reunidos := webrtc.GatheringCompletePromise(pc)
	if err = pc.SetLocalDescription(oferta); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	select {
	case <-reunidos:
	case <-time.After(8 * time.Second):
	}
	cuentas := resumenCandidatos(pc.LocalDescription().SDP)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    true,
		"host":  cuentas["host"],
		"srflx": cuentas["srflx"],
		"relay": cuentas["relay"],
		"ms":    time.Since(inicio).Milliseconds(),
	})
}

package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/pion/ice/v4"
	"github.com/pion/turn/v4"
	"github.com/pion/webrtc/v4"
)

// Las pruebas sólo usan la interfaz de bucle local: así no abren sockets en la red real ni
// disparan el aviso del firewall de Windows (que además dejaría una regla permanente por ejecutable).
func TestMain(m *testing.M) {
	ajustarMotorICE = func(motor *webrtc.SettingEngine) {
		motor.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		motor.SetIncludeLoopbackCandidate(true)
		motor.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
		motor.SetInterfaceFilter(func(nombre string) bool {
			minusculas := strings.ToLower(nombre)
			return nombre == "lo" || strings.Contains(minusculas, "loopback")
		})
	}
	os.Exit(m.Run())
}

func conCabecera(valor string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/offer", nil)
	if valor != "" {
		r.Header.Set(cabeceraIce, valor)
	}
	return r
}

func codificar(t *testing.T, lista []servidorIce) string {
	t.Helper()
	datos, err := json.Marshal(lista)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(datos)
}

func TestServidoresIceSinCabeceraUsaStun(t *testing.T) {
	got := servidoresIce(conCabecera(""))
	if len(got) != 1 || got[0].URLs[0] != "stun:stun.cloudflare.com:3478" {
		t.Fatalf("esperaba el STUN por defecto, obtuve %+v", got)
	}
}

func TestServidoresIceLeeTurnConCredenciales(t *testing.T) {
	cab := codificar(t, []servidorIce{
		{URLs: []string{"stun:stun.ejemplo.net:3478"}},
		{URLs: []string{"turn:turn.ejemplo.net:3478?transport=udp", "turns:turn.ejemplo.net:443?transport=tcp", "http://no-es-ice"}, Username: "u", Credential: "c"},
	})
	got := servidoresIce(conCabecera(cab))
	if len(got) != 2 {
		t.Fatalf("esperaba 2 servidores, obtuve %d: %+v", len(got), got)
	}
	if len(got[1].URLs) != 2 || got[1].Username != "u" || got[1].Credential != "c" {
		t.Fatalf("el TURN no conserva URLs válidas y credenciales: %+v", got[1])
	}
	if got[0].Username != "" {
		t.Fatalf("el STUN no debe llevar usuario: %+v", got[0])
	}
}

func TestServidoresIceCabeceraRotaCaeAlStun(t *testing.T) {
	for nombre, cab := range map[string]string{
		"base64 inválido":  "%%%no-es-base64%%%",
		"json inválido":    base64.StdEncoding.EncodeToString([]byte("{")),
		"sin urls válidas": codificar(t, []servidorIce{{URLs: []string{"ftp://x"}}}),
		"lista vacía":      codificar(t, nil),
	} {
		got := servidoresIce(conCabecera(cab))
		if len(got) != 1 || got[0].URLs[0] != "stun:stun.cloudflare.com:3478" {
			t.Errorf("%s: esperaba el STUN por defecto, obtuve %+v", nombre, got)
		}
	}
}

func TestConvertirIceLimitaLaCantidad(t *testing.T) {
	var lista []servidorIce
	for i := 0; i < 30; i++ {
		lista = append(lista, servidorIce{URLs: []string{fmt.Sprintf("stun:s%d.ejemplo.net:3478", i)}})
	}
	if got := convertirIce(lista); len(got) != maxServidoresIce {
		t.Fatalf("esperaba %d servidores como máximo, obtuve %d", maxServidoresIce, len(got))
	}
}

func TestResumenCandidatos(t *testing.T) {
	sdp := strings.Join([]string{
		"v=0",
		"a=candidate:1 1 udp 2130706431 192.168.1.5 50000 typ host",
		"a=candidate:2 1 udp 1694498815 203.0.113.9 50000 typ srflx raddr 0.0.0.0 rport 0",
		"a=candidate:3 1 udp 16777215 198.51.100.7 61000 typ relay raddr 0.0.0.0 rport 0",
		"a=candidate:4 1 udp 16777214 198.51.100.7 61001 typ relay raddr 0.0.0.0 rport 0",
		"a=end-of-candidates",
	}, "\n")
	got := resumenCandidatos(sdp)
	if got["host"] != 1 || got["srflx"] != 1 || got["relay"] != 2 {
		t.Fatalf("cuentas inesperadas: %v", got)
	}
}

// Un TURN de verdad (el de Pion, en 127.0.0.1) para comprobar de punta a punta que el
// puente consigue un candidato «relay» con credenciales buenas y ninguno con malas.
func iniciarTurnLocal(t *testing.T, usuario, clave string) int {
	t.Helper()
	udp, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	servidor, err := turn.NewServer(turn.ServerConfig{
		Realm: "nexo-prueba",
		AuthHandler: func(u, realm string, _ net.Addr) ([]byte, bool) {
			if u != usuario {
				return nil, false
			}
			return turn.GenerateAuthKey(u, realm, clave), true
		},
		PacketConnConfigs: []turn.PacketConnConfig{{
			PacketConn: udp,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
				RelayAddress: net.ParseIP("127.0.0.1"),
				Address:      "127.0.0.1",
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = servidor.Close() })
	return udp.LocalAddr().(*net.UDPAddr).Port
}

func probar(t *testing.T, puerto int, usuario, clave string) map[string]any {
	t.Helper()
	cuerpo, _ := json.Marshal(map[string]any{"iceServers": []servidorIce{{
		URLs:       []string{fmt.Sprintf("turn:127.0.0.1:%d?transport=udp", puerto)},
		Username:   usuario,
		Credential: clave,
	}}})
	r := httptest.NewRequest(http.MethodPost, "/ice-test", strings.NewReader(string(cuerpo)))
	w := httptest.NewRecorder()
	(&bridge{}).probarIce(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("estado %d: %s", w.Code, w.Body.String())
	}
	var salida map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &salida); err != nil {
		t.Fatal(err)
	}
	return salida
}

func TestProbarIceConsigueRelayConCredencialesBuenas(t *testing.T) {
	puerto := iniciarTurnLocal(t, "nexo", "secreto")
	got := probar(t, puerto, "nexo", "secreto")
	if relay, _ := got["relay"].(float64); relay < 1 {
		t.Fatalf("esperaba al menos un candidato relay, obtuve %v", got)
	}
}

func TestProbarIceNoConsigueRelayConCredencialesMalas(t *testing.T) {
	puerto := iniciarTurnLocal(t, "nexo", "secreto")
	got := probar(t, puerto, "nexo", "otra-clave")
	if relay, _ := got["relay"].(float64); relay != 0 {
		t.Fatalf("con credenciales malas no debe haber relay, obtuve %v", got)
	}
}

func TestProbarIceRechazaCuerposInvalidos(t *testing.T) {
	for _, cuerpo := range []string{"no es json", `{"iceServers":[]}`, `{"iceServers":[{"urls":["http://x"]}]}`} {
		r := httptest.NewRequest(http.MethodPost, "/ice-test", strings.NewReader(cuerpo))
		w := httptest.NewRecorder()
		(&bridge{}).probarIce(w, r)
		if w.Code != http.StatusBadRequest {
			t.Errorf("cuerpo %q: esperaba 400, obtuve %d", cuerpo, w.Code)
		}
	}
	w := httptest.NewRecorder()
	(&bridge{}).probarIce(w, httptest.NewRequest(http.MethodGet, "/ice-test", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET: esperaba 405, obtuve %d", w.Code)
	}
}

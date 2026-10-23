package main

// Servidor web del panel de NEXO. La interfaz (panel/) va embebida en el
// ejecutable; aquí sólo hay red, autenticación y rutas. Lo que de verdad hace
// cada acción (arrancar, detener, tocar el autoarranque…) lo implementa
// Operaciones, así este archivo se prueba sin abrir nada en el sistema.
// El contrato completo está en panel/CONTRATO.md.

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

// Todo lo que sirve el panel va aquí dentro y nada más: la lista de lo que se puede pedir sale de
// recorrer este sistema de archivos (ver recursosPanel), no de la ruta que llegue en la petición.
// panel/fuentes y panel/img son copias de assets/ (las genera scripts/ui/sync-recursos-panel.js).
//
//go:embed panel/index.html panel/panel.css panel/panel.js panel/tema-inicial.js panel/temas panel/fuentes panel/img
var archivosPanel embed.FS

const (
	nombreCookiePanel = "nexo_panel"
	cabeceraPanel     = "X-NEXO-Panel"
	maxCuerpoPanel    = 64 * 1024
)

// Autoarranque describe la tarea programada «NEXO».
type Autoarranque struct {
	Instalado bool `json:"instalado"`
	Activo    bool `json:"activo"`
}

// Enlaces son los dos accesos completos (con el token); vacío si no existen aún.
type Enlaces struct {
	Internet string `json:"internet"`
	Local    string `json:"local"`
	// LocalSeguro es el enlace HTTPS de la LAN; vacío si esa función está apagada o no arrancó.
	LocalSeguro string `json:"localSeguro"`
}

// EstadoPanel es la respuesta de GET /api/estado.
type EstadoPanel struct {
	Estado            string       `json:"estado"` // activo | conectando | detenido
	TextoEstado       string       `json:"textoEstado"`
	Modo              string       `json:"modo"`
	Enlaces           Enlaces      `json:"enlaces"`
	Autoarranque      Autoarranque `json:"autoarranque"`
	Elevado           bool         `json:"elevado"`
	Ajustes           Ajustes      `json:"ajustes"`
	AjustesPendientes bool         `json:"ajustesPendientes"`
	Ocupado           string       `json:"ocupado"`
	Version           string       `json:"version"`
}

// AvisoPanel es la respuesta de GET /api/aviso (nunca lleva el token de Telegram).
type AvisoPanel struct {
	Metodo             string `json:"metodo"`
	NtfyServidor       string `json:"ntfyServidor"`
	NtfyTema           string `json:"ntfyTema"`
	TelegramChat       string `json:"telegramChat"`
	TieneTelegramToken bool   `json:"tieneTelegramToken"`
}

// TurnPanel es la configuración del TURN SIN secretos (GET /api/turn): del token de Cloudflare y de
// la contraseña del TURN manual sólo se dice si existen.
type TurnPanel struct {
	Proveedor       string   `json:"proveedor"` // ninguno | cloudflare | manual
	CloudflareKeyID string   `json:"cloudflareKeyId"`
	TieneAPIToken   bool     `json:"tieneApiToken"`
	ManualURLs      []string `json:"manualUrls"`
	ManualUsuario   string   `json:"manualUsuario"`
	TieneCredencial bool     `json:"tieneCredencial"`
}

// TurnEntrada es lo que manda el panel al guardar. Un secreto vacío conserva el guardado.
type TurnEntrada struct {
	Proveedor  string `json:"proveedor"`
	Cloudflare struct {
		KeyID    string `json:"keyId"`
		APIToken string `json:"apiToken"`
	} `json:"cloudflare"`
	Manual struct {
		URLs       []string `json:"urls"`
		Usuario    string   `json:"usuario"`
		Credencial string   `json:"credencial"`
	} `json:"manual"`
	OlvidarSecretos bool `json:"olvidarSecretos"`
}

// PerfilRed es una red conectada y su categoría de Windows (Public | Private | DomainAuthenticated).
type PerfilRed struct {
	Nombre    string `json:"nombre"`
	Interfaz  string `json:"interfaz"`
	Categoria string `json:"categoria"`
}

// ReglaPublica es una regla de firewall que Windows creó para NEXO y que vale en redes públicas.
type ReglaPublica struct {
	Nombre    string `json:"nombre"`
	Programa  string `json:"programa"`
	Protocolo string `json:"protocolo"`
}

// RedPanel resume la red y el firewall (GET /api/red). Consultar el firewall tarda unos segundos:
// la interfaz lo pide al abrir la sección, no en el sondeo de /api/estado.
type RedPanel struct {
	Comprobado     bool           `json:"comprobado"` // false = no se pudo consultar (ver Error)
	Error          string         `json:"error,omitempty"`
	Perfiles       []PerfilRed    `json:"perfiles"`
	TodasPublicas  bool           `json:"todasPublicas"` // ninguna red conectada es Privada ni de Dominio
	ReglasPublicas []ReglaPublica `json:"reglasPublicas"`
	ReglasNexo     int            `json:"reglasNexo"` // reglas «NEXO …» (sólo perfil Privado)
	ReglaHTTPS     bool           `json:"reglaHttps"` // existe la regla del puerto HTTPS de la LAN
	PuertoHTTPS    int            `json:"puertoHttps"`
	Elevado        bool           `json:"elevado"`
}

// Operaciones es lo que el panel puede pedirle a NEXO. Los errores devueltos
// se muestran tal cual al usuario: deben estar en español y ser comprensibles.
type Operaciones interface {
	Estado() EstadoPanel
	LeerApariencia() Apariencia
	GuardarApariencia(a Apariencia) (Apariencia, error)
	LeerDispositivos() []DispositivoPanel
	Iniciar()
	Detener()
	Reiniciar()
	SetAutoarranque(activo bool) (Autoarranque, error)
	GuardarAjustes(a Ajustes) (Ajustes, error)
	Emparejar(minutos int) (codigo, texto string, err error)
	Rotar() (string, error)
	CambiarContrasena(usuario, contrasena string) (string, error)
	LeerAviso() AvisoPanel
	GuardarAviso(a Aviso, conservarToken bool) error
	ProbarAviso() (string, error)
	LeerTurn() (TurnPanel, error)
	GuardarTurn(t TurnEntrada) (TurnPanel, error)
	ProbarTurn() (string, error)
	Red() (RedPanel, error)
	MarcarRedPrivada() (RedPanel, error)
	CerrarReglasPublicas(forzar bool) (RedPanel, string, error)
	AbrirPuertoHTTPS() (RedPanel, error)
	Doctor() (string, error)
	Registro() string
	AbrirRegistros() error
	QR(que string) ([]byte, error) // nil, nil = no hay enlace
	Salir(detener bool)
}

// Panel es el servidor HTTP local.
type Panel struct {
	ops    Operaciones
	clave  string
	puerto int
	srv    *http.Server
}

func nuevoPanel(ops Operaciones, clave string) *Panel {
	return &Panel{ops: ops, clave: clave}
}

// Escuchar abre 127.0.0.1:<puerto libre> y sirve en segundo plano.
func (p *Panel) Escuchar() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	p.puerto = l.Addr().(*net.TCPAddr).Port
	p.srv = &http.Server{
		Handler:           p.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
	}
	go func() { _ = p.srv.Serve(l) }()
	return p.puerto, nil
}

func (p *Panel) Cerrar() {
	if p.srv != nil {
		_ = p.srv.Close()
	}
}

// URLInicial es la dirección con la que se abre la ventana (canjea la clave por la cookie).
func (p *Panel) URLInicial() string {
	return "http://127.0.0.1:" + strconv.Itoa(p.puerto) + "/?k=" + p.clave
}

func (p *Panel) hostPermitido(host string) bool {
	puerto := strconv.Itoa(p.puerto)
	return host == "127.0.0.1:"+puerto || host == "localhost:"+puerto
}

func (p *Panel) origenPermitido(origen string) bool {
	puerto := strconv.Itoa(p.puerto)
	return origen == "http://127.0.0.1:"+puerto || origen == "http://localhost:"+puerto
}

func (p *Panel) claveValida(valor string) bool {
	return valor != "" && subtle.ConstantTimeCompare([]byte(valor), []byte(p.clave)) == 1
}

func (p *Panel) autenticado(r *http.Request) bool {
	c, err := r.Cookie(nombreCookiePanel)
	return err == nil && p.claveValida(c.Value)
}

func cabecerasSeguras(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
}

func escribirJSON(w http.ResponseWriter, estado int, valor any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	_ = json.NewEncoder(w).Encode(valor)
}

func respuestaError(w http.ResponseWriter, err error) {
	escribirJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
}

func respuestaOK(w http.ResponseWriter, extra map[string]any) {
	if extra == nil {
		extra = map[string]any{}
	}
	extra["ok"] = true
	escribirJSON(w, http.StatusOK, extra)
}

// leerCuerpo decodifica un JSON pequeño; un cuerpo vacío equivale a {}.
func leerCuerpo(r *http.Request, destino any) error {
	datos, err := io.ReadAll(io.LimitReader(r.Body, maxCuerpoPanel+1))
	if err != nil {
		return err
	}
	if len(datos) > maxCuerpoPanel {
		return errors.New("La petición es demasiado grande.")
	}
	if strings.TrimSpace(string(datos)) == "" {
		return nil
	}
	if err := json.Unmarshal(datos, destino); err != nil {
		return errors.New("La petición no es un JSON válido.")
	}
	return nil
}

// Handler devuelve el enrutador completo (también lo usan las pruebas).
func (p *Panel) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", p.paginaEstatica)
	mux.HandleFunc("/api/", p.api)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cabecerasSeguras(w)
		// Sin esto, una página web cualquiera podría hablar con el panel a través de
		// un nombre DNS que apunte a 127.0.0.1 (DNS rebinding).
		if !p.hostPermitido(r.Host) {
			http.Error(w, "Host no permitido", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (p *Panel) noAutorizado(w http.ResponseWriter, api bool) {
	if api {
		escribirJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Sesión del panel caducada: ciérralo y ábrelo desde el icono de NEXO."})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = io.WriteString(w, "<!doctype html><meta charset=utf-8><title>NEXO</title><body style=\"font-family:system-ui;padding:2rem\"><h1>NEXO</h1><p>Abre el panel desde el icono de NEXO en la bandeja del sistema.</p>")
}

func (p *Panel) paginaEstatica(w http.ResponseWriter, r *http.Request) {
	// Canje de la clave de la URL por la cookie de sesión; luego se limpia la URL.
	if k := r.URL.Query().Get("k"); k != "" && r.URL.Path == "/" {
		if !p.claveValida(k) {
			p.noAutorizado(w, false)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: nombreCookiePanel, Value: p.clave, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	if !p.autenticado(r) {
		p.noAutorizado(w, false)
		return
	}
	rutaURL := r.URL.Path
	if rutaURL == "/" {
		rutaURL = "/index.html"
	}
	rec, ok := recursosPanel[rutaURL]
	if !ok {
		http.NotFound(w, r)
		return
	}
	datos, err := archivosPanel.ReadFile(rec.archivo)
	if err != nil {
		http.Error(w, "recurso no encontrado", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", rec.tipo)
	if rutaURL == "/index.html" {
		datos = p.conAparienciaInicial(datos)
	}
	if rec.etag != "" {
		// Fuentes e imágenes pesan y casi nunca cambian: se revalidan con ETag (la respuesta es un 304
		// de unos pocos bytes) en vez de bajarse enteras en cada apertura del panel.
		w.Header().Set("ETag", rec.etag)
		w.Header().Set("Cache-Control", "private, no-cache")
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(datos))
		return
	}
	_, _ = w.Write(datos)
}

// conAparienciaInicial escribe en <html> el tema y la preferencia de modo elegidos. Así la página
// llega ya vestida con la apariencia correcta y tema-inicial.js sólo tiene que resolver «automático»
// antes del primer pintado: sin destello del tema equivocado. Los valores salen de listas cerradas.
func (p *Panel) conAparienciaInicial(html []byte) []byte {
	a := p.ops.LeerApariencia()
	if !temaValido(a.Tema) {
		a.Tema = aparienciaPorDefecto.Tema
	}
	if !modoAparienciaValido(a.Modo) {
		a.Modo = aparienciaPorDefecto.Modo
	}
	marca := []byte(`<html lang="es">`)
	nueva := []byte(fmt.Sprintf(`<html lang="es" data-tema="%s" data-pref="%s">`, a.Tema, a.Modo))
	return bytes.Replace(html, marca, nueva, 1)
}

// recursoPanel es un archivo embebido que el panel sabe servir.
type recursoPanel struct {
	archivo string // ruta dentro de archivosPanel
	tipo    string // Content-Type
	etag    string // vacío = sin caché (HTML, CSS y JS del panel); con valor = se revalida
}

var tiposRecurso = map[string]string{
	".html":  "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".woff2": "font/woff2",
	".svg":   "image/svg+xml",
	".webp":  "image/webp",
	".png":   "image/png",
}

// recursosPanel: URL → archivo embebido. Se arma una sola vez recorriendo el sistema de archivos
// embebido; una ruta que no esté aquí da 404 (no hay forma de pedir nada fuera de lo embebido).
var recursosPanel = construirRecursosPanel()

func construirRecursosPanel() map[string]recursoPanel {
	m := map[string]recursoPanel{}
	_ = fs.WalkDir(archivosPanel, "panel", func(archivo string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		ext := strings.ToLower(path.Ext(archivo))
		tipo, ok := tiposRecurso[ext]
		if !ok {
			return nil
		}
		rec := recursoPanel{archivo: archivo, tipo: tipo}
		if ext != ".html" && ext != ".css" && ext != ".js" {
			if datos, err := archivosPanel.ReadFile(archivo); err == nil {
				suma := sha256.Sum256(datos)
				rec.etag = `"` + hex.EncodeToString(suma[:8]) + `"`
			}
		}
		m["/"+strings.TrimPrefix(archivo, "panel/")] = rec
		return nil
	})
	return m
}

func (p *Panel) api(w http.ResponseWriter, r *http.Request) {
	if !p.autenticado(r) {
		p.noAutorizado(w, true)
		return
	}
	if r.Method == http.MethodPost {
		if r.Header.Get(cabeceraPanel) != "1" {
			http.Error(w, "falta la cabecera "+cabeceraPanel, http.StatusForbidden)
			return
		}
		if origen := r.Header.Get("Origin"); origen != "" && !p.origenPermitido(origen) {
			http.Error(w, "origen no permitido", http.StatusForbidden)
			return
		}
		if tipo := r.Header.Get("Content-Type"); tipo != "" && !strings.HasPrefix(tipo, "application/json") {
			http.Error(w, "se esperaba application/json", http.StatusUnsupportedMediaType)
			return
		}
	}
	ruta := strings.TrimPrefix(r.URL.Path, "/api/")
	metodo := r.Method
	switch {
	case metodo == http.MethodGet && ruta == "estado":
		escribirJSON(w, http.StatusOK, p.ops.Estado())
	case metodo == http.MethodGet && ruta == "apariencia":
		respuestaOK(w, map[string]any{"apariencia": p.ops.LeerApariencia()})
	case metodo == http.MethodPost && ruta == "apariencia":
		// Los campos que no lleguen conservan su valor actual: la interfaz puede mandar sólo lo que cambió.
		var cuerpo struct {
			Tema           *string `json:"tema"`
			Modo           *string `json:"modo"`
			PorDispositivo *bool   `json:"porDispositivo"`
		}
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		nueva := p.ops.LeerApariencia()
		if cuerpo.Tema != nil {
			nueva.Tema = *cuerpo.Tema
		}
		if cuerpo.Modo != nil {
			nueva.Modo = *cuerpo.Modo
		}
		if cuerpo.PorDispositivo != nil {
			nueva.PorDispositivo = *cuerpo.PorDispositivo
		}
		guardada, err := p.ops.GuardarApariencia(nueva)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"apariencia": guardada})
	case metodo == http.MethodGet && ruta == "dispositivos":
		respuestaOK(w, map[string]any{"dispositivos": p.ops.LeerDispositivos()})
	case metodo == http.MethodPost && ruta == "iniciar":
		p.ops.Iniciar()
		respuestaOK(w, nil)
	case metodo == http.MethodPost && ruta == "detener":
		p.ops.Detener()
		respuestaOK(w, nil)
	case metodo == http.MethodPost && ruta == "reiniciar":
		p.ops.Reiniciar()
		respuestaOK(w, nil)
	case metodo == http.MethodPost && ruta == "autoarranque":
		var cuerpo struct {
			Activo bool `json:"activo"`
		}
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		estado, err := p.ops.SetAutoarranque(cuerpo.Activo)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"autoarranque": estado})
	case metodo == http.MethodPost && ruta == "ajustes":
		var cuerpo Ajustes
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		guardados, err := p.ops.GuardarAjustes(cuerpo)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"ajustes": guardados, "requiereReinicio": true})
	case metodo == http.MethodPost && ruta == "emparejar":
		var cuerpo struct {
			Minutos int `json:"minutos"`
		}
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		if cuerpo.Minutos <= 0 {
			cuerpo.Minutos = 10
		}
		if cuerpo.Minutos > 24*60 {
			respuestaError(w, errors.New("El código puede durar como máximo 24 horas."))
			return
		}
		codigo, texto, err := p.ops.Emparejar(cuerpo.Minutos)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"codigo": codigo, "texto": texto})
	case metodo == http.MethodPost && ruta == "rotar":
		mensaje, err := p.ops.Rotar()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"mensaje": mensaje})
	case metodo == http.MethodPost && ruta == "contrasena":
		var cuerpo struct {
			Usuario    string `json:"usuario"`
			Contrasena string `json:"contrasena"`
		}
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		mensaje, err := p.ops.CambiarContrasena(cuerpo.Usuario, cuerpo.Contrasena)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"mensaje": mensaje})
	case metodo == http.MethodGet && ruta == "aviso":
		escribirJSON(w, http.StatusOK, p.ops.LeerAviso())
	case metodo == http.MethodPost && ruta == "aviso":
		var cuerpo struct {
			Metodo        string `json:"metodo"`
			NtfyServidor  string `json:"ntfyServidor"`
			NtfyTema      string `json:"ntfyTema"`
			TelegramToken string `json:"telegramToken"`
			TelegramChat  string `json:"telegramChat"`
		}
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		aviso := Aviso{Metodo: cuerpo.Metodo, NtfyServidor: strings.TrimSpace(cuerpo.NtfyServidor), NtfyTema: strings.TrimSpace(cuerpo.NtfyTema),
			TelegramToken: strings.TrimSpace(cuerpo.TelegramToken), TelegramChat: strings.TrimSpace(cuerpo.TelegramChat)}
		if err := p.ops.GuardarAviso(aviso, true); err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, nil)
	case metodo == http.MethodPost && ruta == "aviso/prueba":
		texto, err := p.ops.ProbarAviso()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"texto": texto})
	case metodo == http.MethodGet && ruta == "turn":
		turn, err := p.ops.LeerTurn()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"turn": turn})
	case metodo == http.MethodPost && ruta == "turn":
		var cuerpo TurnEntrada
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		turn, err := p.ops.GuardarTurn(cuerpo)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"turn": turn})
	case metodo == http.MethodPost && ruta == "turn/prueba":
		texto, err := p.ops.ProbarTurn()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"texto": texto})
	case metodo == http.MethodGet && ruta == "red":
		red, err := p.ops.Red()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"red": red})
	case metodo == http.MethodPost && ruta == "red/privada":
		red, err := p.ops.MarcarRedPrivada()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"red": red})
	case metodo == http.MethodPost && ruta == "red/cerrar-publicas":
		var cuerpo struct {
			Forzar bool `json:"forzar"`
		}
		if err := leerCuerpo(r, &cuerpo); err != nil {
			respuestaError(w, err)
			return
		}
		red, mensaje, err := p.ops.CerrarReglasPublicas(cuerpo.Forzar)
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"red": red, "mensaje": mensaje})
	case metodo == http.MethodPost && ruta == "red/regla-https":
		red, err := p.ops.AbrirPuertoHTTPS()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"red": red})
	case metodo == http.MethodGet && ruta == "doctor":
		texto, err := p.ops.Doctor()
		if err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, map[string]any{"texto": texto})
	case metodo == http.MethodGet && ruta == "registro":
		escribirJSON(w, http.StatusOK, map[string]any{"texto": p.ops.Registro()})
	case metodo == http.MethodPost && ruta == "abrir-registros":
		if err := p.ops.AbrirRegistros(); err != nil {
			respuestaError(w, err)
			return
		}
		respuestaOK(w, nil)
	case metodo == http.MethodGet && ruta == "qr":
		que := r.URL.Query().Get("que")
		if que != "internet" && que != "local" && que != "localSeguro" {
			http.NotFound(w, r)
			return
		}
		png, err := p.ops.QR(que)
		if err != nil || png == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png)
	case metodo == http.MethodPost && ruta == "salir":
		var cuerpo struct {
			Detener bool `json:"detener"`
		}
		_ = leerCuerpo(r, &cuerpo)
		respuestaOK(w, nil)
		go p.ops.Salir(cuerpo.Detener)
	default:
		http.NotFound(w, r)
	}
}

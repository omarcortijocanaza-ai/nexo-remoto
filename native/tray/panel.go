package main

// Servidor web del panel de NEXO. La interfaz (panel/) va embebida en el
// ejecutable; aquí sólo hay red, autenticación y rutas. Lo que de verdad hace
// cada acción (arrancar, detener, tocar el autoarranque…) lo implementa
// Operaciones, así este archivo se prueba sin abrir nada en el sistema.
// El contrato completo está en panel/CONTRATO.md.

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:embed panel/index.html panel/panel.css panel/panel.js
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

// Operaciones es lo que el panel puede pedirle a NEXO. Los errores devueltos
// se muestran tal cual al usuario: deben estar en español y ser comprensibles.
type Operaciones interface {
	Estado() EstadoPanel
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
	nombre, tipo := "", ""
	switch r.URL.Path {
	case "/", "/index.html":
		nombre, tipo = "panel/index.html", "text/html; charset=utf-8"
	case "/panel.css":
		nombre, tipo = "panel/panel.css", "text/css; charset=utf-8"
	case "/panel.js":
		nombre, tipo = "panel/panel.js", "text/javascript; charset=utf-8"
	default:
		http.NotFound(w, r)
		return
	}
	datos, err := archivosPanel.ReadFile(nombre)
	if err != nil {
		http.Error(w, "recurso no encontrado", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", tipo)
	_, _ = w.Write(datos)
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
		if que != "internet" && que != "local" {
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

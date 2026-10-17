package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// falsas: registra lo que el panel pide sin tocar el sistema.
type falsas struct {
	llamadas []string
	fallo    error
}

func (f *falsas) anotar(s string) { f.llamadas = append(f.llamadas, s) }
func (f *falsas) Estado() EstadoPanel {
	return EstadoPanel{Estado: "activo", TextoEstado: "NEXO · activo", Modo: "both", Enlaces: Enlaces{Internet: "https://x.trycloudflare.com/?token=abc", Local: "http://192.168.1.2:8765/?token=abc"}, Autoarranque: Autoarranque{Instalado: true, Activo: true}, Elevado: true, Ajustes: ajustesPorDefecto, Version: "1.0"}
}
func (f *falsas) Iniciar()   { f.anotar("iniciar") }
func (f *falsas) Detener()   { f.anotar("detener") }
func (f *falsas) Reiniciar() { f.anotar("reiniciar") }
func (f *falsas) SetAutoarranque(activo bool) (Autoarranque, error) {
	f.anotar("autoarranque")
	return Autoarranque{Instalado: true, Activo: activo}, f.fallo
}
func (f *falsas) GuardarAjustes(a Ajustes) (Ajustes, error) {
	f.anotar("ajustes:" + a.Modo)
	return a, f.fallo
}
func (f *falsas) Emparejar(m int) (string, string, error) {
	f.anotar("emparejar")
	return "ABCD-EFGH", "Código de emparejamiento: ABCD-EFGH", nil
}
func (f *falsas) Rotar() (string, error) { f.anotar("rotar"); return "ok", nil }
func (f *falsas) CambiarContrasena(u, c string) (string, error) {
	f.anotar("contrasena:" + u)
	return "ok", f.fallo
}
func (f *falsas) LeerAviso() AvisoPanel { return AvisoPanel{Metodo: "ntfy", TieneTelegramToken: true} }
func (f *falsas) GuardarAviso(a Aviso, conservar bool) error {
	f.anotar("aviso:" + a.Metodo)
	return f.fallo
}
func (f *falsas) ProbarAviso() (string, error)  { return "Aviso de prueba enviado.", nil }
func (f *falsas) Doctor() (string, error)       { return "todo bien", nil }
func (f *falsas) Registro() string              { return "línea 1\nlínea 2" }
func (f *falsas) AbrirRegistros() error         { f.anotar("abrir-registros"); return nil }
func (f *falsas) QR(que string) ([]byte, error) { return []byte("\x89PNG-falso-" + que), nil }
func (f *falsas) Salir(detener bool)            { f.anotar("salir") }

const claveDePrueba = "clave-de-prueba-0123456789"

func servidorDePrueba(t *testing.T) (*Panel, *falsas, *httptest.Server) {
	t.Helper()
	f := &falsas{}
	p := nuevoPanel(f, claveDePrueba)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { p.Handler().ServeHTTP(w, r) }))
	t.Cleanup(srv.Close)
	// El Host válido depende del puerto real del servidor de prueba.
	p.puerto = puertoDe(t, srv.URL)
	return p, f, srv
}

func puertoDe(t *testing.T, url string) int {
	t.Helper()
	var puerto int
	for _, c := range url[strings.LastIndex(url, ":")+1:] {
		puerto = puerto*10 + int(c-'0')
	}
	return puerto
}

// cliente que NO sigue redirecciones y guarda cookies a mano.
func nuevaPeticion(t *testing.T, srv *httptest.Server, metodo, ruta, cuerpo string, cookie bool, cabeceras map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(metodo, srv.URL+ruta, strings.NewReader(cuerpo))
	if cookie {
		req.AddCookie(&http.Cookie{Name: nombreCookiePanel, Value: claveDePrueba})
	}
	for k, v := range cabeceras {
		if k == "Host" {
			req.Host = v // net/http ignora la cabecera Host puesta a mano
			continue
		}
		req.Header.Set(k, v)
	}
	cli := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := cli.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

var postJSON = map[string]string{cabeceraPanel: "1", "Content-Type": "application/json"}

func TestPanelCanjeaLaClaveYRedirige(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	r := nuevaPeticion(t, srv, "GET", "/?k="+claveDePrueba, "", false, nil)
	if r.StatusCode != http.StatusFound || r.Header.Get("Location") != "/" {
		t.Fatalf("esperaba 302 a /, hubo %d %q", r.StatusCode, r.Header.Get("Location"))
	}
	var c *http.Cookie
	for _, x := range r.Cookies() {
		if x.Name == nombreCookiePanel {
			c = x
		}
	}
	if c == nil || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Value != claveDePrueba {
		t.Fatalf("cookie incorrecta: %+v", c)
	}
	mala := nuevaPeticion(t, srv, "GET", "/?k=otra", "", false, nil)
	if mala.StatusCode != http.StatusUnauthorized {
		t.Fatalf("una clave mala debe dar 401, dio %d", mala.StatusCode)
	}
}

func TestPanelExigeCookieEnTodo(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	for _, ruta := range []string{"/", "/panel.js", "/panel.css", "/api/estado", "/api/qr?que=local", "/api/doctor"} {
		if r := nuevaPeticion(t, srv, "GET", ruta, "", false, nil); r.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s sin cookie dio %d", ruta, r.StatusCode)
		}
	}
	r := nuevaPeticion(t, srv, "GET", "/api/estado", "", false, nil)
	cuerpo, _ := io.ReadAll(r.Body)
	if !strings.Contains(string(cuerpo), "Sesión del panel caducada") {
		t.Errorf("mensaje 401 inesperado: %s", cuerpo)
	}
}

func TestPanelSirveLaInterfazConCabecerasSeguras(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	for ruta, tipo := range map[string]string{"/": "text/html", "/panel.js": "text/javascript", "/panel.css": "text/css"} {
		r := nuevaPeticion(t, srv, "GET", ruta, "", true, nil)
		if r.StatusCode != 200 || !strings.HasPrefix(r.Header.Get("Content-Type"), tipo) {
			t.Errorf("%s: %d %s", ruta, r.StatusCode, r.Header.Get("Content-Type"))
		}
		if !strings.Contains(r.Header.Get("Content-Security-Policy"), "default-src 'self'") || r.Header.Get("Cache-Control") != "no-store" {
			t.Errorf("%s sin cabeceras seguras", ruta)
		}
	}
	if r := nuevaPeticion(t, srv, "GET", "/secreto.txt", "", true, nil); r.StatusCode != 404 {
		t.Errorf("una ruta desconocida debe dar 404, dio %d", r.StatusCode)
	}
}

func TestPanelRechazaHostAjenoYPostSinCabecera(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	// DNS rebinding: la petición llega con otro nombre de host.
	if r := nuevaPeticion(t, srv, "GET", "/api/estado", "", true, map[string]string{"Host": "malo.example.com:80"}); r.StatusCode != 403 {
		t.Errorf("Host ajeno dio %d", r.StatusCode)
	}
	// POST sin X-NEXO-Panel (CSRF).
	if r := nuevaPeticion(t, srv, "POST", "/api/detener", "{}", true, map[string]string{"Content-Type": "application/json"}); r.StatusCode != 403 {
		t.Errorf("POST sin cabecera dio %d", r.StatusCode)
	}
	// Origen de otra página.
	cab := map[string]string{cabeceraPanel: "1", "Content-Type": "application/json", "Origin": "http://malo.example.com"}
	if r := nuevaPeticion(t, srv, "POST", "/api/detener", "{}", true, cab); r.StatusCode != 403 {
		t.Errorf("Origin ajeno dio %d", r.StatusCode)
	}
	// Tipo de contenido que no es JSON (formulario clásico).
	if r := nuevaPeticion(t, srv, "POST", "/api/detener", "a=b", true, map[string]string{cabeceraPanel: "1", "Content-Type": "application/x-www-form-urlencoded"}); r.StatusCode != 415 {
		t.Errorf("form dio %d", r.StatusCode)
	}
	if len(f.llamadas) != 0 {
		t.Errorf("no debió ejecutarse nada, pero hubo %v", f.llamadas)
	}
}

func TestPanelRutasPrincipales(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	r := nuevaPeticion(t, srv, "GET", "/api/estado", "", true, nil)
	var estado EstadoPanel
	if err := json.NewDecoder(r.Body).Decode(&estado); err != nil || estado.Estado != "activo" || estado.Enlaces.Internet == "" || !estado.Autoarranque.Activo {
		t.Fatalf("estado inesperado: %+v (%v)", estado, err)
	}
	for _, ruta := range []string{"iniciar", "detener", "reiniciar", "rotar", "abrir-registros"} {
		resp := nuevaPeticion(t, srv, "POST", "/api/"+ruta, "{}", true, postJSON)
		var cuerpo map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&cuerpo)
		if resp.StatusCode != 200 || cuerpo["ok"] != true {
			t.Errorf("%s: %d %v", ruta, resp.StatusCode, cuerpo)
		}
	}
	resp := nuevaPeticion(t, srv, "POST", "/api/ajustes", `{"modo":"local","gpu":false,"micDispositivo":"X"}`, true, postJSON)
	var aj struct {
		Ok               bool    `json:"ok"`
		Ajustes          Ajustes `json:"ajustes"`
		RequiereReinicio bool    `json:"requiereReinicio"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&aj)
	if !aj.Ok || aj.Ajustes.Modo != "local" || !aj.RequiereReinicio {
		t.Errorf("ajustes: %+v", aj)
	}
	resp = nuevaPeticion(t, srv, "POST", "/api/emparejar", `{"minutos":5}`, true, postJSON)
	cuerpo, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(cuerpo), "ABCD-EFGH") {
		t.Errorf("emparejar: %s", cuerpo)
	}
	resp = nuevaPeticion(t, srv, "POST", "/api/emparejar", `{"minutos":99999}`, true, postJSON)
	cuerpo, _ = io.ReadAll(resp.Body)
	if !strings.Contains(string(cuerpo), `"ok":false`) {
		t.Errorf("minutos excesivos deben rechazarse: %s", cuerpo)
	}
	resp = nuevaPeticion(t, srv, "GET", "/api/qr?que=internet", "", true, nil)
	png, _ := io.ReadAll(resp.Body)
	if resp.Header.Get("Content-Type") != "image/png" || !strings.Contains(string(png), "internet") {
		t.Errorf("qr: %s %q", resp.Header.Get("Content-Type"), png)
	}
	if r := nuevaPeticion(t, srv, "GET", "/api/qr?que=otro", "", true, nil); r.StatusCode != 404 {
		t.Errorf("qr de algo desconocido dio %d", r.StatusCode)
	}
	if len(f.llamadas) < 6 {
		t.Errorf("faltan llamadas a las operaciones: %v", f.llamadas)
	}
}

func TestPanelErroresVanComoOkFalse(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	f.fallo = errors.New("No se pudo hacer eso.")
	resp := nuevaPeticion(t, srv, "POST", "/api/autoarranque", `{"activo":false}`, true, postJSON)
	var cuerpo map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&cuerpo)
	if resp.StatusCode != 200 || cuerpo["ok"] != false || cuerpo["error"] != "No se pudo hacer eso." {
		t.Errorf("error esperado como ok:false, hubo %d %v", resp.StatusCode, cuerpo)
	}
	resp = nuevaPeticion(t, srv, "POST", "/api/ajustes", "{no es json", true, postJSON)
	cuerpo = nil
	_ = json.NewDecoder(resp.Body).Decode(&cuerpo)
	if cuerpo["ok"] != false {
		t.Errorf("un JSON roto debe dar ok:false: %v", cuerpo)
	}
}

func TestPanelAvisoNoDevuelveElToken(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	resp := nuevaPeticion(t, srv, "GET", "/api/aviso", "", true, nil)
	cuerpo, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(cuerpo), "\"telegramToken\"") || !strings.Contains(string(cuerpo), "tieneTelegramToken") {
		t.Errorf("la respuesta del aviso no debe incluir el token: %s", cuerpo)
	}
}

// ---- ajustes y aviso (lógica pura) ----------------------------------------

func TestAjustesLeerValidarYGuardar(t *testing.T) {
	dir := t.TempDir()
	ruta := rutaAjustes(dir)
	if got := leerAjustes(ruta); got != ajustesPorDefecto {
		t.Fatalf("sin archivo debe ser el valor por defecto: %+v", got)
	}
	_ = os.WriteFile(ruta, []byte(`{"modo":`), 0o600)
	if got := leerAjustes(ruta); got != ajustesPorDefecto {
		t.Fatalf("archivo roto: %+v", got)
	}
	if _, err := validarAjustes(Ajustes{Modo: "raro"}); err == nil {
		t.Error("un modo raro debe rechazarse")
	}
	if _, err := validarAjustes(Ajustes{Modo: "local", MicDispositivo: strings.Repeat("x", 200)}); err == nil {
		t.Error("un nombre larguísimo debe rechazarse")
	}
	v, err := validarAjustes(Ajustes{Modo: "remote", GPU: false, MicDispositivo: "  "})
	if err != nil || v.MicDispositivo != "CABLE Input" {
		t.Fatalf("vacío debe volver al cable por defecto: %+v %v", v, err)
	}
	if err := guardarAjustes(ruta, Ajustes{Modo: "local", GPU: false, MicDispositivo: "Voicemeeter Input"}); err != nil {
		t.Fatal(err)
	}
	if got := leerAjustes(ruta); got != (Ajustes{Modo: "local", GPU: false, MicDispositivo: "Voicemeeter Input"}) {
		t.Fatalf("ida y vuelta: %+v", got)
	}
	if restos, _ := filepath.Glob(ruta + ".tmp-*"); len(restos) != 0 {
		t.Errorf("quedaron temporales: %v", restos)
	}
}

func TestAvisoConservaClavesAjenasYComentarios(t *testing.T) {
	original := "# mi configuración\r\nNEXO_AVISO=ninguno\r\nNTFY_TEMA=viejo\r\nNEXO_AVISO_ESPERA=120\r\n"
	nuevo := renderizarAviso(original, Aviso{Metodo: "ntfy", NtfyServidor: "https://ntfy.sh", NtfyTema: "tema-largo-secreto-123", TelegramChat: ""})
	for _, esperado := range []string{"# mi configuración", "NEXO_AVISO=ntfy", "NTFY_TEMA=tema-largo-secreto-123", "NEXO_AVISO_ESPERA=120", "NTFY_SERVIDOR=https://ntfy.sh", "TELEGRAM_CHAT="} {
		if !strings.Contains(nuevo, esperado) {
			t.Errorf("falta %q en:\n%s", esperado, nuevo)
		}
	}
	if strings.Contains(nuevo, "NTFY_TEMA=viejo") {
		t.Error("el tema viejo debió reemplazarse")
	}
	leido := parsearAviso(nuevo)
	if leido.Metodo != "ntfy" || leido.NtfyTema != "tema-largo-secreto-123" {
		t.Errorf("ida y vuelta: %+v", leido)
	}
}

func TestAvisoValidaYConservaElTokenDeTelegram(t *testing.T) {
	if validarAviso(Aviso{Metodo: "ntfy", NtfyServidor: "ftp://x", NtfyTema: "tema"}, false) == nil {
		t.Error("ntfy con servidor no http debe rechazarse")
	}
	if validarAviso(Aviso{Metodo: "ntfy", NtfyServidor: "https://ntfy.sh", NtfyTema: "con espacios"}, false) == nil {
		t.Error("un tema con espacios debe rechazarse")
	}
	if validarAviso(Aviso{Metodo: "telegram", TelegramChat: "abc", TelegramToken: "123456789:AAAAAAAAAAAAAAAAAAAAAAAA"}, false) == nil {
		t.Error("un chat no numérico debe rechazarse")
	}
	if validarAviso(Aviso{Metodo: "telegram", TelegramChat: "-100123", TelegramToken: ""}, false) == nil {
		t.Error("sin token y sin conservarlo debe rechazarse")
	}
	if err := validarAviso(Aviso{Metodo: "telegram", TelegramChat: "-100123", TelegramToken: ""}, true); err != nil {
		t.Errorf("con conservarToken el token vacío es válido: %v", err)
	}
	dir := t.TempDir()
	ruta := filepath.Join(dir, "nexo-aviso.conf")
	if err := guardarAviso(ruta, Aviso{Metodo: "telegram", TelegramChat: "-100123", TelegramToken: "123456789:AAAAAAAAAAAAAAAAAAAAAAAA"}, false); err != nil {
		t.Fatal(err)
	}
	// Guardar de nuevo sin token: se conserva el anterior.
	if err := guardarAviso(ruta, Aviso{Metodo: "telegram", TelegramChat: "-100999", TelegramToken: ""}, true); err != nil {
		t.Fatal(err)
	}
	leido := leerAviso(ruta)
	if leido.TelegramToken != "123456789:AAAAAAAAAAAAAAAAAAAAAAAA" || leido.TelegramChat != "-100999" {
		t.Errorf("no se conservó el token: %+v", leido)
	}
}

func TestNombreDeTareaSeValida(t *testing.T) {
	t.Setenv("NEXO_TASK_NAME", "NEXO-prueba")
	if nombreTarea() != "NEXO-prueba" {
		t.Error("un nombre válido debe aceptarse")
	}
	t.Setenv("NEXO_TASK_NAME", "x'; Remove-Item C:\\ -Recurse #")
	if nombreTarea() != "NEXO" {
		t.Error("un nombre con comillas debe ignorarse (inyección en el script)")
	}
}

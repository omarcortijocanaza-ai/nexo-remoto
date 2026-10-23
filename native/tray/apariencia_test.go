package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// ---- lógica pura: leer, validar y guardar la apariencia --------------------

func TestAparienciaPorDefectoEsReyMuerto(t *testing.T) {
	if aparienciaPorDefecto != (Apariencia{Tema: "reymuerto", Modo: "auto", PorDispositivo: false}) {
		t.Fatalf("el defecto debe ser reymuerto/auto/false (ESPECIFICACION § 4): %+v", aparienciaPorDefecto)
	}
	if got := leerApariencia(filepath.Join(t.TempDir(), nombreArchivoApariencia)); got != aparienciaPorDefecto {
		t.Fatalf("sin archivo debe dar el valor por defecto, no un error: %+v", got)
	}
	if nombreArchivoApariencia != ".nexo-apariencia.json" {
		t.Fatalf("el nombre del archivo es parte del contrato con el servidor Node: %s", nombreArchivoApariencia)
	}
}

func TestAparienciaLeerEsIndulgenteCampoPorCampo(t *testing.T) {
	dir := t.TempDir()
	ruta := rutaApariencia(dir)
	casos := []struct {
		nombre, contenido string
		esperado          Apariencia
	}{
		{"roto", `{"tema":`, aparienciaPorDefecto},
		{"vacío", ``, aparienciaPorDefecto},
		{"no es objeto", `[1,2,3]`, aparienciaPorDefecto},
		{"tema desconocido", `{"tema":"neon","modo":"oscuro","porDispositivo":true}`, Apariencia{"reymuerto", "oscuro", true}},
		{"modo desconocido", `{"tema":"cabina","modo":"sepia","porDispositivo":true}`, Apariencia{"cabina", "auto", true}},
		{"tipos equivocados", `{"tema":7,"modo":false,"porDispositivo":"si"}`, aparienciaPorDefecto},
		{"mayúsculas no valen", `{"tema":"Cabina","modo":"OSCURO"}`, aparienciaPorDefecto},
		{"completo", `{"tema":"bloque","modo":"claro","porDispositivo":true}`, Apariencia{"bloque", "claro", true}},
		{"campos extra se ignoran", `{"tema":"nativa","version":3}`, Apariencia{"nativa", "auto", false}},
	}
	for _, c := range casos {
		if err := os.WriteFile(ruta, []byte(c.contenido), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := leerApariencia(ruta); got != c.esperado {
			t.Errorf("%s: esperaba %+v y salió %+v", c.nombre, c.esperado, got)
		}
	}
}

func TestAparienciaValidarEsEstrictoAlEscribir(t *testing.T) {
	for _, tema := range temasValidos {
		for _, modo := range []string{"auto", "claro", "oscuro"} {
			if _, err := validarApariencia(Apariencia{Tema: tema, Modo: modo}); err != nil {
				t.Errorf("%s/%s debía ser válido: %v", tema, modo, err)
			}
		}
	}
	if len(temasValidos) != 5 {
		t.Errorf("son cinco apariencias, hay %d", len(temasValidos))
	}
	for _, mala := range []Apariencia{
		{Tema: "neon", Modo: "auto"}, {Tema: "", Modo: "auto"}, {Tema: "Cabina", Modo: "auto"},
		{Tema: "../../etc/passwd", Modo: "auto"}, {Tema: "cabina", Modo: ""}, {Tema: "cabina", Modo: "sepia"},
	} {
		_, err := validarApariencia(mala)
		if err == nil {
			t.Errorf("%+v debía rechazarse", mala)
			continue
		}
		if !strings.Contains(err.Error(), "apariencia") && !strings.Contains(err.Error(), "modo") {
			t.Errorf("el mensaje debe estar en español y decir qué hacer: %q", err)
		}
	}
}

func TestAparienciaGuardarEsAtomicoYIdaYVuelta(t *testing.T) {
	dir := t.TempDir()
	ruta := rutaApariencia(dir)
	quiere := Apariencia{Tema: "cianotipo", Modo: "oscuro", PorDispositivo: true}
	if err := guardarApariencia(ruta, quiere); err != nil {
		t.Fatal(err)
	}
	if got := leerApariencia(ruta); got != quiere {
		t.Fatalf("ida y vuelta: %+v", got)
	}
	if restos, _ := filepath.Glob(ruta + ".tmp-*"); len(restos) != 0 {
		t.Errorf("quedaron temporales: %v", restos)
	}
	// El servidor Node lee estas tres claves con estos nombres exactos.
	datos, _ := os.ReadFile(ruta)
	var crudo map[string]any
	if err := json.Unmarshal(datos, &crudo); err != nil {
		t.Fatalf("el archivo debe ser JSON válido: %v", err)
	}
	if len(crudo) != 3 || crudo["tema"] != "cianotipo" || crudo["modo"] != "oscuro" || crudo["porDispositivo"] != true {
		t.Errorf("claves del archivo: %v", crudo)
	}
	if !strings.HasSuffix(string(datos), "\n") {
		t.Error("el archivo debe terminar en salto de línea")
	}
	// Sobrescribir otra vez no deja basura ni cambia las claves.
	if err := guardarApariencia(ruta, aparienciaPorDefecto); err != nil {
		t.Fatal(err)
	}
	if got := leerApariencia(ruta); got != aparienciaPorDefecto {
		t.Errorf("segunda escritura: %+v", got)
	}
}

func TestAparienciaGuardarCreaLaCarpetaDelEstado(t *testing.T) {
	ruta := rutaApariencia(filepath.Join(t.TempDir(), "no", "existe", "aun"))
	if err := guardarApariencia(ruta, Apariencia{Tema: "nativa", Modo: "claro"}); err != nil {
		t.Fatalf("debe crear la carpeta si falta: %v", err)
	}
	if got := leerApariencia(ruta); got.Tema != "nativa" {
		t.Errorf("no se guardó: %+v", got)
	}
}

// ---- dispositivos ----------------------------------------------------------

func TestDispositivosSoloEtiquetaYFechasNuncaSecretos(t *testing.T) {
	ahora := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	ms := ahora.UnixMilli()
	dir := t.TempDir()
	ruta := rutaDispositivos(dir)
	contenido := map[string]any{"version": 1, "devices": []map[string]any{
		{"id": "ID-SECRETO-1", "hash": "HASH-SECRETO-1", "label": "Pixel de Letzus", "createdAt": ms - 5000, "lastSeen": ms - 1000, "expiresAt": ms + 100000},
		{"id": "ID-SECRETO-2", "hash": "HASH-SECRETO-2", "label": "PC vieja", "createdAt": ms - 9000, "lastSeen": ms - 500, "expiresAt": ms - 1}, // caducado
		{"id": "ID-SECRETO-3", "hash": "HASH-SECRETO-3", "label": "  Tablet\r\n\x00 con basura  ", "createdAt": ms - 7000, "lastSeen": ms - 60000, "expiresAt": ms + 1},
		{"id": "ID-SECRETO-4", "hash": "HASH-SECRETO-4", "label": "", "createdAt": ms, "lastSeen": ms, "expiresAt": ms + 5000},
	}}
	datos, _ := json.Marshal(contenido)
	if err := os.WriteFile(ruta, datos, 0o600); err != nil {
		t.Fatal(err)
	}
	lista := leerDispositivos(ruta, ahora)
	if len(lista) != 3 {
		t.Fatalf("el caducado no debe salir: %+v", lista)
	}
	// Del visto hace menos tiempo al más antiguo.
	if lista[0].UltimaVez < lista[1].UltimaVez || lista[1].UltimaVez < lista[2].UltimaVez {
		t.Errorf("deben ir ordenados por última vez: %+v", lista)
	}
	if lista[0].Etiqueta != "Dispositivo" { // la etiqueta vacía se llama «Dispositivo»
		t.Errorf("la etiqueta vacía debe llamarse Dispositivo: %q", lista[0].Etiqueta)
	}
	json1, _ := json.Marshal(lista)
	for _, secreto := range []string{"ID-SECRETO", "HASH-SECRETO", "expiresAt", "hash"} {
		if strings.Contains(string(json1), secreto) {
			t.Errorf("la respuesta no debe contener %q: %s", secreto, json1)
		}
	}
	for _, d := range lista {
		if strings.ContainsAny(d.Etiqueta, "\r\n\x00") {
			t.Errorf("la etiqueta debe venir sin caracteres de control: %q", d.Etiqueta)
		}
	}
}

func TestDispositivosSinArchivoORotoNoFalla(t *testing.T) {
	dir := t.TempDir()
	ruta := rutaDispositivos(dir)
	if lista := leerDispositivos(ruta, time.Now()); lista == nil || len(lista) != 0 {
		t.Fatalf("sin archivo debe ser una lista vacía (no nil, para que el JSON sea []): %#v", lista)
	}
	_ = os.WriteFile(ruta, []byte(`{"devices":`), 0o600)
	if lista := leerDispositivos(ruta, time.Now()); len(lista) != 0 {
		t.Fatalf("archivo roto: %+v", lista)
	}
	_ = os.WriteFile(ruta, []byte(`{"devices":[{"label":"x","expiresAt":"mañana"}]}`), 0o600)
	if lista := leerDispositivos(ruta, time.Now()); len(lista) != 0 {
		t.Fatalf("tipos equivocados: %+v", lista)
	}
	largo := strings.Repeat("ñ", 200)
	if got := limpiarEtiqueta(largo); len([]rune(got)) != maxEtiquetaDispositivo {
		t.Errorf("la etiqueta se recorta a %d caracteres: %d", maxEtiquetaDispositivo, len([]rune(got)))
	}
}

// ---- rutas HTTP ------------------------------------------------------------

func cuerpoJSON(t *testing.T, r *http.Response) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		t.Fatalf("el cuerpo no es JSON: %v", err)
	}
	return m
}

func TestPanelAparienciaLeerYGuardar(t *testing.T) {
	_, f, srv := servidorDePrueba(t)

	m := cuerpoJSON(t, nuevaPeticion(t, srv, "GET", "/api/apariencia", "", true, nil))
	ap, _ := m["apariencia"].(map[string]any)
	if m["ok"] != true || ap["tema"] != "reymuerto" || ap["modo"] != "auto" || ap["porDispositivo"] != false {
		t.Fatalf("GET /api/apariencia: %v", m)
	}

	m = cuerpoJSON(t, nuevaPeticion(t, srv, "POST", "/api/apariencia", `{"tema":"bloque","modo":"oscuro","porDispositivo":true}`, true, postJSON))
	ap, _ = m["apariencia"].(map[string]any)
	if m["ok"] != true || ap["tema"] != "bloque" || ap["modo"] != "oscuro" || ap["porDispositivo"] != true {
		t.Fatalf("POST completo: %v", m)
	}
	if f.apariencia != (Apariencia{"bloque", "oscuro", true}) {
		t.Fatalf("no se guardó: %+v", f.apariencia)
	}

	// Un POST parcial cambia sólo lo que llega.
	m = cuerpoJSON(t, nuevaPeticion(t, srv, "POST", "/api/apariencia", `{"modo":"claro"}`, true, postJSON))
	if m["ok"] != true || f.apariencia != (Apariencia{"bloque", "claro", true}) {
		t.Fatalf("POST parcial: %v %+v", m, f.apariencia)
	}
	m = cuerpoJSON(t, nuevaPeticion(t, srv, "POST", "/api/apariencia", `{}`, true, postJSON))
	if m["ok"] != true || f.apariencia != (Apariencia{"bloque", "claro", true}) {
		t.Fatalf("un POST vacío no debe cambiar nada: %v %+v", m, f.apariencia)
	}
}

func TestPanelAparienciaRechazaLoInvalidoSinTocarLoGuardado(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	f.apariencia = Apariencia{"cianotipo", "claro", false}
	for _, cuerpo := range []string{
		`{"tema":"neon"}`, `{"tema":"../../index"}`, `{"modo":"sepia"}`, `{"tema":"","modo":"auto"}`,
		`{"porDispositivo":"si"}`, `{no es json`, `{"tema":7}`,
	} {
		resp := nuevaPeticion(t, srv, "POST", "/api/apariencia", cuerpo, true, postJSON)
		m := cuerpoJSON(t, resp)
		if resp.StatusCode != 200 || m["ok"] != false {
			t.Errorf("%s debía dar HTTP 200 con ok:false, dio %d %v", cuerpo, resp.StatusCode, m)
			continue
		}
		if msg, _ := m["error"].(string); msg == "" || !strings.HasSuffix(msg, ".") {
			t.Errorf("%s: el error debe ser un texto en español: %q", cuerpo, msg)
		}
	}
	if f.apariencia != (Apariencia{"cianotipo", "claro", false}) {
		t.Errorf("lo guardado no debe cambiar tras errores: %+v", f.apariencia)
	}
	// Un fallo al escribir en disco también llega como ok:false.
	f.fallo = errors.New("No se pudo guardar la apariencia: disco lleno.")
	m := cuerpoJSON(t, nuevaPeticion(t, srv, "POST", "/api/apariencia", `{"tema":"nativa"}`, true, postJSON))
	if m["ok"] != false || !strings.Contains(m["error"].(string), "disco lleno") {
		t.Errorf("error de escritura: %v", m)
	}
}

func TestPanelAparienciaExigeCookieYCabecera(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	for _, ruta := range []string{"/api/apariencia", "/api/dispositivos"} {
		if r := nuevaPeticion(t, srv, "GET", ruta, "", false, nil); r.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET %s sin cookie dio %d", ruta, r.StatusCode)
		}
	}
	if r := nuevaPeticion(t, srv, "POST", "/api/apariencia", `{"tema":"bloque"}`, false, postJSON); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("POST sin cookie dio %d", r.StatusCode)
	}
	if r := nuevaPeticion(t, srv, "POST", "/api/apariencia", `{"tema":"bloque"}`, true, map[string]string{"Content-Type": "application/json"}); r.StatusCode != http.StatusForbidden {
		t.Errorf("POST sin X-NEXO-Panel dio %d", r.StatusCode)
	}
	cab := map[string]string{cabeceraPanel: "1", "Content-Type": "application/json", "Origin": "http://malo.example.com"}
	if r := nuevaPeticion(t, srv, "POST", "/api/apariencia", `{"tema":"bloque"}`, true, cab); r.StatusCode != http.StatusForbidden {
		t.Errorf("POST con Origin ajeno dio %d", r.StatusCode)
	}
	if f.apariencia != aparienciaPorDefecto {
		t.Errorf("nada de eso debió guardar: %+v", f.apariencia)
	}
}

func TestPanelDispositivosDevuelveLista(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	m := cuerpoJSON(t, nuevaPeticion(t, srv, "GET", "/api/dispositivos", "", true, nil))
	if lista, ok := m["dispositivos"].([]any); m["ok"] != true || !ok || len(lista) != 0 {
		t.Fatalf("vacío debe ser [], no null: %v", m)
	}
	f.dispositivos = []DispositivoPanel{{Etiqueta: "Pixel", UltimaVez: 1700000000000, Creado: 1690000000000}}
	m = cuerpoJSON(t, nuevaPeticion(t, srv, "GET", "/api/dispositivos", "", true, nil))
	lista, _ := m["dispositivos"].([]any)
	d, _ := lista[0].(map[string]any)
	if len(lista) != 1 || d["etiqueta"] != "Pixel" || d["ultimaVez"] != float64(1700000000000) || d["creado"] != float64(1690000000000) {
		t.Fatalf("dispositivos: %v", m)
	}
}

// ---- la página se sirve ya vestida con la apariencia guardada --------------

func cuerpoTexto(t *testing.T, r *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestPanelIndexLlevaElTemaGuardadoAntesDelPrimerPintado(t *testing.T) {
	_, f, srv := servidorDePrueba(t)
	html := cuerpoTexto(t, nuevaPeticion(t, srv, "GET", "/", "", true, nil))
	if !strings.Contains(html, `<html lang="es" data-tema="reymuerto" data-pref="auto">`) {
		t.Fatalf("por defecto debe ir Rey Muerto/auto en <html>: %.200s", html)
	}
	f.apariencia = Apariencia{"cianotipo", "oscuro", true}
	html = cuerpoTexto(t, nuevaPeticion(t, srv, "GET", "/index.html", "", true, nil))
	if !strings.Contains(html, `<html lang="es" data-tema="cianotipo" data-pref="oscuro">`) {
		t.Fatalf("debe reflejar lo guardado: %.200s", html)
	}
	// El script que resuelve «auto» va ANTES de las hojas de estilo (bloqueante, sin async ni defer).
	iScript := strings.Index(html, `<script src="tema-inicial.js"></script>`)
	iCSS := strings.Index(html, `<link rel="stylesheet" href="panel.css">`)
	if iScript < 0 || iCSS < 0 || iScript > iCSS {
		t.Errorf("tema-inicial.js debe cargarse antes que panel.css (script %d, css %d)", iScript, iCSS)
	}
	// Aunque el archivo trajera basura, nada raro llega al HTML.
	f.apariencia = Apariencia{`"><script>x</script>`, `"onload=`, false}
	html = cuerpoTexto(t, nuevaPeticion(t, srv, "GET", "/", "", true, nil))
	if strings.Contains(html, "<script>x") || !strings.Contains(html, `data-tema="reymuerto" data-pref="auto"`) {
		t.Errorf("un valor inválido debe caer al defecto: %.200s", html)
	}
}

// ---- recursos embebidos ----------------------------------------------------

func TestPanelServeTemasFuentesEImagenes(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	casos := map[string]string{
		"/tema-inicial.js":                        "text/javascript",
		"/temas/cabina.css":                       "text/css",
		"/temas/nativa.css":                       "text/css",
		"/temas/reymuerto.css":                    "text/css",
		"/temas/cianotipo.css":                    "text/css",
		"/temas/bloque.css":                       "text/css",
		"/fuentes/fuentes.css":                    "text/css",
		"/fuentes/Cinzel-500-700.woff2":           "font/woff2",
		"/img/rey-pixel.svg":                      "image/svg+xml",
		"/img/corona-pixel.svg":                   "image/svg+xml",
		"/img/cadena-pixel.svg":                   "image/svg+xml",
		"/img/fondo-niebla.webp":                  "image/webp",
		"/fuentes/AtkinsonHyperlegible-400.woff2": "font/woff2",
	}
	for ruta, tipo := range casos {
		r := nuevaPeticion(t, srv, "GET", ruta, "", true, nil)
		if r.StatusCode != 200 || !strings.HasPrefix(r.Header.Get("Content-Type"), tipo) {
			t.Errorf("%s: %d %s", ruta, r.StatusCode, r.Header.Get("Content-Type"))
		}
		if !strings.Contains(r.Header.Get("Content-Security-Policy"), "default-src 'self'") {
			t.Errorf("%s sin política de seguridad", ruta)
		}
		if sinCookie := nuevaPeticion(t, srv, "GET", ruta, "", false, nil); sinCookie.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s sin cookie dio %d", ruta, sinCookie.StatusCode)
		}
	}
}

func TestPanelFuentesEImagenesSeRevalidanConETag(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	r := nuevaPeticion(t, srv, "GET", "/fuentes/Cinzel-500-700.woff2", "", true, nil)
	etag := r.Header.Get("ETag")
	if etag == "" || r.Header.Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("falta ETag o Cache-Control: %q %q", etag, r.Header.Get("Cache-Control"))
	}
	if len(cuerpoTexto(t, r)) < 1000 {
		t.Error("la fuente debe llegar entera")
	}
	r2 := nuevaPeticion(t, srv, "GET", "/fuentes/Cinzel-500-700.woff2", "", true, map[string]string{"If-None-Match": etag})
	if r2.StatusCode != http.StatusNotModified {
		t.Errorf("con el mismo ETag debe dar 304, dio %d", r2.StatusCode)
	}
	// HTML, CSS y JS del panel no se cachean (cambian con cada versión y el panel es local).
	for _, ruta := range []string{"/", "/panel.css", "/panel.js", "/temas/bloque.css", "/tema-inicial.js"} {
		if cc := nuevaPeticion(t, srv, "GET", ruta, "", true, nil).Header.Get("Cache-Control"); cc != "no-store" {
			t.Errorf("%s: Cache-Control %q", ruta, cc)
		}
	}
}

func TestPanelNoSirveNadaFueraDeLoEmbebido(t *testing.T) {
	_, _, srv := servidorDePrueba(t)
	for _, ruta := range []string{
		"/temas/", "/temas", "/fuentes/", "/img/", "/temas/inexistente.css", "/fuentes/nada.woff2",
		"/panel/index.html", "/CONTRATO.md", "/dev/mock-server.js", "/go.mod", "/main_windows.go",
		"/temas/../panel.go", "/fuentes/../../panel.go", "/%2e%2e/panel.go", "/temas/%2e%2e/panel.go",
		"/fuentes/..%2f..%2fpanel.go", "/img/rey-pixel.svg/", "/temas/cabina.css/x",
	} {
		r := nuevaPeticion(t, srv, "GET", ruta, "", true, nil)
		cuerpo := cuerpoTexto(t, r)
		if r.StatusCode == 200 || strings.Contains(cuerpo, "package main") {
			t.Errorf("%s no debía servirse: %d %.60s", ruta, r.StatusCode, cuerpo)
		}
	}
}

// El panel funciona sin Internet: ningún HTML, CSS ni JS embebido pide nada fuera de 127.0.0.1.
func TestPanelSinRecursosExternos(t *testing.T) {
	externo := regexp.MustCompile(`(?i)(src|href)\s*=\s*["']\s*(https?:)?//|url\(\s*["']?\s*(https?:)?//|@import|googleapis|gstatic|cdn\.|<iframe|fetch\(\s*["']https?:`)
	_ = fs.WalkDir(archivosPanel, "panel", func(archivo string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		switch filepath.Ext(archivo) {
		case ".html", ".css", ".js":
			datos, _ := archivosPanel.ReadFile(archivo)
			if m := externo.Find(datos); m != nil {
				t.Errorf("%s pide un recurso externo: %q", archivo, m)
			}
			if len(datos) >= 80*1024 {
				t.Errorf("%s pesa %d bytes: cada archivo del panel debe ser < 80 KB", archivo, len(datos))
			}
		}
		return nil
	})
}

// Todo lo que enlazan el HTML y las hojas existe de verdad dentro del ejecutable.
func TestPanelTodasLasReferenciasExisten(t *testing.T) {
	refHTML := regexp.MustCompile(`(?:href|src)="([^"#:]+)"`)
	refCSS := regexp.MustCompile(`url\(\s*['"]?([^'")\s]+)['"]?\s*\)`)
	comprobar := func(origen, base, ref string) {
		if strings.HasPrefix(ref, "data:") {
			return
		}
		ruta := path.Clean(path.Join(base, ref))
		if _, ok := recursosPanel["/"+ruta]; !ok {
			t.Errorf("%s apunta a %q, que no está embebido (/%s)", origen, ref, ruta)
		}
	}
	html, _ := archivosPanel.ReadFile("panel/index.html")
	for _, m := range refHTML.FindAllSubmatch(html, -1) {
		comprobar("index.html", ".", string(m[1]))
	}
	for url, rec := range recursosPanel {
		if !strings.HasSuffix(url, ".css") {
			continue
		}
		datos, _ := archivosPanel.ReadFile(rec.archivo)
		for _, m := range refCSS.FindAllSubmatch(datos, -1) {
			comprobar(url, path.Dir(strings.TrimPrefix(url, "/")), string(m[1]))
		}
	}
	// Las cinco apariencias tienen su hoja y todas se cargan desde el HTML.
	for _, tema := range temasValidos {
		if _, ok := recursosPanel["/temas/"+tema+".css"]; !ok {
			t.Errorf("falta temas/%s.css", tema)
		}
		if !bytes.Contains(html, []byte(`href="temas/`+tema+`.css"`)) {
			t.Errorf("index.html no carga temas/%s.css", tema)
		}
	}
}

// Cada hoja de tema define las variables de contrato en claro y en oscuro.
func TestTemasDefinenSusVariablesEnLosDosModos(t *testing.T) {
	variables := []string{"--bg:", "--sup:", "--sup2:", "--bd:", "--tx:", "--su:", "--ac:", "--ac-tx:", "--ok:", "--av:", "--ml:", "--r:", "--rg:", "--f-t:", "--f-c:"}
	for _, tema := range temasValidos {
		datos, err := archivosPanel.ReadFile("panel/temas/" + tema + ".css")
		if err != nil {
			t.Fatal(err)
		}
		css := string(datos)
		for _, modo := range []string{"claro", "oscuro"} {
			sel := `[data-tema="` + tema + `"][data-modo="` + modo + `"]`
			i := strings.Index(css, sel+" {")
			if i < 0 {
				t.Errorf("%s no define %s", tema, sel)
				continue
			}
			bloque := css[i : i+strings.Index(css[i:], "}")]
			// --r, --rg y las fuentes viven en el bloque común del tema (sin modo).
			for _, v := range variables[:11] {
				if !strings.Contains(bloque, v) {
					t.Errorf("%s/%s no define %s", tema, modo, v)
				}
			}
		}
		comun := css[strings.Index(css, `[data-tema="`+tema+`"] {`):]
		comun = comun[:strings.Index(comun, "}")]
		for _, v := range variables[11:] {
			if !strings.Contains(comun, v) {
				t.Errorf("%s no define %s en su bloque común", tema, v)
			}
		}
	}
}

// panel/fuentes y panel/img son copias de assets/: si alguien cambia assets/ y olvida sincronizar,
// el panel llevaría fuentes o imágenes viejas.
func TestRecursosEmbebidosAlDiaConAssets(t *testing.T) {
	assets := filepath.Join("..", "..", "assets")
	if _, err := os.Stat(assets); err != nil {
		t.Skip("sin la carpeta assets/ (fuera del repositorio completo)")
	}
	pares := []struct{ origen, destino, ext string }{
		{filepath.Join(assets, "fuentes"), "panel/fuentes", ""},
		{filepath.Join(assets, "viego"), "panel/img", ""},
	}
	for _, p := range pares {
		entradas, err := os.ReadDir(p.origen)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entradas {
			nombre := e.Name()
			ext := filepath.Ext(nombre)
			if p.destino == "panel/fuentes" && ext != ".woff2" && nombre != "fuentes.css" {
				continue
			}
			if p.destino == "panel/img" && ext != ".svg" && nombre != "fondo-niebla.webp" {
				continue
			}
			original, _ := os.ReadFile(filepath.Join(p.origen, nombre))
			copia, err := archivosPanel.ReadFile(p.destino + "/" + nombre)
			if err != nil || !bytes.Equal(original, copia) {
				t.Errorf("%s/%s está desactualizado: corre node scripts/ui/sync-recursos-panel.js", p.destino, nombre)
			}
		}
	}
}

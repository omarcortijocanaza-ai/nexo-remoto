package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestEnlaceInternet(t *testing.T) {
	casos := []struct {
		nombre string
		e      *Estado
		quiere string
	}{
		{"nil", nil, ""},
		{"sin túnel", &Estado{Token: "abc"}, ""},
		{"sin token", &Estado{RemoteURL: "https://x.trycloudflare.com"}, ""},
		{"normal", &Estado{Token: "abc", RemoteURL: "https://x.trycloudflare.com"}, "https://x.trycloudflare.com/?token=abc"},
		{"barra final", &Estado{Token: "abc", RemoteURL: "https://x.trycloudflare.com/"}, "https://x.trycloudflare.com/?token=abc"},
		{"varias barras", &Estado{Token: "abc", RemoteURL: "https://x.trycloudflare.com//"}, "https://x.trycloudflare.com/?token=abc"},
	}
	for _, c := range casos {
		if got := enlaceInternet(c.e); got != c.quiere {
			t.Errorf("%s: enlaceInternet = %q, quiero %q", c.nombre, got, c.quiere)
		}
	}
}

func TestEnlaceLocal(t *testing.T) {
	if enlaceLocal(nil) != "" {
		t.Error("nil debe dar vacío")
	}
	e := &Estado{LocalURL: "http://192.168.1.5:8765/?token=abc"}
	if got := enlaceLocal(e); got != e.LocalURL {
		t.Errorf("enlaceLocal = %q, debe ser tal cual", got)
	}
}

func TestParsearEstado(t *testing.T) {
	json := `{"token":"t","mode":"both","port":9000,"localUrl":"http://1.2.3.4:9000/?token=t","remoteUrl":"","status":"running","updatedAt":"2026-10-16T00:00:00Z"}`
	e, err := parsearEstado([]byte(json))
	if err != nil {
		t.Fatal(err)
	}
	if e.Token != "t" || e.Mode != "both" || e.Port != 9000 || e.Status != "running" {
		t.Errorf("estado mal parseado: %+v", e)
	}
	// A medias o vacío: debe dar error (el llamador reintenta), no entrar en pánico.
	for _, malo := range []string{"", `{"token":"t","mo`, "no json"} {
		if _, err := parsearEstado([]byte(malo)); err == nil {
			t.Errorf("%q debería dar error", malo)
		}
	}
}

func TestLeerEstadoInexistente(t *testing.T) {
	if _, err := leerEstado(filepath.Join(t.TempDir(), "no-existe.json")); err == nil {
		t.Error("un archivo inexistente debe dar error")
	}
}

func TestPuertoSalud(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}
	casos := []struct {
		nombre string
		e      *Estado
		env    map[string]string
		quiere int
	}{
		{"del estado", &Estado{Port: 9000}, map[string]string{"REMOTE_KEYBOARD_PORT": "7000"}, 9000},
		{"de la variable", &Estado{}, map[string]string{"REMOTE_KEYBOARD_PORT": "7000"}, 7000},
		{"estado nil", nil, map[string]string{"REMOTE_KEYBOARD_PORT": " 7001 "}, 7001},
		{"variable inválida", nil, map[string]string{"REMOTE_KEYBOARD_PORT": "abc"}, 8765},
		{"fuera de rango", &Estado{Port: 70000}, nil, 8765},
		{"por defecto", nil, nil, 8765},
	}
	for _, c := range casos {
		if got := puertoSalud(c.e, env(c.env)); got != c.quiere {
			t.Errorf("%s: puerto = %d, quiero %d", c.nombre, got, c.quiere)
		}
	}
}

func TestCalcularVisual(t *testing.T) {
	casos := []struct {
		nombre string
		salud  bool
		e      *Estado
		quiere Visual
	}{
		{"salud cae", false, &Estado{Mode: "both", RemoteURL: "https://x"}, VisualDetenido},
		{"salud cae sin estado", false, nil, VisualDetenido},
		{"local sin túnel", true, &Estado{Mode: "local"}, VisualActivo},
		{"both con túnel", true, &Estado{Mode: "both", RemoteURL: "https://x"}, VisualActivo},
		{"remote con túnel", true, &Estado{Mode: "remote", RemoteURL: "https://x"}, VisualActivo},
		{"both sin túnel", true, &Estado{Mode: "both"}, VisualConectando},
		{"remote sin túnel", true, &Estado{Mode: "remote"}, VisualConectando},
		{"estado ilegible", true, nil, VisualConectando},
	}
	for _, c := range casos {
		if got := calcularVisual(c.salud, c.e); got != c.quiere {
			t.Errorf("%s: visual = %v, quiero %v", c.nombre, got, c.quiere)
		}
	}
	if VisualActivo.Texto() != "NEXO · activo" ||
		VisualConectando.Texto() != "NEXO · conectando…" ||
		VisualDetenido.Texto() != "NEXO · detenido" {
		t.Error("textos de estado distintos del contrato")
	}
}

func TestEsperaCreciente(t *testing.T) {
	quiere := []time.Duration{2, 4, 8, 16, 32, 60, 60, 60}
	for i, q := range quiere {
		if got := esperaCreciente(i); got != q*time.Second {
			t.Errorf("intento %d: %s, quiero %s", i, got, q*time.Second)
		}
	}
	if esperaCreciente(1000) != esperaMax {
		t.Error("intentos enormes deben quedarse en el tope, sin desbordar")
	}
}

func TestEsperaSiguienteYReinicio(t *testing.T) {
	var e espera
	for _, q := range []time.Duration{2, 4, 8} {
		if got := e.Siguiente(time.Second); got != q*time.Second {
			t.Errorf("Siguiente = %s, quiero %s", got, q*time.Second)
		}
	}
	// Si vivió más de 60 s, vuelve a 2 s.
	if got := e.Siguiente(61 * time.Second); got != 2*time.Second {
		t.Errorf("tras vida sana: %s, quiero 2s", got)
	}
	// Exactamente 60 s no cuenta como «más de 60 s».
	if got := e.Siguiente(60 * time.Second); got != 4*time.Second {
		t.Errorf("con 60 s exactos: %s, quiero 4s", got)
	}
}

func TestEsAdoptado(t *testing.T) {
	casos := []struct {
		nombre string
		codigo int
		vivio  time.Duration
		salud  bool
		quiere bool
	}{
		{"salida limpia y rápida con salud", 0, 300 * time.Millisecond, true, true},
		{"justo bajo el umbral", 0, 4900 * time.Millisecond, true, true},
		{"en el umbral", 0, 5 * time.Second, true, false},
		{"tarde", 0, 30 * time.Second, true, false},
		{"código distinto de 0", 1, time.Second, true, false},
		{"sin salud", 0, time.Second, false, false},
	}
	for _, c := range casos {
		if got := esAdoptado(c.codigo, c.vivio, c.salud); got != c.quiere {
			t.Errorf("%s: esAdoptado = %v, quiero %v", c.nombre, got, c.quiere)
		}
	}
}

func TestCalcularRutas(t *testing.T) {
	vacio := func(string) string { return "" }
	r := calcularRutas(`C:\nexo\nexo-remoto\bin\win`, func(k string) string {
		if k == "LOCALAPPDATA" {
			return `C:\Users\L\AppData\Local`
		}
		return ""
	})
	if r.RepoRoot != filepath.Clean(`C:\nexo\nexo-remoto`) {
		t.Errorf("RepoRoot = %q", r.RepoRoot)
	}
	if r.StateDir != filepath.Join(`C:\Users\L\AppData\Local`, "NEXO", "state") {
		t.Errorf("StateDir = %q", r.StateDir)
	}
	if r.LogsDir != filepath.Join(`C:\Users\L\AppData\Local`, "NEXO", "logs") {
		t.Errorf("LogsDir = %q", r.LogsDir)
	}
	// Las variables de entorno mandan.
	r = calcularRutas(`C:\x\bin\win`, func(k string) string {
		return map[string]string{"NEXO_ROOT": `D:\r`, "NEXO_STATE_DIR": `D:\s`, "NEXO_LOGS_DIR": `D:\l`}[k]
	})
	if r.RepoRoot != `D:\r` || r.StateDir != `D:\s` || r.LogsDir != `D:\l` {
		t.Errorf("las variables no se respetaron: %+v", r)
	}
	_ = vacio
}

func TestLimpiarSalida(t *testing.T) {
	got := limpiarSalida("\x1b[32mCódigo: 123-456\x1b[0m\r\nVálido 5 min\r\n\n")
	if got != "Código: 123-456\nVálido 5 min" {
		t.Errorf("limpiarSalida = %q", got)
	}
}

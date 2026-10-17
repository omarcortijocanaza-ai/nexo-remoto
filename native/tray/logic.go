package main

// Lógica pura de la bandeja de NEXO: nada de aquí toca Windows, la red ni el
// disco (salvo leerEstado), para poder probarla con `go test` sin abrir iconos
// reales ni arrancar NEXO.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	puertoPorDefecto = 8765

	// Cada cuánto se consulta /health y el archivo de estado.
	intervaloSalud = 3 * time.Second
	// Si /health tarda más que esto, se considera caído.
	timeoutSalud = 1500 * time.Millisecond

	// Espera creciente entre relanzamientos: 2 s, 4, 8… hasta 60 s.
	esperaMin = 2 * time.Second
	esperaMax = 60 * time.Second
	// Si el proceso vivió más que esto, se considera que arrancó bien y la
	// espera vuelve a 2 s.
	umbralVidaSana = 60 * time.Second

	// Un lanzador nuevo que sale con código 0 antes de este tiempo y con /health
	// respondiendo es que ya había otro vivo (instancia única): se «adopta».
	ventanaAdopcion = 5 * time.Second
	// Si adoptamos un lanzador ajeno y /health deja de responder más que esto,
	// arrancamos el nuestro.
	caidaAjena = 15 * time.Second
	// Tiempo máximo de `node launcher.js --stop` antes de matar el árbol.
	timeoutDetener = 20 * time.Second
)

// Estado es el contenido de <stateDir>\.nexo-state.json (lo escribe el lanzador
// de forma atómica; aun así puede no existir todavía).
type Estado struct {
	Token     string `json:"token"`
	Mode      string `json:"mode"` // local | remote | both
	Port      int    `json:"port"`
	LocalURL  string `json:"localUrl"`
	RemoteURL string `json:"remoteUrl"` // vacío mientras no haya túnel
	Status    string `json:"status"`    // running | reconnecting | stopped
	UpdatedAt string `json:"updatedAt"`
	// Ajustes con los que arrancó el lanzador (puede faltar en estados antiguos).
	Ajustes *Ajustes `json:"ajustes"`
}

// Rutas agrupa las carpetas que usa la bandeja.
type Rutas struct {
	ExeDir   string
	RepoRoot string
	StateDir string
	LogsDir  string
}

// calcularRutas resuelve las carpetas según el contrato: variables de entorno
// NEXO_ROOT, NEXO_STATE_DIR y NEXO_LOGS_DIR, o los valores por defecto. getenv
// se inyecta para poder probarla.
func calcularRutas(exeDir string, getenv func(string) string) Rutas {
	r := Rutas{ExeDir: exeDir}
	if v := getenv("NEXO_ROOT"); v != "" {
		r.RepoRoot = v
	} else {
		r.RepoRoot = filepath.Clean(filepath.Join(exeDir, "..", ".."))
	}
	base := getenv("LOCALAPPDATA")
	if base == "" {
		// Sin LOCALAPPDATA (muy raro) se cae a la ruta estándar del perfil.
		if home, err := os.UserHomeDir(); err == nil {
			base = filepath.Join(home, "AppData", "Local")
		}
	}
	if v := getenv("NEXO_STATE_DIR"); v != "" {
		r.StateDir = v
	} else {
		r.StateDir = filepath.Join(base, "NEXO", "state")
	}
	if v := getenv("NEXO_LOGS_DIR"); v != "" {
		r.LogsDir = v
	} else {
		r.LogsDir = filepath.Join(base, "NEXO", "logs")
	}
	return r
}

// parsearEstado interpreta el JSON de estado. Un archivo a medias o vacío da
// error y el llamador simplemente reintenta en el siguiente ciclo.
func parsearEstado(datos []byte) (*Estado, error) {
	var e Estado
	if err := json.Unmarshal(datos, &e); err != nil {
		return nil, err
	}
	return &e, nil
}

// leerEstado lee y parsea el archivo de estado; devuelve error si falta o está
// incompleto.
func leerEstado(ruta string) (*Estado, error) {
	datos, err := os.ReadFile(ruta)
	if err != nil {
		return nil, err
	}
	return parsearEstado(datos)
}

// enlaceInternet construye «<remoteUrl sin / final>/?token=<token>». Devuelve ""
// si todavía no hay túnel o no hay token.
func enlaceInternet(e *Estado) string {
	if e == nil || e.RemoteURL == "" || e.Token == "" {
		return ""
	}
	return strings.TrimRight(e.RemoteURL, "/") + "/?token=" + e.Token
}

// enlaceLocal devuelve localUrl tal cual lo escribió el lanzador.
func enlaceLocal(e *Estado) string {
	if e == nil {
		return ""
	}
	return e.LocalURL
}

// puertoSalud elige el puerto de /health: el del estado; si no, la variable
// REMOTE_KEYBOARD_PORT; si no, 8765.
func puertoSalud(e *Estado, getenv func(string) string) int {
	if e != nil && e.Port > 0 && e.Port < 65536 {
		return e.Port
	}
	if v := strings.TrimSpace(getenv("REMOTE_KEYBOARD_PORT")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p < 65536 {
			return p
		}
	}
	return puertoPorDefecto
}

// Visual es el aspecto de la bandeja (icono, tooltip y línea de estado).
type Visual int

const (
	VisualDetenido Visual = iota
	VisualConectando
	VisualActivo
)

// Texto es la línea de estado del menú y el tooltip.
func (v Visual) Texto() string {
	switch v {
	case VisualActivo:
		return "NEXO · activo"
	case VisualConectando:
		return "NEXO · conectando…"
	default:
		return "NEXO · detenido"
	}
}

// calcularVisual combina salud y estado: «activo» si /health responde y, cuando
// el modo no es sólo local, ya hay enlace de Internet; «conectando» si responde
// pero falta el túnel; «detenido» si /health falla. e puede ser nil (estado
// ilegible), lo que cuenta como modo distinto de local.
func calcularVisual(saludOK bool, e *Estado) Visual {
	if !saludOK {
		return VisualDetenido
	}
	if e != nil && e.Mode == "local" {
		return VisualActivo
	}
	if e != nil && e.RemoteURL != "" {
		return VisualActivo
	}
	return VisualConectando
}

// espera lleva la cuenta de la espera creciente entre relanzamientos.
type espera struct{ n int }

// esperaCreciente devuelve 2 s para el intento 0 y duplica hasta 60 s.
func esperaCreciente(intento int) time.Duration {
	d := esperaMin
	for i := 0; i < intento; i++ {
		d *= 2
		if d >= esperaMax {
			return esperaMax
		}
	}
	return d
}

// Siguiente devuelve cuánto esperar ahora. Si el proceso anterior vivió más de
// 60 s, la cuenta se reinicia (arrancó bien; el fallo es nuevo).
func (e *espera) Siguiente(vivio time.Duration) time.Duration {
	if vivio > umbralVidaSana {
		e.n = 0
	}
	d := esperaCreciente(e.n)
	e.n++
	return d
}

// esAdoptado dice si la salida de un lanzador recién arrancado significa que ya
// había otro vivo (instancia única): sale con código 0 casi al instante y
// /health responde.
func esAdoptado(codigo int, vivio time.Duration, saludOK bool) bool {
	return codigo == 0 && vivio < ventanaAdopcion && saludOK
}

var reANSI = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// limpiarSalida prepara la salida de pair.js para un MessageBox: quita colores
// ANSI y espacios sobrantes (el contenido se muestra entero, sin recortar).
func limpiarSalida(s string) string {
	s = reANSI.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "\x00", "")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.TrimSpace(s)
}

// formatoDuracion redondea para el registro («3s», «1m2s»).
func formatoDuracion(d time.Duration) string {
	return fmt.Sprint(d.Round(time.Second))
}

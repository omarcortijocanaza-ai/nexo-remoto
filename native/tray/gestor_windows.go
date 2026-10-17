package main

// Supervisión de los procesos de NEXO: el lanzador (`node launcher.js`) y el
// vigilante de aviso del enlace (pwsh). Ambos se relanzan con espera creciente
// si mueren sin que se haya pedido detenerlos.

import (
	"context"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// clienteSalud: sin proxy ni conexiones persistentes, que /health es local y
// queremos que cada comprobación sea independiente.
var clienteSalud = &http.Client{
	Timeout: timeoutSalud,
	Transport: &http.Transport{
		Proxy:             nil,
		DisableKeepAlives: true,
	},
}

// marcadorDetenido dice si existe <stateDir>\.nexo-stopped (lo escribe `--stop`).
func marcadorDetenido(r Rutas) bool {
	_, err := os.Stat(filepath.Join(r.StateDir, ".nexo-stopped"))
	return err == nil
}

func quitarMarcadorDetenido(r Rutas) {
	_ = os.Remove(filepath.Join(r.StateDir, ".nexo-stopped"))
}

// comprobarSalud hace GET http://127.0.0.1:<puerto>/health; 200 = vivo.
func comprobarSalud(puerto int) bool {
	url := "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(puerto)) + "/health"
	resp, err := clienteSalud.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// ---------------------------------------------------------------------------
// Lanzador
// ---------------------------------------------------------------------------

type Lanzador struct {
	rutas Rutas
	log   *Registro

	opMu sync.Mutex // serializa Iniciar/Detener/Reiniciar

	mu     sync.Mutex // protege los campos de abajo
	cancel context.CancelFunc
	fin    chan struct{} // se cierra cuando el bucle termina
	hijo   *proceso      // el lanzador que arrancamos nosotros (nil si adoptamos uno ajeno)
}

func nuevoLanzador(r Rutas, log *Registro) *Lanzador {
	return &Lanzador{rutas: r, log: log}
}

// puerto lee el puerto vigente (el estado puede cambiar entre ciclos).
func (l *Lanzador) puerto() int {
	est, _ := leerEstado(filepath.Join(l.rutas.StateDir, ".nexo-state.json"))
	return puertoSalud(est, os.Getenv)
}

func (l *Lanzador) saludOK() bool { return comprobarSalud(l.puerto()) }

// entornoLanzador hereda el del proceso. El modo, la GPU y el cable del micrófono los
// decide el lanzador a partir de .nexo-settings.json (el panel) y, si falta,
// de los valores por defecto; una variable de entorno explícita gana siempre.
func entornoLanzador() []string {
	return os.Environ()
}

func (l *Lanzador) arrancar() (*proceso, error) {
	node, err := rutaNode()
	if err != nil {
		return nil, err
	}
	return lanzarOculto(l.rutas.RepoRoot, entornoLanzador(), node, "launcher.js")
}

// Iniciar activa la supervisión (idempotente).
func (l *Lanzador) Iniciar() {
	l.opMu.Lock()
	defer l.opMu.Unlock()
	l.iniciarLocked()
}

func (l *Lanzador) iniciarLocked() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cancel != nil {
		return
	}
	// Iniciar es una orden explícita (arranque de la bandeja o «Reiniciar NEXO»):
	// anula cualquier parada deliberada anterior.
	quitarMarcadorDetenido(l.rutas)
	ctx, cancel := context.WithCancel(context.Background())
	fin := make(chan struct{})
	l.cancel, l.fin = cancel, fin
	go func() {
		defer close(fin)
		l.bucle(ctx)
	}()
}

// bucle adopta un NEXO que ya corra o arranca el propio, y lo relanza si muere.
func (l *Lanzador) bucle(ctx context.Context) {
	var esp espera
	for ctx.Err() == nil {
		// `node launcher.js --stop` (nexo-control stop) deja .nexo-stopped: NEXO se
		// detuvo a propósito y relanzarlo desharía la orden del dueño. Se espera a
		// que un arranque (nexo-control start, «Reiniciar NEXO») lo borre.
		if marcadorDetenido(l.rutas) {
			l.log.Printf("NEXO se detuvo a propósito: no se relanza hasta que alguien lo arranque")
			for marcadorDetenido(l.rutas) {
				if !dormir(ctx, 2*time.Second) {
					return
				}
			}
		}
		if l.saludOK() {
			l.log.Printf("NEXO ya responde en /health: se adopta, no se lanza otro")
			if !l.esperarCaidaAjena(ctx) {
				return
			}
			l.log.Printf("el NEXO adoptado dejó de responder más de %s", formatoDuracion(caidaAjena))
			continue // vuelve arriba: si fue una parada deliberada no se relanza
		}

		p, err := l.arrancar()
		if err != nil {
			d := esp.Siguiente(0)
			l.log.Printf("no se pudo lanzar node launcher.js: %v (reintento en %s)", err, formatoDuracion(d))
			if !dormir(ctx, d) {
				return
			}
			continue
		}
		l.mu.Lock()
		l.hijo = p
		l.mu.Unlock()
		l.log.Printf("lanzador arrancado (pid %d)", p.Pid())

		select {
		case <-ctx.Done():
			return // Detener se encarga del hijo
		case <-p.Hecho:
		}
		l.mu.Lock()
		if l.hijo == p {
			l.hijo = nil
		}
		l.mu.Unlock()

		vivio := time.Since(p.inicio)
		if esAdoptado(p.Codigo, vivio, l.saludOK()) {
			l.log.Printf("el lanzador salió con código 0 a los %s: había otra instancia viva, se adopta", formatoDuracion(vivio))
			continue
		}
		d := esp.Siguiente(vivio)
		l.log.Printf("el lanzador terminó (código %d tras %s): se relanza en %s", p.Codigo, formatoDuracion(vivio), formatoDuracion(d))
		if !dormir(ctx, d) {
			return
		}
	}
}

// esperarCaidaAjena bloquea mientras /health responda; devuelve true cuando
// lleva más de 15 s sin responder y false si se canceló ctx.
func (l *Lanzador) esperarCaidaAjena(ctx context.Context) bool {
	var desde time.Time
	for {
		if !dormir(ctx, intervaloSalud) {
			return false
		}
		if l.saludOK() {
			desde = time.Time{}
			continue
		}
		if desde.IsZero() {
			desde = time.Now()
		}
		if time.Since(desde) > caidaAjena {
			return true
		}
	}
}

func (l *Lanzador) hijoActual() *proceso {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.hijo
}

// Detener deja de supervisar y apaga NEXO de forma ordenada.
func (l *Lanzador) Detener() {
	l.opMu.Lock()
	defer l.opMu.Unlock()
	l.detenerLocked()
}

// Reiniciar = Detener + Iniciar con el mismo supervisor.
func (l *Lanzador) Reiniciar() {
	l.opMu.Lock()
	defer l.opMu.Unlock()
	l.detenerLocked()
	l.iniciarLocked()
}

func (l *Lanzador) detenerLocked() {
	l.mu.Lock()
	cancel, fin := l.cancel, l.fin
	l.cancel, l.fin = nil, nil
	l.mu.Unlock()
	if cancel != nil {
		cancel()
		<-fin
	}

	inicio := time.Now()
	hijo := l.hijoActual()
	l.log.Printf("deteniendo NEXO (node launcher.js --stop)")
	ok := l.ejecutarStop()

	if hijo != nil {
		if ok {
			// El --stop pidió el apagado ordenado: se le da lo que quede de los 20 s
			// para que el lanzador que arrancamos termine solo.
			resto := timeoutDetener - time.Since(inicio)
			if resto < time.Second {
				resto = time.Second
			}
			select {
			case <-hijo.Hecho:
			case <-time.After(resto):
				ok = false
			}
		}
		if !ok && !hijo.terminado() {
			l.log.Printf("apagado ordenado fallido o agotado: taskkill /T /F al pid %d", hijo.Pid())
			if err := matarArbol(hijo.Pid()); err != nil {
				l.log.Printf("taskkill falló: %v", err)
			}
		}
		l.mu.Lock()
		if l.hijo == hijo {
			l.hijo = nil
		}
		l.mu.Unlock()
	}

	// Esperar a que /health deje de responder (máx. 10 s) evita que un reinicio
	// «adopte» el NEXO que justo se está apagando.
	limite := time.Now().Add(10 * time.Second)
	for time.Now().Before(limite) && l.saludOK() {
		time.Sleep(500 * time.Millisecond)
	}
	l.log.Printf("NEXO detenido")
}

// ejecutarStop corre `node launcher.js --stop` (máx. 20 s). true = terminó con 0.
func (l *Lanzador) ejecutarStop() bool {
	node, err := rutaNode()
	if err != nil {
		l.log.Printf("--stop imposible: %v", err)
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeoutDetener)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, "launcher.js", "--stop")
	cmd.Dir = l.rutas.RepoRoot
	cmd.Env = entornoLanzador()
	ocultar(cmd)
	if err := cmd.Run(); err != nil {
		l.log.Printf("--stop terminó con error: %v", err)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Vigilante del aviso del enlace
// ---------------------------------------------------------------------------

type Vigilante struct {
	rutas Rutas
	log   *Registro

	mu     sync.Mutex
	cancel context.CancelFunc
	fin    chan struct{}
	hijo   *proceso
}

func nuevoVigilante(r Rutas, log *Registro) *Vigilante {
	return &Vigilante{rutas: r, log: log}
}

// rutaConfAviso es %APPDATA%\NEXO\nexo-aviso.conf; su existencia activa el vigilante.
func rutaConfAviso() string {
	return filepath.Join(os.Getenv("APPDATA"), "NEXO", "nexo-aviso.conf")
}

// Iniciar arranca el vigilante si hay configuración de aviso y existen pwsh y el
// script. Si algo falta lo anota y sigue (no es un error de la bandeja).
func (v *Vigilante) Iniciar() {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.cancel != nil {
		return
	}
	if os.Getenv("APPDATA") == "" {
		return
	}
	if _, err := os.Stat(rutaConfAviso()); err != nil {
		return // sin configuración de aviso no hay nada que vigilar
	}
	if leerAviso(rutaConfAviso()).Metodo == "ninguno" {
		return // configurado pero sin método: el script sólo repetiría «sin método de aviso»
	}
	pwsh, err := exec.LookPath("pwsh")
	if err != nil {
		v.log.Printf("hay nexo-aviso.conf pero pwsh no está en el PATH: el vigilante de aviso no se lanza")
		return
	}
	script := filepath.Join(v.rutas.RepoRoot, "scripts", "windows", "nexo-avisar-enlace.ps1")
	if _, err := os.Stat(script); err != nil {
		v.log.Printf("hay nexo-aviso.conf pero falta %s: el vigilante de aviso no se lanza", script)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	fin := make(chan struct{})
	v.cancel, v.fin = cancel, fin
	go func() {
		defer close(fin)
		v.bucle(ctx, pwsh, script)
	}()
}

func (v *Vigilante) bucle(ctx context.Context, pwsh, script string) {
	var esp espera
	for ctx.Err() == nil {
		p, err := lanzarOculto(v.rutas.RepoRoot, nil, pwsh,
			"-NoProfile", "-WindowStyle", "Hidden", "-File", script, "vigilar")
		if err != nil {
			d := esp.Siguiente(0)
			v.log.Printf("no se pudo lanzar el vigilante de aviso: %v (reintento en %s)", err, formatoDuracion(d))
			if !dormir(ctx, d) {
				return
			}
			continue
		}
		v.mu.Lock()
		v.hijo = p
		v.mu.Unlock()
		v.log.Printf("vigilante de aviso arrancado (pid %d)", p.Pid())

		select {
		case <-ctx.Done():
			return // Detener lo mata
		case <-p.Hecho:
		}
		vivio := time.Since(p.inicio)
		d := esp.Siguiente(vivio)
		v.log.Printf("el vigilante de aviso terminó (código %d tras %s): se relanza en %s", p.Codigo, formatoDuracion(vivio), formatoDuracion(d))
		if !dormir(ctx, d) {
			return
		}
	}
}

// Detener cancela la supervisión y mata el árbol del vigilante.
func (v *Vigilante) Detener() {
	v.mu.Lock()
	cancel, fin := v.cancel, v.fin
	v.cancel, v.fin = nil, nil
	v.mu.Unlock()
	if cancel != nil {
		cancel()
		<-fin // tras esto el bucle ya no arranca más hijos
	}
	v.mu.Lock()
	hijo := v.hijo
	v.hijo = nil
	v.mu.Unlock()
	if hijo != nil && !hijo.terminado() {
		if err := matarArbol(hijo.Pid()); err != nil {
			v.log.Printf("no se pudo matar el vigilante de aviso: %v", err)
		} else {
			v.log.Printf("vigilante de aviso detenido")
		}
	}
}

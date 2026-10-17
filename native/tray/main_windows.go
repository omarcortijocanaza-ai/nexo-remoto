// nexo-tray: bandeja de NEXO en Windows. Arranca (o adopta) el lanzador de NEXO,
// lo supervisa, y ofrece un menú para copiar enlaces, generar códigos de
// emparejamiento, abrir los registros, reiniciar y salir. Se compila con
// -H windowsgui: no abre consola en ningún momento.
package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"

	"fyne.io/systray"
	"golang.org/x/sys/windows"
)

// app agrupa el estado de la bandeja.
type app struct {
	rutas Rutas
	log   *Registro

	lanzador  *Lanzador
	vigilante *Vigilante

	ctx    context.Context
	cancel context.CancelFunc

	estadoItem  *systray.MenuItem
	itemRemoto  *systray.MenuItem
	itemLocal   *systray.MenuItem
	itemPar     *systray.MenuItem
	itemLogs    *systray.MenuItem
	itemReinit  *systray.MenuItem
	itemSalir   *systray.MenuItem
	iconos      map[Visual][]byte
	ultimo      Visual
	ultimoValid bool
	remotoOK    bool
	remotoValid bool

	parMu sync.Mutex // un solo «generar código» a la vez
}

func (a *app) rutaEstado() string {
	return filepath.Join(a.rutas.StateDir, ".nexo-state.json")
}

func main() {
	// Instancia única: si ya hay otra bandeja en esta sesión, salir sin ruido.
	nombre, _ := windows.UTF16PtrFromString(`Local\NEXO-Tray`)
	mutex, err := windows.CreateMutex(nil, false, nombre)
	if err == windows.ERROR_ALREADY_EXISTS {
		if mutex != 0 {
			windows.CloseHandle(mutex)
		}
		return
	}
	// Si CreateMutex falló por otra causa se sigue sin exclusión: peor es no tener bandeja.

	exe, err := os.Executable()
	if err != nil {
		return
	}
	rutas := calcularRutas(filepath.Dir(exe), os.Getenv)
	_ = os.MkdirAll(rutas.StateDir, 0o700)
	_ = os.MkdirAll(rutas.LogsDir, 0o700)

	log, _ := abrirRegistro(rutas.LogsDir) // sin log se sigue igual (Registro nil es válido)
	defer log.Cerrar()
	defer func() {
		// Una aplicación windowsgui que entra en pánico desaparece sin dejar rastro.
		if r := recover(); r != nil {
			log.Printf("PÁNICO: %v\n%s", r, debug.Stack())
		}
	}()
	log.Printf("nexo-tray arrancando (repo=%s)", rutas.RepoRoot)

	ctx, cancel := context.WithCancel(context.Background())
	a := &app{
		rutas:     rutas,
		log:       log,
		lanzador:  nuevoLanzador(rutas, log),
		vigilante: nuevoVigilante(rutas, log),
		ctx:       ctx,
		cancel:    cancel,
		iconos:    map[Visual][]byte{},
	}
	systray.Run(a.alIniciar, a.alSalir)
	log.Printf("nexo-tray cerrado")
}

func (a *app) alIniciar() {
	for _, v := range []Visual{VisualDetenido, VisualConectando, VisualActivo} {
		ico, err := generarICO(colorDe(v))
		if err != nil {
			a.log.Printf("no se pudo generar el icono: %v", err)
			continue
		}
		a.iconos[v] = ico
	}
	a.aplicarVisual(VisualDetenido)

	a.estadoItem = systray.AddMenuItem(VisualDetenido.Texto(), "")
	a.estadoItem.Disable()
	systray.AddSeparator()
	a.itemRemoto = systray.AddMenuItem("Copiar enlace de Internet", "")
	a.itemRemoto.Disable()
	a.itemLocal = systray.AddMenuItem("Copiar enlace local", "")
	a.itemPar = systray.AddMenuItem("Generar código de emparejamiento", "")
	systray.AddSeparator()
	a.itemLogs = systray.AddMenuItem("Abrir registros", "")
	a.itemReinit = systray.AddMenuItem("Reiniciar NEXO", "")
	systray.AddSeparator()
	a.itemSalir = systray.AddMenuItem("Salir", "")

	a.lanzador.Iniciar()
	a.vigilante.Iniciar()

	go a.bucleEstado()
	go a.bucleMenu()
}

func (a *app) alSalir() {
	a.cancel()
	a.vigilante.Detener()
}

// aplicarVisual cambia icono y tooltip (sólo cuando el estado cambia).
func (a *app) aplicarVisual(v Visual) {
	if ico, ok := a.iconos[v]; ok {
		systray.SetIcon(ico)
	}
	systray.SetTooltip(v.Texto())
}

// bucleEstado consulta /health y el archivo de estado cada 3 s y actualiza la
// línea de estado, el icono, el tooltip y el elemento «enlace de Internet».
func (a *app) bucleEstado() {
	a.actualizar()
	t := time.NewTicker(intervaloSalud)
	defer t.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-t.C:
			a.actualizar()
		}
	}
}

func (a *app) actualizar() {
	est, _ := leerEstado(a.rutaEstado()) // error = no existe o está a medias: se reintenta luego
	salud := comprobarSalud(puertoSalud(est, os.Getenv))
	v := calcularVisual(salud, est)

	if !a.ultimoValid || v != a.ultimo {
		if a.ultimoValid {
			a.log.Printf("estado: %s", v.Texto())
		}
		a.ultimo, a.ultimoValid = v, true
		a.estadoItem.SetTitle(v.Texto())
		a.aplicarVisual(v)
	}
	hayRemoto := enlaceInternet(est) != ""
	if !a.remotoValid || hayRemoto != a.remotoOK {
		a.remotoOK, a.remotoValid = hayRemoto, true
		if hayRemoto {
			a.itemRemoto.Enable()
		} else {
			a.itemRemoto.Disable()
		}
	}
}

// bucleMenu atiende los clics. Las acciones largas van en su propia goroutine
// para no congelar el menú.
func (a *app) bucleMenu() {
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-a.itemRemoto.ClickedCh:
			go a.copiarEnlace(true)
		case <-a.itemLocal.ClickedCh:
			go a.copiarEnlace(false)
		case <-a.itemPar.ClickedCh:
			go a.generarCodigo()
		case <-a.itemLogs.ClickedCh:
			go a.abrirRegistros()
		case <-a.itemReinit.ClickedCh:
			go a.reiniciar()
		case <-a.itemSalir.ClickedCh:
			go a.salir()
		}
	}
}

// copiarEnlace relee el estado en el momento del clic (así el enlace nunca está
// desfasado). El enlace jamás se escribe en el registro.
func (a *app) copiarEnlace(internet bool) {
	est, _ := leerEstado(a.rutaEstado())
	var enlace, que string
	if internet {
		enlace, que = enlaceInternet(est), "de Internet"
	} else {
		enlace, que = enlaceLocal(est), "local"
	}
	if enlace == "" {
		a.log.Printf("copiar enlace %s: aún no disponible", que)
		mostrarMensaje("NEXO", "El enlace "+que+" todavía no está disponible. Espera unos segundos a que NEXO termine de arrancar.", mbIconWarning)
		return
	}
	if err := copiarAlPortapapeles(enlace); err != nil {
		a.log.Printf("copiar enlace %s: %v", que, err)
		mostrarMensaje("NEXO", "No se pudo copiar el enlace al portapapeles:\n"+err.Error(), mbIconError)
		return
	}
	a.log.Printf("enlace %s copiado al portapapeles", que)
}

// generarCodigo ejecuta `node scripts\pair.js` y muestra su salida entera.
func (a *app) generarCodigo() {
	if !a.parMu.TryLock() {
		return
	}
	defer a.parMu.Unlock()

	const titulo = "NEXO · Emparejar"
	node, err := rutaNode()
	if err != nil {
		a.log.Printf("emparejar: %v", err)
		mostrarMensaje(titulo, err.Error(), mbIconError)
		return
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, filepath.Join("scripts", "pair.js"))
	cmd.Dir = a.rutas.RepoRoot
	var salida, errores bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &errores
	ocultar(cmd)
	if err := cmd.Run(); err != nil {
		// Sólo se anota el fallo, no la salida (podría contener el código).
		a.log.Printf("emparejar: pair.js falló: %v", err)
		msg := limpiarSalida(errores.String())
		if msg == "" {
			msg = limpiarSalida(salida.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		mostrarMensaje(titulo, "No se pudo generar el código:\n\n"+msg, mbIconError)
		return
	}
	texto := limpiarSalida(salida.String())
	if texto == "" {
		texto = "El comando terminó bien pero no devolvió ningún texto."
	}
	a.log.Printf("emparejar: código generado")
	mostrarMensaje(titulo, texto, mbIconInfo)
}

func (a *app) abrirRegistros() {
	// Sin ocultar(): explorer.exe sí debe mostrar su ventana.
	cmd := exec.Command("explorer.exe", a.rutas.LogsDir)
	if err := cmd.Start(); err != nil {
		a.log.Printf("abrir registros: %v", err)
		return
	}
	go cmd.Wait() // explorer suele devolver 1; sólo se recoge para no dejar zombis
}

func (a *app) reiniciar() {
	if !a.lanzador.opMu.TryLock() {
		return // ya hay un reinicio o una parada en curso
	}
	a.lanzador.opMu.Unlock()

	a.itemReinit.Disable()
	defer a.itemReinit.Enable()
	a.log.Printf("reinicio de NEXO solicitado desde el menú")
	a.lanzador.Reiniciar()
	a.vigilante.Detener()
	a.vigilante.Iniciar() // por si nexo-aviso.conf apareció (o desapareció) desde el arranque
}

func (a *app) salir() {
	a.itemSalir.SetTitle("Saliendo…")
	a.itemSalir.Disable()
	a.log.Printf("salida solicitada desde el menú")
	a.lanzador.Detener()
	systray.Quit()
}

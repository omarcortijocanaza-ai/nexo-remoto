package main

// Abrir la ventana del panel: Edge en modo aplicación (sin barra de direcciones) y
// el archivo .nexo-panel.json con el que una segunda ejecución (el acceso directo
// del menú Inicio) encuentra la bandeja que ya corre.

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const nombreArchivoPanel = ".nexo-panel.json"

// infoPanel es lo que la bandeja en marcha deja para quien quiera abrir el panel.
type infoPanel struct {
	Puerto int    `json:"puerto"`
	Clave  string `json:"clave"`
	Pid    int    `json:"pid"`
}

func rutaInfoPanel(r Rutas) string { return filepath.Join(r.StateDir, nombreArchivoPanel) }

func guardarInfoPanel(r Rutas, info infoPanel) error {
	datos, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return escribirAtomico(rutaInfoPanel(r), datos)
}

func leerInfoPanel(r Rutas) (infoPanel, bool) {
	var info infoPanel
	datos, err := os.ReadFile(rutaInfoPanel(r))
	if err != nil || json.Unmarshal(datos, &info) != nil || info.Puerto <= 0 || info.Clave == "" || info.Pid <= 0 {
		return info, false
	}
	return info, true
}

func borrarInfoPanel(r Rutas) { _ = os.Remove(rutaInfoPanel(r)) }

// procesoVivo dice si hay un proceso en marcha con ese PID (sirve también para
// los elevados: basta el permiso de consulta limitada).
func procesoVivo(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	var codigo uint32
	if windows.GetExitCodeProcess(h, &codigo) != nil {
		return false
	}
	return codigo == 259 // STILL_ACTIVE
}

func esElevado() bool { return windows.GetCurrentProcessToken().IsElevated() }

// buscarEdge devuelve la ruta de msedge.exe (viene con Windows 10/11).
func buscarEdge() string {
	if p, err := exec.LookPath("msedge"); err == nil {
		return p
	}
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles")} {
		if base == "" {
			continue
		}
		candidato := filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe")
		if _, err := os.Stat(candidato); err == nil {
			return candidato
		}
	}
	return ""
}

// abrirVentanaPanel abre la dirección en una ventana de aplicación. Con un perfil
// propio de Edge: así siempre se abre una ventana nueva y sin las extensiones ni
// las pestañas del usuario. Si la bandeja está elevada, Edge se lanza SIN elevar:
// un navegador con permisos de administrador no tiene por qué existir.
func abrirVentanaPanel(rutas Rutas, url string) error {
	edge := buscarEdge()
	if edge == "" {
		// Sin Edge: el navegador predeterminado, en una pestaña normal.
		cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
		ocultar(cmd)
		return cmd.Start()
	}
	perfil := filepath.Join(rutas.StateDir, "panel-edge")
	_ = os.MkdirAll(perfil, 0o700)
	args := []string{"--app=" + url, "--window-size=1040,780", "--user-data-dir=" + perfil, "--no-first-run", "--disable-extensions", "--disable-sync"}
	if esElevado() {
		if _, err := lanzarSinElevar(edge, args); err == nil {
			return nil
		}
	}
	cmd := exec.Command(edge, args...)
	return cmd.Start()
}

var (
	modUser32                    = windows.NewLazySystemDLL("user32.dll")
	modAdvapi32                  = windows.NewLazySystemDLL("advapi32.dll")
	procGetShellWindow           = modUser32.NewProc("GetShellWindow")
	procGetWindowThreadProcessID = modUser32.NewProc("GetWindowThreadProcessId")
	procCreateProcessWithTokenW  = modAdvapi32.NewProc("CreateProcessWithTokenW")
)

// lanzarSinElevar arranca un programa con el token del escritorio (el del
// Explorador, sin elevar) desde un proceso elevado: es la forma estándar de
// «desescalar». Falla si no hay Explorador o falta el privilegio.
func lanzarSinElevar(exe string, args []string) (uint32, error) {
	hwnd, _, _ := procGetShellWindow.Call()
	if hwnd == 0 {
		return 0, errors.New("no hay ventana de shell")
	}
	var pid uint32
	procGetWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return 0, errors.New("no se pudo obtener el proceso del Explorador")
	}
	proceso, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(proceso)
	var tokenShell windows.Token
	if err := windows.OpenProcessToken(proceso, windows.TOKEN_DUPLICATE, &tokenShell); err != nil {
		return 0, err
	}
	defer tokenShell.Close()
	var tokenPrimario windows.Token
	const acceso = windows.TOKEN_QUERY | windows.TOKEN_ASSIGN_PRIMARY | windows.TOKEN_DUPLICATE | windows.TOKEN_ADJUST_DEFAULT | windows.TOKEN_ADJUST_SESSIONID
	if err := windows.DuplicateTokenEx(tokenShell, acceso, nil, windows.SecurityImpersonation, windows.TokenPrimary, &tokenPrimario); err != nil {
		return 0, err
	}
	defer tokenPrimario.Close()

	linea, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{exe}, args...)))
	if err != nil {
		return 0, err
	}
	aplicacion, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return 0, err
	}
	var inicio windows.StartupInfo
	inicio.Cb = uint32(unsafe.Sizeof(inicio))
	var info windows.ProcessInformation
	r, _, e := procCreateProcessWithTokenW.Call(uintptr(tokenPrimario), 0, uintptr(unsafe.Pointer(aplicacion)), uintptr(unsafe.Pointer(linea)),
		0, 0, 0, uintptr(unsafe.Pointer(&inicio)), uintptr(unsafe.Pointer(&info)))
	if r == 0 {
		if e != nil && e != syscall.Errno(0) {
			return 0, e
		}
		return 0, errors.New("CreateProcessWithTokenW falló")
	}
	windows.CloseHandle(info.Thread)
	windows.CloseHandle(info.Process)
	return info.ProcessId, nil
}

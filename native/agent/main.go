//go:build windows

package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

const agentVersion = "1"

var (
	modUser32   = syscall.NewLazyDLL("user32.dll")
	modShcore   = syscall.NewLazyDLL("shcore.dll")
	modKernel32 = syscall.NewLazyDLL("kernel32.dll")
	modAdvapi32 = syscall.NewLazyDLL("advapi32.dll")

	procSetProcessDpiAwarenessContext = modUser32.NewProc("SetProcessDpiAwarenessContext")
	procSetProcessDpiAwareness        = modShcore.NewProc("SetProcessDpiAwareness")
	procSetProcessDPIAware            = modUser32.NewProc("SetProcessDPIAware")
)

// enableDpiAwareness activa PER_MONITOR_AWARE_V2 antes de cualquier llamada de
// ventanas o DXGI para que todas las coordenadas estén en píxeles físicos reales.
func enableDpiAwareness() bool {
	// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (DPI_AWARENESS_CONTEXT)-4
	if err := procSetProcessDpiAwarenessContext.Find(); err == nil {
		minusFour := ^uintptr(3)
		r1, _, _ := procSetProcessDpiAwarenessContext.Call(minusFour)
		if r1 != 0 {
			return true
		}
	}
	if err := procSetProcessDpiAwareness.Find(); err == nil {
		// PROCESS_PER_MONITOR_DPI_AWARE = 2
		r1, _, _ := procSetProcessDpiAwareness.Call(2)
		if r1 == 0 {
			return true
		}
	}
	if err := procSetProcessDPIAware.Find(); err == nil {
		r1, _, _ := procSetProcessDPIAware.Call()
		if r1 != 0 {
			return true
		}
	}
	return false
}

func main() {
	runtime.LockOSThread()
	dpiAware := enableDpiAwareness()
	attachDefaultDesktop()

	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Uso: nexo-agent <serve|audio-loopback|audio-play|audio-devices|version>")
		os.Exit(2)
	}

	subcmd := os.Args[1]
	switch subcmd {
	case "version":
		fmt.Println(agentVersion)
	case "serve":
		runServe(dpiAware)
	case "audio-devices":
		if err := runAudioDevices(); err != nil {
			fmt.Fprintf(os.Stderr, "Error al listar dispositivos de audio: %v\n", err)
			os.Exit(1)
		}
	case "audio-loopback":
		fs := flag.NewFlagSet("audio-loopback", flag.ExitOnError)
		rate := fs.Int("rate", 48000, "Frecuencia de muestreo de salida")
		channels := fs.Int("channels", 2, "Canales de salida")
		_ = fs.Parse(os.Args[2:])
		if err := runAudioLoopback(*rate, *channels); err != nil {
			fmt.Fprintf(os.Stderr, "Error en audio-loopback: %v\n", err)
			os.Exit(1)
		}
	case "audio-play":
		fs := flag.NewFlagSet("audio-play", flag.ExitOnError)
		match := fs.String("match", "", "Texto que debe contener el nombre del dispositivo de salida")
		rate := fs.Int("rate", 48000, "Frecuencia de muestreo de entrada")
		channels := fs.Int("channels", 1, "Canales de entrada")
		_ = fs.Parse(os.Args[2:])
		code, err := runAudioPlay(*match, *rate, *channels)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error en audio-play: %v\n", err)
			os.Exit(code)
		}
	default:
		fmt.Fprintf(os.Stderr, "Subcomando desconocido: %s\n", subcmd)
		os.Exit(2)
	}
}

func currentProcessElevated() bool {
	var token syscall.Token
	err := syscall.OpenProcessToken(syscall.Handle(^uintptr(0)), syscall.TOKEN_QUERY, &token)
	if err != nil {
		return false
	}
	defer token.Close()
	var elevation uint32
	var returned uint32
	// TokenElevation = 20
	err = syscall.GetTokenInformation(token, 20, (*byte)(unsafe.Pointer(&elevation)), 4, &returned)
	if err != nil {
		return false
	}
	return elevation != 0
}

func currentSessionID() uint32 {
	procProcessIdToSessionId := modKernel32.NewProc("ProcessIdToSessionId")
	pid := uint32(os.Getpid())
	var sessionID uint32
	r1, _, _ := procProcessIdToSessionId.Call(uintptr(pid), uintptr(unsafe.Pointer(&sessionID)))
	if r1 == 0 {
		return 0
	}
	return sessionID
}

func currentUserName() string {
	if u := os.Getenv("USERNAME"); u != "" {
		return u
	}
	return "Letzus"
}

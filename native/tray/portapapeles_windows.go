package main

// Portapapeles y MessageBox con la API de Windows (sin dependencias extra).

import (
	"errors"
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procOpenClipboard    = user32.NewProc("OpenClipboard")
	procCloseClipboard   = user32.NewProc("CloseClipboard")
	procEmptyClipboard   = user32.NewProc("EmptyClipboard")
	procSetClipboardData = user32.NewProc("SetClipboardData")
	procGetClipboardData = user32.NewProc("GetClipboardData")

	procGlobalAlloc  = kernel32.NewProc("GlobalAlloc")
	procGlobalLock   = kernel32.NewProc("GlobalLock")
	procGlobalUnlock = kernel32.NewProc("GlobalUnlock")
	procGlobalFree   = kernel32.NewProc("GlobalFree")
)

// abrirPortapapeles reintenta hasta 10 veces con 10 ms: otro programa (gestor
// de portapapeles, escritorio remoto) puede tenerlo abierto un instante.
func abrirPortapapeles() error {
	var ultimo error
	for i := 0; i < 10; i++ {
		r, _, err := procOpenClipboard.Call(0)
		if r != 0 {
			return nil
		}
		ultimo = err
		time.Sleep(10 * time.Millisecond)
	}
	return fmt.Errorf("no se pudo abrir el portapapeles: %v", ultimo)
}

// punteroDe convierte la dirección que devuelve GlobalLock en unsafe.Pointer
// sin que `go vet` proteste por la conversión uintptr -> unsafe.Pointer (la
// memoria es del sistema y sigue bloqueada, no hay riesgo de que se mueva).
func punteroDe(dir uintptr) unsafe.Pointer {
	var p unsafe.Pointer
	*(*uintptr)(unsafe.Pointer(&p)) = dir
	return p
}

// copiarAlPortapapeles deja texto como CF_UNICODETEXT (UTF-16 con terminador).
func copiarAlPortapapeles(texto string) error {
	u16, err := windows.UTF16FromString(texto) // ya incluye el terminador 0
	if err != nil {
		return err
	}
	if err := abrirPortapapeles(); err != nil {
		return err
	}
	defer procCloseClipboard.Call()

	if r, _, e := procEmptyClipboard.Call(); r == 0 {
		return fmt.Errorf("EmptyClipboard: %v", e)
	}
	tam := uintptr(len(u16) * 2)
	h, _, e := procGlobalAlloc.Call(gmemMoveable, tam)
	if h == 0 {
		return fmt.Errorf("GlobalAlloc: %v", e)
	}
	dir, _, e := procGlobalLock.Call(h)
	if dir == 0 {
		procGlobalFree.Call(h)
		return fmt.Errorf("GlobalLock: %v", e)
	}
	copy(unsafe.Slice((*uint16)(punteroDe(dir)), len(u16)), u16)
	procGlobalUnlock.Call(h)

	if r, _, e := procSetClipboardData.Call(cfUnicodeText, h); r == 0 {
		// Si SetClipboardData falla, la memoria sigue siendo nuestra: se libera.
		procGlobalFree.Call(h)
		return fmt.Errorf("SetClipboardData: %v", e)
	}
	// Con éxito el sistema es el dueño de h: no se libera.
	return nil
}

// leerPortapapeles lo usa sólo la prueba opcional de ida y vuelta.
func leerPortapapeles() (string, error) {
	if err := abrirPortapapeles(); err != nil {
		return "", err
	}
	defer procCloseClipboard.Call()
	h, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if h == 0 {
		return "", errors.New("el portapapeles no contiene texto Unicode")
	}
	dir, _, _ := procGlobalLock.Call(h)
	if dir == 0 {
		return "", errors.New("GlobalLock falló")
	}
	defer procGlobalUnlock.Call(h)
	return windows.UTF16PtrToString((*uint16)(punteroDe(dir))), nil
}

// Estilos de MessageBox.
const (
	mbOK          = 0x00000000
	mbIconError   = 0x00000010
	mbIconWarning = 0x00000030
	mbIconInfo    = 0x00000040
	// Primer plano y encima de todo: la bandeja no tiene ventana propia desde la
	// que «heredar» el foco y el aviso podría quedar escondido.
	mbSetForeground = 0x00010000
	mbTopMost       = 0x00040000
)

// mostrarMensaje abre un MessageBox con un solo botón Aceptar. Bloquea hasta
// que se cierra, así que debe llamarse desde una goroutine propia.
func mostrarMensaje(titulo, texto string, icono uint32) {
	t, err1 := windows.UTF16PtrFromString(texto)
	c, err2 := windows.UTF16PtrFromString(titulo)
	if err1 != nil || err2 != nil {
		return
	}
	windows.MessageBox(0, t, c, mbOK|icono|mbSetForeground|mbTopMost)
}

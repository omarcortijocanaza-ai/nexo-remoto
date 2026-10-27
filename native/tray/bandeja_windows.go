package main

// Preparativos para que Windows acepte el icono de la bandeja al iniciar sesión.
//
// La tarea «NEXO» se dispara en cuanto el usuario inicia sesión, a menudo antes
// de que el Explorador haya creado la barra de tareas. En ese momento
// Shell_NotifyIcon falla y fyne.io/systray no lo vuelve a intentar: nunca llama
// a onReady ni construye el menú. El 2026-10-27 eso dejó la bandeja viva, sin
// icono y —con el binario anterior, que lo arrancaba todo desde onReady— sin
// NEXO. Por eso se espera a la barra de tareas antes de registrar el icono.

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procFindWindowW               = modUser32.NewProc("FindWindowW")
	procFindWindowExW             = modUser32.NewProc("FindWindowExW")
	procRegisterWindowMessageW    = modUser32.NewProc("RegisterWindowMessageW")
	procChangeWindowMessageFilter = modUser32.NewProc("ChangeWindowMessageFilter")
)

// barraDeTareasLista indica si existen la barra de tareas y su área de
// notificación, que es donde vive el icono.
func barraDeTareasLista() bool {
	clase, _ := windows.UTF16PtrFromString("Shell_TrayWnd")
	barra, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(clase)), 0)
	if barra == 0 {
		return false
	}
	area, _ := windows.UTF16PtrFromString("TrayNotifyWnd")
	notif, _, _ := procFindWindowExW.Call(barra, 0, uintptr(unsafe.Pointer(area)), 0)
	return notif != 0
}

// esperarBarraDeTareas espera como mucho «limite» a que aparezca la barra de
// tareas. Al aparecer deja un margen corto: el Explorador crea la ventana un
// instante antes de aceptar iconos. Devuelve false si se agotó el tiempo.
func esperarBarraDeTareas(limite time.Duration) bool {
	fin := time.Now().Add(limite)
	for {
		if barraDeTareasLista() {
			time.Sleep(2 * time.Second)
			return true
		}
		if time.Now().After(fin) {
			return false
		}
		time.Sleep(time.Second)
	}
}

// permitirAvisoDeBarra deja pasar «TaskbarCreated» a esta bandeja elevada. El
// Explorador corre con integridad media y Windows (UIPI) descarta sus mensajes
// a ventanas de administrador; sin este permiso, systray no vuelve a poner el
// icono cuando el Explorador se reinicia. Afecta a todo el proceso, que es lo
// que hace falta: la ventana la crea la biblioteca y no la tenemos a mano.
func permitirAvisoDeBarra() error {
	const msgfltAdd = 1
	nombre, _ := windows.UTF16PtrFromString("TaskbarCreated")
	msg, _, err := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(nombre)))
	if msg == 0 {
		return err
	}
	if r, _, err := procChangeWindowMessageFilter.Call(msg, msgfltAdd); r == 0 {
		return err
	}
	return nil
}

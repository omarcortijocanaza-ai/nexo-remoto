//go:build windows

// NEXO keyboard bridge forwards a few browser-reserved shortcuts while a Nexo
// window is in the foreground. Super is activated directly with AltGr by the
// web client; Windows and Right Control retain their normal local behavior.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"unsafe"
)

const (
	whKeyboardLL   = 13
	wmKeyDown      = 0x0100
	wmKeyUp        = 0x0101
	wmSysKeyDown   = 0x0104
	wmSysKeyUp     = 0x0105
	vkTab          = 0x09
	vkControl      = 0x11
	vkShift        = 0x10
	vkC            = 0x43
	vkV            = 0x56
	vkF4           = 0x73
	vkF13          = 0x7C
	vkF14          = 0x7D
	vkF15          = 0x7E
	vkF16          = 0x7F
	keyeventfKeyUp = 0x0002
	llkhfInjected  = 0x00000010
)

type keyboardEvent struct {
	vkCode    uint32
	scanCode  uint32
	flags     uint32
	time      uint32
	extraInfo uintptr
}

type point struct{ x, y int32 }
type message struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
	private uint32
}

var (
	user32              = syscall.NewLazyDLL("user32.dll")
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	setWindowsHookEx    = user32.NewProc("SetWindowsHookExW")
	unhookWindowsHookEx = user32.NewProc("UnhookWindowsHookEx")
	callNextHookEx      = user32.NewProc("CallNextHookEx")
	getMessage          = user32.NewProc("GetMessageW")
	translateMessage    = user32.NewProc("TranslateMessage")
	dispatchMessage     = user32.NewProc("DispatchMessageW")
	getForegroundWindow = user32.NewProc("GetForegroundWindow")
	getWindowText       = user32.NewProc("GetWindowTextW")
	getAsyncKeyState    = user32.NewProc("GetAsyncKeyState")
	keybdEvent          = user32.NewProc("keybd_event")
	getModuleHandle     = kernel32.NewProc("GetModuleHandleW")
	hookHandle          uintptr
	altTabHeld          bool
	altF4Held           bool
	copyHeld            bool
	pasteHeld           bool
)

func nexoIsForeground() bool {
	hwnd, _, _ := getForegroundWindow.Call()
	if hwnd == 0 {
		return false
	}
	buf := make([]uint16, 512)
	n, _, _ := getWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return false
	}
	title := strings.ToLower(syscall.UTF16ToString(buf[:n]))
	return strings.Contains(title, "nexo") && strings.Contains(title, "control remoto")
}

func sendKey(vk uintptr) {
	keybdEvent.Call(vk, 0, 0, 0)
	keybdEvent.Call(vk, 0, keyeventfKeyUp, 0)
}

func keyIsDown(vk uintptr) bool {
	state, _, _ := getAsyncKeyState.Call(vk)
	return state&0x8000 != 0
}

func keyboardHook(code int, wParam, lParam uintptr) uintptr {
	if code >= 0 {
		event := (*keyboardEvent)(unsafe.Pointer(lParam))
		isDown := wParam == wmKeyDown || wParam == wmSysKeyDown
		isUp := wParam == wmKeyUp || wParam == wmSysKeyUp
		// Chrome reserves Ctrl+Shift+C for its element inspector and may consume
		// it before JavaScript sees it. Hide the physical C from Chrome and send
		// F15 instead; the NEXO client turns that private key back into the exact
		// remote Ctrl+Shift+C shortcut.
		if event.flags&llkhfInjected == 0 && event.vkCode == vkC {
			if isDown && (copyHeld || (nexoIsForeground() && keyIsDown(vkControl) && keyIsDown(vkShift))) {
				if !copyHeld {
					copyHeld = true
					sendKey(vkF15)
				}
				return 1
			}
			if isUp && copyHeld {
				copyHeld = false
				return 1
			}
		}
		if event.flags&llkhfInjected == 0 && event.vkCode == vkV {
			if isDown && (pasteHeld || (nexoIsForeground() && keyIsDown(vkControl) && keyIsDown(vkShift))) {
				if !pasteHeld {
					pasteHeld = true
					sendKey(vkF16)
				}
				return 1
			}
			if isUp && pasteHeld {
				pasteHeld = false
				return 1
			}
		}
		// Windows reserves Alt+Tab and Alt+F4 before a web page can receive
		// them. While NEXO is focused, translate them to F13/F14. The web
		// client recognizes those private bridge keys and performs the remote
		// shortcut; no typed content is observed or transmitted by this helper.
		if event.flags&llkhfInjected == 0 && event.vkCode == vkTab {
			if isDown && wParam == wmSysKeyDown && (altTabHeld || nexoIsForeground()) {
				altTabHeld = true
				sendKey(vkF13)
				return 1
			}
			if isUp && altTabHeld {
				altTabHeld = false
				return 1
			}
		}
		if event.flags&llkhfInjected == 0 && event.vkCode == vkF4 {
			if isDown && wParam == wmSysKeyDown && (altF4Held || nexoIsForeground()) {
				altF4Held = true
				sendKey(vkF14)
				return 1
			}
			if isUp && altF4Held {
				altF4Held = false
				return 1
			}
		}
	}
	result, _, _ := callNextHookEx.Call(hookHandle, uintptr(code), wParam, lParam)
	return result
}

func releaseAndUnhook() {
	copyHeld = false
	pasteHeld = false
	if hookHandle != 0 {
		unhookWindowsHookEx.Call(hookHandle)
	}
}

func main() {
	fmt.Println("NEXO Keyboard Bridge activo")
	fmt.Println("Usa AltGr como Super remoto; Windows y Ctrl derecho quedan libres.")
	fmt.Println("El puente entrega Alt+Tab, Alt+F4 y Ctrl+Shift+C/V a NEXO.")

	module, _, _ := getModuleHandle.Call(0)
	callback := syscall.NewCallback(keyboardHook)
	hookHandle, _, _ = setWindowsHookEx.Call(whKeyboardLL, callback, module, 0)
	if hookHandle == 0 {
		fmt.Println("No se pudo activar el puente de teclado.")
		fmt.Println("Pulsa Enter para salir.")
		fmt.Scanln()
		os.Exit(1)
	}
	defer releaseAndUnhook()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	go func() {
		<-signals
		releaseAndUnhook()
		os.Exit(0)
	}()

	var msg message
	for {
		result, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) <= 0 {
			return
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

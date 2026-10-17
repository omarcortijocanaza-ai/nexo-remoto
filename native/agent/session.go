//go:build windows

package main

import (
	"fmt"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"golang.org/x/sys/windows"
)

const (
	uoiName             = 2
	desktopReadObjects  = 0x0001
	genericAllAccess    = 0x10000000
	esContinuous        = 0x80000000
	esSystemRequired    = 0x00000001
	esDisplayRequired   = 0x00000002
)

var (
	procOpenInputDesktop          = modUser32.NewProc("OpenInputDesktop")
	procOpenDesktopW              = modUser32.NewProc("OpenDesktopW")
	procCloseDesktop              = modUser32.NewProc("CloseDesktop")
	procSetThreadDesktop          = modUser32.NewProc("SetThreadDesktop")
	procGetUserObjectInformationW = modUser32.NewProc("GetUserObjectInformationW")
	procSetThreadExecutionState   = modKernel32.NewProc("SetThreadExecutionState")
)

type keepAwakeReq struct {
	on   bool
	done chan struct{}
}

var keepAwakeCh = make(chan keepAwakeReq, 8)

// attachDefaultDesktop asocia el hilo actual al escritorio interactivo "Default"
// si el proceso fue lanzado desde un escritorio aislado (p. ej. un ejecutor de pruebas).
func attachDefaultDesktop() {
	namePtr, err := syscall.UTF16PtrFromString("Default")
	if err != nil {
		return
	}
	hDesk, _, _ := procOpenDesktopW.Call(
		uintptr(unsafe.Pointer(namePtr)),
		0,
		0,
		genericAllAccess,
	)
	if hDesk == 0 {
		return
	}
	r1, _, _ := procSetThreadDesktop.Call(hDesk)
	if r1 == 0 {
		procCloseDesktop.Call(hDesk)
	}
}

func getDesktopState() string {
	hDesk, _, _ := procOpenInputDesktop.Call(0, 0, desktopReadObjects)
	if hDesk == 0 {
		return "secure"
	}
	defer procCloseDesktop.Call(hDesk)

	var buf [256]uint16
	var needed uint32
	r1, _, _ := procGetUserObjectInformationW.Call(
		hDesk,
		uoiName,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)*2),
		uintptr(unsafe.Pointer(&needed)),
	)
	if r1 == 0 {
		return "secure"
	}
	name := windows.UTF16ToString(buf[:])
	if strings.EqualFold(name, "Default") {
		return "normal"
	}
	return "secure"
}

func startKeepAwakeWorker() {
	go func() {
		runtime.LockOSThread()
		for req := range keepAwakeCh {
			flags := uintptr(esContinuous)
			if req.on {
				flags |= esSystemRequired | esDisplayRequired
			}
			procSetThreadExecutionState.Call(flags)
			close(req.done)
		}
	}()
}

func setKeepAwake(on bool) {
	done := make(chan struct{})
	keepAwakeCh <- keepAwakeReq{on: on, done: done}
	<-done
}

func monitorsSignature(mons []monitorInfo, virt virtualBounds) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "%d,%d,%d,%d|", virt.X, virt.Y, virt.Width, virt.Height)
	for _, m := range mons {
		fmt.Fprintf(&sb, "%d:%s:%d,%d,%d,%d,%t,%d;", m.Index, m.Name, m.X, m.Y, m.Width, m.Height, m.Primary, m.Rotation)
	}
	return sb.String()
}

func startSessionMonitors(stopCh <-chan struct{}) {
	// Sondeo de estado de escritorio cada 500 ms.
	go func() {
		lastState := getDesktopState()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				st := getDesktopState()
				if st != lastState {
					lastState = st
					writeJSONLine(map[string]any{
						"event": "desktop",
						"state": st,
					})
				}
			}
		}
	}()

	// Sondeo de cambios de monitores cada 2 s en un hilo con COM inicializado.
	go func() {
		runtime.LockOSThread()
		attachDefaultDesktop()
		_ = ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED)
		defer ole.CoUninitialize()

		var lastSig string
		if mons, virt, err := queryMonitors(); err == nil {
			lastSig = monitorsSignature(mons, virt)
		}

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				mons, virt, err := queryMonitors()
				if err != nil {
					continue
				}
				sig := monitorsSignature(mons, virt)
				if lastSig != "" && sig != lastSig {
					writeJSONLine(map[string]any{
						"event": "displays-changed",
					})
				}
				lastSig = sig
			}
		}
	}()
}

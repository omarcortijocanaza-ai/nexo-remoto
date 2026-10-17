//go:build windows

package main

import (
	"fmt"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
)

var (
	procOpenClipboard              = modUser32.NewProc("OpenClipboard")
	procCloseClipboard             = modUser32.NewProc("CloseClipboard")
	procEmptyClipboard             = modUser32.NewProc("EmptyClipboard")
	procIsClipboardFormatAvailable = modUser32.NewProc("IsClipboardFormatAvailable")
	procGetClipboardData           = modUser32.NewProc("GetClipboardData")
	procSetClipboardData           = modUser32.NewProc("SetClipboardData")

	procGlobalAlloc   = modKernel32.NewProc("GlobalAlloc")
	procGlobalFree    = modKernel32.NewProc("GlobalFree")
	procGlobalLock    = modKernel32.NewProc("GlobalLock")
	procGlobalUnlock  = modKernel32.NewProc("GlobalUnlock")
	procRtlMoveMemory = modKernel32.NewProc("RtlMoveMemory")
	procLstrlenW      = modKernel32.NewProc("lstrlenW")
)

func openClipboardWithRetry() error {
	var lastErr error
	for attempt := 0; attempt < 10; attempt++ {
		r1, _, err := procOpenClipboard.Call(0)
		if r1 != 0 {
			return nil
		}
		lastErr = err
		time.Sleep(10 * time.Millisecond)
	}
	return fmt.Errorf("No se pudo abrir el portapapeles tras 10 intentos: %v", lastErr)
}

func getClipboardText() (string, error) {
	if err := openClipboardWithRetry(); err != nil {
		return "", err
	}
	defer procCloseClipboard.Call()

	avail, _, _ := procIsClipboardFormatAvailable.Call(cfUnicodeText)
	if avail == 0 {
		return "", nil
	}

	hMem, _, err := procGetClipboardData.Call(cfUnicodeText)
	if hMem == 0 {
		return "", fmt.Errorf("GetClipboardData falló: %v", err)
	}

	ptr, _, err := procGlobalLock.Call(hMem)
	if ptr == 0 {
		return "", fmt.Errorf("GlobalLock falló: %v", err)
	}
	defer procGlobalUnlock.Call(hMem)

	charLen, _, _ := procLstrlenW.Call(ptr)
	if charLen == 0 {
		return "", nil
	}
	buf := make([]uint16, int(charLen)+1)
	procRtlMoveMemory.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		ptr,
		charLen*2,
	)
	return windows.UTF16ToString(buf), nil
}

func setClipboardText(text string) error {
	if err := openClipboardWithRetry(); err != nil {
		return err
	}
	defer procCloseClipboard.Call()

	r1, _, err := procEmptyClipboard.Call()
	if r1 == 0 {
		return fmt.Errorf("EmptyClipboard falló: %v", err)
	}

	encoded := append(utf16.Encode([]rune(text)), 0)
	byteLen := uintptr(len(encoded) * 2)

	hMem, _, err := procGlobalAlloc.Call(gmemMoveable, byteLen)
	if hMem == 0 {
		return fmt.Errorf("GlobalAlloc falló: %v", err)
	}

	ptr, _, err := procGlobalLock.Call(hMem)
	if ptr == 0 {
		procGlobalFree.Call(hMem)
		return fmt.Errorf("GlobalLock falló: %v", err)
	}

	procRtlMoveMemory.Call(
		ptr,
		uintptr(unsafe.Pointer(&encoded[0])),
		byteLen,
	)
	procGlobalUnlock.Call(hMem)

	rSet, _, err := procSetClipboardData.Call(cfUnicodeText, hMem)
	if rSet == 0 {
		procGlobalFree.Call(hMem)
		return fmt.Errorf("SetClipboardData falló: %v", err)
	}
	return nil
}

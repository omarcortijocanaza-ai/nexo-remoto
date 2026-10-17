//go:build windows

package main

import (
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procGetForegroundWindow      = modUser32.NewProc("GetForegroundWindow")
	procGetWindowTextLengthW     = modUser32.NewProc("GetWindowTextLengthW")
	procGetWindowTextW           = modUser32.NewProc("GetWindowTextW")
	procGetWindowThreadProcessId = modUser32.NewProc("GetWindowThreadProcessId")
)

type foregroundInfo struct {
	Title    string `json:"title"`
	Process  string `json:"process"`
	Elevated bool   `json:"elevated"`
}

func getWindowTitle(hwnd uintptr) string {
	length, _, _ := procGetWindowTextLengthW.Call(hwnd)
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), length+1)
	return windows.UTF16ToString(buf)
}

func getForegroundInfo() foregroundInfo {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return foregroundInfo{Title: "", Process: "", Elevated: false}
	}
	title := getWindowTitle(hwnd)
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return foregroundInfo{Title: title, Process: "", Elevated: false}
	}

	hProc, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		// Si no se puede abrir el proceso, se asume elevado (UIPI).
		return foregroundInfo{Title: title, Process: "", Elevated: true}
	}
	defer windows.CloseHandle(hProc)

	procName := ""
	var exeBuf [windows.MAX_PATH]uint16
	size := uint32(len(exeBuf))
	if err := windows.QueryFullProcessImageName(hProc, 0, &exeBuf[0], &size); err == nil {
		procName = filepath.Base(windows.UTF16ToString(exeBuf[:size]))
	}

	elevated := true
	var tok windows.Token
	if err := windows.OpenProcessToken(hProc, windows.TOKEN_QUERY, &tok); err == nil {
		defer tok.Close()
		var tokenElev uint32
		var retLen uint32
		if err := windows.GetTokenInformation(tok, windows.TokenElevation, (*byte)(unsafe.Pointer(&tokenElev)), 4, &retLen); err == nil {
			elevated = tokenElev != 0
		}
	}

	return foregroundInfo{
		Title:    title,
		Process:  procName,
		Elevated: elevated,
	}
}

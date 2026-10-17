//go:build windows

package main

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
)

type desktopInfo struct {
	Supported bool `json:"supported"`
	Index     int  `json:"index"`
	Count     int  `json:"count"`
}

// parseDesktopBytes calcula el estado de escritorios virtuales a partir de los
// valores binarios del registro (VirtualDesktopIDs y CurrentVirtualDesktop).
func parseDesktopBytes(ids []byte, current []byte) desktopInfo {
	if len(ids) < 16 || len(ids)%16 != 0 {
		return desktopInfo{Supported: false, Index: 1, Count: 1}
	}
	count := len(ids) / 16
	if len(current) != 16 {
		return desktopInfo{Supported: true, Index: 1, Count: count}
	}
	for i := 0; i < count; i++ {
		if bytes.Equal(ids[i*16:(i+1)*16], current) {
			return desktopInfo{Supported: true, Index: i + 1, Count: count}
		}
	}
	return desktopInfo{Supported: true, Index: 1, Count: count}
}

func getDesktopInfo() desktopInfo {
	const vdKeyPath = `Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops`
	k, err := registry.OpenKey(registry.CURRENT_USER, vdKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return desktopInfo{Supported: false, Index: 1, Count: 1}
	}
	defer k.Close()

	ids, _, err := k.GetBinaryValue("VirtualDesktopIDs")
	if err != nil || len(ids) < 16 {
		return desktopInfo{Supported: false, Index: 1, Count: 1}
	}

	current, _, err := k.GetBinaryValue("CurrentVirtualDesktop")
	if err != nil || len(current) != 16 {
		// Respaldo Windows 10: SessionInfo\<SessionId>\VirtualDesktops
		sessID := currentSessionID()
		win10Path := fmt.Sprintf(`Software\Microsoft\Windows\CurrentVersion\Explorer\SessionInfo\%d\VirtualDesktops`, sessID)
		if k10, err10 := registry.OpenKey(registry.CURRENT_USER, win10Path, registry.QUERY_VALUE); err10 == nil {
			current, _, _ = k10.GetBinaryValue("CurrentVirtualDesktop")
			k10.Close()
		}
	}

	return parseDesktopBytes(ids, current)
}

func sendWinCtrlArrow(right bool) error {
	arrowScan := uint16(0x4B) // ArrowLeft
	if right {
		arrowScan = 0x4D // ArrowRight
	}
	events := []keyEv{
		{Scan: 0x5B, Ext: true, Up: false},      // MetaLeft down
		{Scan: 0x1D, Ext: false, Up: false},     // ControlLeft down
		{Scan: arrowScan, Ext: true, Up: false}, // Arrow down
		{Scan: arrowScan, Ext: true, Up: true},  // Arrow up
		{Scan: 0x1D, Ext: false, Up: true},      // ControlLeft up
		{Scan: 0x5B, Ext: true, Up: true},       // MetaLeft up
	}
	return handleKeys(events)
}

func waitDesktopIndex(expected int, maxWait time.Duration) int {
	deadline := time.Now().Add(maxWait)
	for {
		info := getDesktopInfo()
		if !info.Supported {
			return expected
		}
		if info.Index == expected {
			return info.Index
		}
		if time.Now().After(deadline) {
			return info.Index
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func switchDesktop(target any, stdinClosed <-chan struct{}) (int, error) {
	if target == nil {
		return 0, fmt.Errorf("Parámetro target requerido en desktop.switch")
	}

	info := getDesktopInfo()

	if s, ok := target.(string); ok {
		trimmed := strings.TrimSpace(strings.ToLower(s))
		if trimmed == "next" {
			if err := sendWinCtrlArrow(true); err != nil {
				return 0, err
			}
			expected := info.Index + 1
			if info.Supported && expected > info.Count {
				expected = info.Count
			}
			idx := waitDesktopIndex(expected, 450*time.Millisecond)
			time.Sleep(90 * time.Millisecond)
			return idx, nil
		}
		if trimmed == "previous" {
			if err := sendWinCtrlArrow(false); err != nil {
				return 0, err
			}
			expected := info.Index - 1
			if expected < 1 {
				expected = 1
			}
			idx := waitDesktopIndex(expected, 450*time.Millisecond)
			time.Sleep(90 * time.Millisecond)
			return idx, nil
		}
		if n, err := strconv.Atoi(trimmed); err == nil {
			target = float64(n)
		} else {
			return 0, fmt.Errorf("Destino de escritorio inválido: %s", s)
		}
	}

	var targetIdx int
	switch v := target.(type) {
	case float64:
		targetIdx = int(v)
	case int:
		targetIdx = v
	default:
		return 0, fmt.Errorf("Tipo de destino de escritorio inválido")
	}

	if !info.Supported {
		return 0, fmt.Errorf("Escritorios virtuales no soportados por el registro en esta sesión")
	}
	if targetIdx < 1 || targetIdx > info.Count {
		return 0, fmt.Errorf("Escritorio %d no existe (hay %d)", targetIdx, info.Count)
	}

	diff := targetIdx - info.Index
	steps := diff
	right := true
	stepDir := 1
	if steps < 0 {
		steps = -steps
		right = false
		stepDir = -1
	}

	curIdx := info.Index
	for i := 0; i < steps; i++ {
		select {
		case <-stdinClosed:
			return targetIdx, nil
		default:
		}
		if err := sendWinCtrlArrow(right); err != nil {
			return 0, err
		}
		nextExpected := curIdx + stepDir
		curIdx = waitDesktopIndex(nextExpected, 450*time.Millisecond)
		time.Sleep(90 * time.Millisecond)
	}
	return curIdx, nil
}

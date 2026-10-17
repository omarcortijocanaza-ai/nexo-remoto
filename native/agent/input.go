//go:build windows

package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"
)

const (
	inputMouse    = 0
	inputKeyboard = 1

	mouseeventfMove        = 0x0001
	mouseeventfLeftDown    = 0x0002
	mouseeventfLeftUp      = 0x0004
	mouseeventfRightDown   = 0x0008
	mouseeventfRightUp     = 0x0010
	mouseeventfMiddleDown  = 0x0020
	mouseeventfMiddleUp    = 0x0040
	mouseeventfWheel       = 0x0800
	mouseeventfHWheel      = 0x1000
	mouseeventfVirtualDesk = 0x4000
	mouseeventfAbsolute    = 0x8000

	keyeventfExtendedKey = 0x0001
	keyeventfKeyUp       = 0x0002
	keyeventfUnicode     = 0x0004
	keyeventfScancode    = 0x0008
)

var (
	procSendInput    = modUser32.NewProc("SendInput")
	procGetCursorPos = modUser32.NewProc("GetCursorPos")
	procSetCursorPos = modUser32.NewProc("SetCursorPos")
)

// En amd64, INPUT mide exactamente 40 bytes (4 bytes de type + 4 de relleno + 32 de unión).
type mouseInput struct {
	dx          int32
	dy          int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	_           uint32
	dwExtraInfo uintptr
}

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	_           uint32
	dwExtraInfo uintptr
	_pad        [8]byte
}

type winInput struct {
	inputType uint32
	_         uint32
	union     [32]byte
}

type point struct {
	X int32
	Y int32
}

type keyEv struct {
	Scan uint16 `json:"scan"`
	Ext  bool   `json:"ext"`
	Up   bool   `json:"up"`
}

func makeMouseInput(dx, dy int32, mouseData, flags uint32) winInput {
	var in winInput
	in.inputType = inputMouse
	mi := mouseInput{
		dx:        dx,
		dy:        dy,
		mouseData: mouseData,
		dwFlags:   flags,
	}
	*(*mouseInput)(unsafe.Pointer(&in.union[0])) = mi
	return in
}

func makeKeybdInput(vk, scan uint16, flags uint32) winInput {
	var in winInput
	in.inputType = inputKeyboard
	ki := keybdInput{
		wVk:     vk,
		wScan:   scan,
		dwFlags: flags,
	}
	*(*keybdInput)(unsafe.Pointer(&in.union[0])) = ki
	return in
}

// normalizeCoord convierte una coordenada física absoluta al rango 0..65535 del
// escritorio virtual, soportando orígenes negativos.
func normalizeCoord(val, origin, span int) int32 {
	if span <= 1 {
		return 0
	}
	n := math.Round(float64(val-origin) * 65535.0 / float64(span-1))
	if n < 0 {
		n = 0
	} else if n > 65535 {
		n = 65535
	}
	return int32(n)
}

func sendInputs(inputs []winInput) error {
	if len(inputs) == 0 {
		return nil
	}
	r1, _, lastErr := procSendInput.Call(
		uintptr(len(inputs)),
		uintptr(unsafe.Pointer(&inputs[0])),
		unsafe.Sizeof(winInput{}),
	)
	if int(r1) != len(inputs) {
		return fmt.Errorf("SendInput envió %d de %d eventos (error Win32: %v)", r1, len(inputs), lastErr)
	}
	return nil
}

func moveCursorVerified(x, y int) error {
	virt := getVirtualScreenBounds()
	dx := normalizeCoord(x, virt.X, virt.Width)
	dy := normalizeCoord(y, virt.Y, virt.Height)
	moveEv := makeMouseInput(dx, dy, 0, mouseeventfMove|mouseeventfAbsolute|mouseeventfVirtualDesk)
	if err := sendInputs([]winInput{moveEv}); err != nil {
		return err
	}
	var pt point
	r1, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	if r1 == 0 || absInt(int(pt.X)-x) > 1 || absInt(int(pt.Y)-y) > 1 {
		procSetCursorPos.Call(uintptr(x), uintptr(y))
	}
	return nil
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func buttonFlags(button string) (down uint32, up uint32, err error) {
	switch button {
	case "", "left":
		return mouseeventfLeftDown, mouseeventfLeftUp, nil
	case "right":
		return mouseeventfRightDown, mouseeventfRightUp, nil
	case "middle":
		return mouseeventfMiddleDown, mouseeventfMiddleUp, nil
	default:
		return 0, 0, fmt.Errorf("Botón de ratón no válido: %s", button)
	}
}

func handlePointer(action string, x, y int, button string) error {
	if err := moveCursorVerified(x, y); err != nil {
		return err
	}
	switch action {
	case "move":
		return nil
	case "down":
		down, _, err := buttonFlags(button)
		if err != nil {
			return err
		}
		return sendInputs([]winInput{makeMouseInput(0, 0, 0, down)})
	case "up":
		_, up, err := buttonFlags(button)
		if err != nil {
			return err
		}
		return sendInputs([]winInput{makeMouseInput(0, 0, 0, up)})
	case "click":
		down, up, err := buttonFlags(button)
		if err != nil {
			return err
		}
		return sendInputs([]winInput{
			makeMouseInput(0, 0, 0, down),
			makeMouseInput(0, 0, 0, up),
		})
	default:
		return fmt.Errorf("Acción de puntero desconocida: %s", action)
	}
}

func wheelFactor() float64 {
	raw := strings.TrimSpace(os.Getenv("NEXO_WHEEL_FACTOR"))
	if raw == "" {
		return 1.0
	}
	if f, err := strconv.ParseFloat(raw, 64); err == nil && f > 0 {
		return f
	}
	return 1.0
}

func handleScroll(x, y int, dx, dy float64) error {
	if err := moveCursorVerified(x, y); err != nil {
		return err
	}
	f := wheelFactor()
	vDelta := -int32(math.Round(dy * f))
	hDelta := int32(math.Round(dx * f))
	var events []winInput
	if vDelta != 0 {
		events = append(events, makeMouseInput(0, 0, uint32(vDelta), mouseeventfWheel))
	}
	if hDelta != 0 {
		events = append(events, makeMouseInput(0, 0, uint32(hDelta), mouseeventfHWheel))
	}
	return sendInputs(events)
}

// buildTextEvents construye los bloques de eventos (<= 64 por bloque) para texto
// Unicode, manteniendo los pares sustitutos UTF-16 contiguos y convirtiendo \n y \t
// en pulsaciones reales de Enter y Tab.
func buildTextEvents(text string) [][]winInput {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	var batches [][]winInput
	var current []winInput

	appendGroup := func(group []winInput) {
		if len(current)+len(group) > 64 && len(current) > 0 {
			batches = append(batches, current)
			current = nil
		}
		current = append(current, group...)
	}

	for _, r := range normalized {
		switch r {
		case '\n':
			appendGroup([]winInput{
				makeKeybdInput(0, 0x1C, keyeventfScancode),
				makeKeybdInput(0, 0x1C, keyeventfScancode|keyeventfKeyUp),
			})
		case '\t':
			appendGroup([]winInput{
				makeKeybdInput(0, 0x0F, keyeventfScancode),
				makeKeybdInput(0, 0x0F, keyeventfScancode|keyeventfKeyUp),
			})
		default:
			units := utf16.Encode([]rune{r})
			group := make([]winInput, 0, len(units)*2)
			for _, u := range units {
				group = append(group,
					makeKeybdInput(0, u, keyeventfUnicode),
					makeKeybdInput(0, u, keyeventfUnicode|keyeventfKeyUp),
				)
			}
			appendGroup(group)
		}
	}
	if len(current) > 0 {
		batches = append(batches, current)
	}
	return batches
}

func handleText(text string) error {
	if len(text) > 128 {
		for _, batch := range buildTextEvents(text) {
			if err := sendInputs(batch); err != nil {
				return err
			}
			time.Sleep(5 * time.Millisecond)
		}
		return nil
	}
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	for _, r := range normalized {
		var group []winInput
		isEnter := false
		switch r {
		case '\n':
			isEnter = true
			group = []winInput{
				makeKeybdInput(0x0D, 0x1C, keyeventfScancode),
				makeKeybdInput(0x0D, 0x1C, keyeventfScancode|keyeventfKeyUp),
			}
		case '\t':
			group = []winInput{
				makeKeybdInput(0x09, 0x0F, keyeventfScancode),
				makeKeybdInput(0x09, 0x0F, keyeventfScancode|keyeventfKeyUp),
			}
		default:
			units := utf16.Encode([]rune{r})
			for _, u := range units {
				unitPair := []winInput{
					makeKeybdInput(0, u, keyeventfUnicode),
					makeKeybdInput(0, u, keyeventfUnicode|keyeventfKeyUp),
				}
				if err := sendInputs(unitPair); err != nil {
					return err
				}
				time.Sleep(18 * time.Millisecond)
			}
			continue
		}
		if err := sendInputs(group); err != nil {
			return err
		}
		if isEnter {
			time.Sleep(45 * time.Millisecond)
		} else {
			time.Sleep(18 * time.Millisecond)
		}
	}
	return nil
}

func buildKeyInput(ev keyEv) winInput {
	flags := uint32(keyeventfScancode)
	if ev.Ext {
		flags |= keyeventfExtendedKey
	}
	if ev.Up {
		flags |= keyeventfKeyUp
	}
	return makeKeybdInput(0, ev.Scan, flags)
}

func modifierReleaseEvents() []winInput {
	// Orden inverso de modificadores: Win, Shift, Alt, Ctrl (izquierdo y derecho).
	mods := []keyEv{
		{Scan: 0x5C, Ext: true, Up: true},
		{Scan: 0x5B, Ext: true, Up: true},
		{Scan: 0x36, Ext: false, Up: true},
		{Scan: 0x2A, Ext: false, Up: true},
		{Scan: 0x38, Ext: true, Up: true},
		{Scan: 0x38, Ext: false, Up: true},
		{Scan: 0x1D, Ext: true, Up: true},
		{Scan: 0x1D, Ext: false, Up: true},
	}
	out := make([]winInput, len(mods))
	for i, m := range mods {
		out[i] = buildKeyInput(m)
	}
	return out
}

func handleKeys(events []keyEv) error {
	if len(events) == 0 {
		return nil
	}
	inputs := make([]winInput, len(events))
	for i, ev := range events {
		inputs[i] = buildKeyInput(ev)
	}
	if err := sendInputs(inputs); err != nil {
		// Si SendInput falla a mitad, soltar Ctrl/Alt/Shift/Win antes de devolver error.
		_ = sendInputs(modifierReleaseEvents())
		return err
	}
	return nil
}

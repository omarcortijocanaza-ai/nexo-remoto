//go:build windows

package main

import (
	"encoding/binary"
	"strings"
	"testing"
	"unsafe"
)

func TestWinInputSizeIs40Bytes(t *testing.T) {
	if sz := unsafe.Sizeof(winInput{}); sz != 40 {
		t.Fatalf("unsafe.Sizeof(winInput{}) = %d; se esperaba 40 en amd64", sz)
	}
	if sz := unsafe.Sizeof(mouseInput{}); sz != 32 {
		t.Fatalf("unsafe.Sizeof(mouseInput{}) = %d; se esperaba 32", sz)
	}
	if sz := unsafe.Sizeof(keybdInput{}); sz != 32 {
		t.Fatalf("unsafe.Sizeof(keybdInput{}) = %d; se esperaba 32", sz)
	}
}

func TestNormalizeCoord(t *testing.T) {
	// Escritorio virtual simple 1920x1080 en (0, 0)
	if got := normalizeCoord(0, 0, 1920); got != 0 {
		t.Fatalf("normalizeCoord(0, 0, 1920) = %d; se esperaba 0", got)
	}
	if got := normalizeCoord(1919, 0, 1920); got != 65535 {
		t.Fatalf("normalizeCoord(1919, 0, 1920) = %d; se esperaba 65535", got)
	}

	// Escritorio virtual con monitor secundario a la izquierda o arriba (coordenadas negativas):
	// origen en (-1920, -88), ancho 3840, alto 1168
	if got := normalizeCoord(-1920, -1920, 3840); got != 0 {
		t.Fatalf("normalizeCoord(-1920, -1920, 3840) = %d; se esperaba 0", got)
	}
	if got := normalizeCoord(1919, -1920, 3840); got != 65535 {
		t.Fatalf("normalizeCoord(1919, -1920, 3840) = %d; se esperaba 65535", got)
	}
	mid := normalizeCoord(0, -1920, 3840)
	if mid < 32750 || mid > 32785 {
		t.Fatalf("normalizeCoord(0, -1920, 3840) = %d; fuera del centro esperado", mid)
	}
}

func TestParseDesktopBytes(t *testing.T) {
	// Sin lista válida → supported: false
	info := parseDesktopBytes(nil, nil)
	if info.Supported || info.Index != 1 || info.Count != 1 {
		t.Fatalf("parseDesktopBytes(nil, nil) = %+v", info)
	}

	guid1 := make([]byte, 16)
	guid2 := make([]byte, 16)
	guid3 := make([]byte, 16)
	guid1[0] = 0xAA
	guid2[0] = 0xBB
	guid3[0] = 0xCC
	all := append(append([]byte{}, guid1...), guid2...)
	all = append(all, guid3...)

	// Sin CurrentVirtualDesktop → asume escritorio 1
	infoNoCurr := parseDesktopBytes(all, nil)
	if !infoNoCurr.Supported || infoNoCurr.Index != 1 || infoNoCurr.Count != 3 {
		t.Fatalf("parseDesktopBytes sin current = %+v", infoNoCurr)
	}

	// CurrentVirtualDesktop apunta al 2º GUID → Index = 2
	info2 := parseDesktopBytes(all, guid2)
	if !info2.Supported || info2.Index != 2 || info2.Count != 3 {
		t.Fatalf("parseDesktopBytes(guid2) = %+v", info2)
	}

	// CurrentVirtualDesktop apunta al 3º GUID → Index = 3
	info3 := parseDesktopBytes(all, guid3)
	if !info3.Supported || info3.Index != 3 || info3.Count != 3 {
		t.Fatalf("parseDesktopBytes(guid3) = %+v", info3)
	}
}

func TestAudioConversionAndResample(t *testing.T) {
	// 1. Conversión s16le mono → float32 estéreo → s16le estéreo
	rawMono := make([]byte, 4)
	binary.LittleEndian.PutUint16(rawMono[0:2], uint16(16384))
	neg := int16(-16384)
	binary.LittleEndian.PutUint16(rawMono[2:4], uint16(neg))

	stereo := s16leToStereoFloat32(rawMono, 1)
	if len(stereo) != 4 {
		t.Fatalf("len(stereo) = %d; se esperaba 4", len(stereo))
	}
	outBytes := float32StereoToS16LE(stereo, 2)
	if len(outBytes) != 8 {
		t.Fatalf("len(outBytes) = %d; se esperaba 8", len(outBytes))
	}
	got0 := int16(binary.LittleEndian.Uint16(outBytes[0:2]))
	got1 := int16(binary.LittleEndian.Uint16(outBytes[4:6]))
	if got0 < 16380 || got0 > 16388 || got1 > -16380 || got1 < -16388 {
		t.Fatalf("valores convertidos inesperados: %d, %d", got0, got1)
	}

	// 2. Remuestreo lineal 44100 → 48000 (441 cuadros → 480 cuadros)
	in441 := make([]float32, 441*2)
	for i := range in441 {
		in441[i] = 0.25
	}
	out480 := resampleStereoLinear(in441, 44100, 48000)
	if len(out480) != 480*2 {
		t.Fatalf("len(out480) = %d; se esperaba %d", len(out480), 480*2)
	}
}

func TestBuildTextEventsWithSurrogatePairsAndBatching(t *testing.T) {
	// "A😀\n\t" -> 'A' (2 eventos) + '😀' par sustituto (4 eventos) + '\n' (2 eventos) + '\t' (2 eventos) = 10 eventos
	batches := buildTextEvents("A😀\n\t")
	if len(batches) != 1 {
		t.Fatalf("len(batches) = %d; se esperaba 1", len(batches))
	}
	if len(batches[0]) != 10 {
		t.Fatalf("len(batches[0]) = %d; se esperaba 10", len(batches[0]))
	}

	// Verificar que el par sustituto de 😀 (0xD83D, 0xDE00) va seguido en el mismo bloque
	ki1 := *(*keybdInput)(unsafe.Pointer(&batches[0][2].union[0]))
	ki2 := *(*keybdInput)(unsafe.Pointer(&batches[0][4].union[0]))
	if ki1.wScan != 0xD83D || ki2.wScan != 0xDE00 {
		t.Fatalf("par sustituto inesperado: 0x%04x, 0x%04x", ki1.wScan, ki2.wScan)
	}

	// Verificar que bloques grandes no superan 64 eventos ni parten un par sustituto
	longText := strings.Repeat("a", 31) + "😀" // 31*2 = 62 eventos; '😀' necesita 4 → debe pasar al segundo bloque
	batches2 := buildTextEvents(longText)
	if len(batches2) != 2 {
		t.Fatalf("len(batches2) = %d; se esperaba 2", len(batches2))
	}
	if len(batches2[0]) != 62 || len(batches2[1]) != 4 {
		t.Fatalf("tamaños de lote inesperados: %d, %d", len(batches2[0]), len(batches2[1]))
	}
}

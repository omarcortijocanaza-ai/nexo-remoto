package main

import (
	"bytes"
	"encoding/binary"
	"image/color"
	"image/png"
	"testing"
)

func TestGenerarICO(t *testing.T) {
	for _, v := range []Visual{VisualActivo, VisualConectando, VisualDetenido} {
		ico, err := generarICO(colorDe(v))
		if err != nil {
			t.Fatal(err)
		}
		if len(ico) < 22 {
			t.Fatalf("ICO demasiado corto: %d bytes", len(ico))
		}
		le := binary.LittleEndian
		// ICONDIR
		if le.Uint16(ico[0:]) != 0 || le.Uint16(ico[2:]) != 1 || le.Uint16(ico[4:]) != 1 {
			t.Errorf("cabecera ICONDIR inválida: % x", ico[:6])
		}
		// ICONDIRENTRY
		if ico[6] != 32 || ico[7] != 32 || ico[8] != 0 || ico[9] != 0 {
			t.Errorf("entrada con dimensiones/paleta inesperadas: % x", ico[6:10])
		}
		if le.Uint16(ico[10:]) != 1 || le.Uint16(ico[12:]) != 32 {
			t.Errorf("planos/bpp inesperados")
		}
		tam, desp := le.Uint32(ico[14:]), le.Uint32(ico[18:])
		if desp != 22 || int(desp+tam) != len(ico) {
			t.Fatalf("tamaño/offset incoherentes: tam=%d desp=%d total=%d", tam, desp, len(ico))
		}
		img, err := png.Decode(bytes.NewReader(ico[desp:]))
		if err != nil {
			t.Fatalf("el PNG interior no se decodifica: %v", err)
		}
		if b := img.Bounds(); b.Dx() != 32 || b.Dy() != 32 {
			t.Errorf("PNG de %dx%d, quiero 32x32", b.Dx(), b.Dy())
		}
	}
}

func TestContenidoIcono(t *testing.T) {
	c := colorDe(VisualActivo)
	img := dibujarIcono(c)
	// Esquina fuera del círculo: transparente.
	if a := img.NRGBAAt(0, 0).A; a != 0 {
		t.Errorf("la esquina debería ser transparente, alfa=%d", a)
	}
	// Dentro del círculo y fuera de la N: color del estado, opaco.
	if p := img.NRGBAAt(4, 16); p != c {
		t.Errorf("píxel de fondo = %+v, quiero %+v", p, c)
	}
	// Sobre la barra izquierda de la N: blanco opaco.
	if p := img.NRGBAAt(11, 16); p != (color.NRGBA{R: 255, G: 255, B: 255, A: 255}) {
		t.Errorf("píxel de la N = %+v, quiero blanco", p)
	}
	// Los tres estados deben verse distintos.
	if colorDe(VisualActivo) == colorDe(VisualConectando) || colorDe(VisualConectando) == colorDe(VisualDetenido) {
		t.Error("los colores de estado deben ser distintos")
	}
}

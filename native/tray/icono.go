package main

// Icono de la bandeja generado en código: un círculo de color con una «N»
// blanca. No hay ficheros externos ni arte de terceros. Se dibuja a 32x32 con
// supermuestreo (bordes suaves), se codifica como PNG y se empaqueta en un
// contenedor ICO (válido desde Vista, que admite PNG dentro del ICO).

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
)

const ladoIcono = 32

var (
	colorActivo     = color.NRGBA{R: 46, G: 160, B: 67, A: 255}  // verde
	colorConectando = color.NRGBA{R: 224, G: 144, B: 16, A: 255} // ámbar
	colorDetenido   = color.NRGBA{R: 128, G: 128, B: 128, A: 255}
)

// colorDe asigna el color del círculo a cada estado visual.
func colorDe(v Visual) color.NRGBA {
	switch v {
	case VisualActivo:
		return colorActivo
	case VisualConectando:
		return colorConectando
	default:
		return colorDetenido
	}
}

// enN dice si el punto (x, y), en coordenadas de la rejilla 32x32, cae sobre la
// «N»: dos barras verticales y una diagonal (un paralelogramo) entre ellas.
func enN(x, y float64) bool {
	if y < 9 || y > 23 {
		return false
	}
	if x >= 9.5 && x <= 12.9 { // barra izquierda
		return true
	}
	if x >= 19.1 && x <= 22.5 { // barra derecha
		return true
	}
	t := (y - 9) / 14
	izq := 9.5 + 13*t // la diagonal baja de arriba-izquierda a abajo-derecha
	return x >= izq && x <= izq+3.7
}

// dibujarIcono pinta el círculo y la «N» con supermuestreo 4x4 por píxel.
func dibujarIcono(c color.NRGBA) *image.NRGBA {
	const ss = 4
	const radio = 15.5
	img := image.NewNRGBA(image.Rect(0, 0, ladoIcono, ladoIcono))
	blanco := color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	for py := 0; py < ladoIcono; py++ {
		for px := 0; px < ladoIcono; px++ {
			var sr, sg, sb, sa float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					x := float64(px) + (float64(sx)+0.5)/ss
					y := float64(py) + (float64(sy)+0.5)/ss
					dx, dy := x-16, y-16
					if dx*dx+dy*dy > radio*radio {
						continue // fuera del círculo: transparente
					}
					m := c
					if enN(x, y) {
						m = blanco
					}
					sr += float64(m.R)
					sg += float64(m.G)
					sb += float64(m.B)
					sa++
				}
			}
			if sa == 0 {
				continue
			}
			img.SetNRGBA(px, py, color.NRGBA{
				R: uint8(sr/sa + 0.5),
				G: uint8(sg/sa + 0.5),
				B: uint8(sb/sa + 0.5),
				A: uint8(sa/(ss*ss)*255 + 0.5),
			})
		}
	}
	return img
}

// empaquetarICO mete un PNG dentro de un ICO de una sola imagen:
// ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + datos PNG.
func empaquetarICO(pngDatos []byte, ancho, alto int) []byte {
	var b bytes.Buffer
	le := binary.LittleEndian
	// ICONDIR: reservado 0, tipo 1 (icono), 1 imagen.
	binary.Write(&b, le, [3]uint16{0, 1, 1})
	// ICONDIRENTRY. Un ancho/alto de 0 significaría 256, por eso se escribe el valor real (<256).
	b.WriteByte(byte(ancho))
	b.WriteByte(byte(alto))
	b.WriteByte(0)                   // sin paleta
	b.WriteByte(0)                   // reservado
	binary.Write(&b, le, uint16(1))  // planos
	binary.Write(&b, le, uint16(32)) // bits por píxel
	binary.Write(&b, le, uint32(len(pngDatos)))
	binary.Write(&b, le, uint32(6+16)) // la imagen empieza justo tras la entrada
	b.Write(pngDatos)
	return b.Bytes()
}

// generarICO devuelve el icono ICO completo para un color.
func generarICO(c color.NRGBA) ([]byte, error) {
	var p bytes.Buffer
	if err := png.Encode(&p, dibujarIcono(c)); err != nil {
		return nil, err
	}
	return empaquetarICO(p.Bytes(), ladoIcono, ladoIcono), nil
}

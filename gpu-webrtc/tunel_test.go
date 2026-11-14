package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pion/rtp"
)

// nal arma un paquete RTP con una sola NAL del tipo indicado.
func nal(tipo byte, marca bool, relleno int) *rtp.Packet {
	carga := append([]byte{0x60 | tipo}, bytes.Repeat([]byte{0xAB}, relleno)...)
	return &rtp.Packet{Header: rtp.Header{Marker: marca}, Payload: carga}
}

// fua parte una NAL en fragmentos FU-A, como hace ffmpeg con las grandes.
func fua(tipo byte, trozos int) []*rtp.Packet {
	var salida []*rtp.Packet
	for i := 0; i < trozos; i++ {
		h := tipo
		if i == 0 {
			h |= 0x80
		}
		if i == trozos-1 {
			h |= 0x40
		}
		salida = append(salida, &rtp.Packet{Header: rtp.Header{Marker: i == trozos-1}, Payload: []byte{0x7c, h, byte(i), 0xCD}})
	}
	return salida
}

func suscribir(t *tunelH264, cola int) *suscriptorTunel {
	s := &suscriptorTunel{cola: make(chan []byte, cola), esperandoClave: true}
	t.mu.Lock()
	t.suscriptores[s] = struct{}{}
	t.mu.Unlock()
	return s
}

func leer(t *testing.T, s *suscriptorTunel) (clave bool, marca uint32, annexB []byte) {
	t.Helper()
	select {
	case m := <-s.cola:
		if int(binary.BigEndian.Uint32(m[0:4])) != len(m)-4 {
			t.Fatalf("longitud mal escrita")
		}
		return m[4]&banderaClave != 0, binary.BigEndian.Uint32(m[5:9]), m[9:]
	default:
		t.Fatalf("no llegó ningún fotograma")
	}
	return
}

func TestTunelEmpiezaEnClaveYAgrupaFotogramas(t *testing.T) {
	tun := nuevoTunelH264()
	s := suscribir(tun, 8)
	tun.paquete(nal(1, true, 10), 100) // delta antes del primer clave: no sirve, se salta
	if len(s.cola) != 0 {
		t.Fatalf("un delta sin referencia no debe llegar")
	}
	// Fotograma clave: SPS + PPS + IDR partido en FU-A.
	tun.paquete(nal(7, false, 4), 200)
	tun.paquete(nal(8, false, 2), 200)
	for _, p := range fua(5, 3) {
		tun.paquete(p, 200)
	}
	clave, marca, datos := leer(t, s)
	if !clave || marca != 200 {
		t.Fatalf("se esperaba un fotograma clave con marca 200, llegó clave=%v marca=%d", clave, marca)
	}
	if bytes.Count(datos, []byte{0, 0, 0, 1}) != 3 {
		t.Fatalf("se esperaban 3 NAL en Annex B (SPS, PPS, IDR), hay %d", bytes.Count(datos, []byte{0, 0, 0, 1}))
	}
	tun.paquete(nal(1, true, 10), 300)
	if clave, _, _ := leer(t, s); clave {
		t.Fatalf("el delta no es clave")
	}
}

func TestTunelColaLlenaDescartaHastaElSiguienteClave(t *testing.T) {
	tun := nuevoTunelH264()
	s := suscribir(tun, 2)
	tun.paquete(nal(5, true, 4), 1) // clave
	tun.paquete(nal(1, true, 4), 2)
	tun.paquete(nal(1, true, 4), 3) // cola llena: se descarta y espera clave
	<-s.cola
	<-s.cola
	tun.paquete(nal(1, true, 4), 4)
	if len(s.cola) != 0 {
		t.Fatalf("tras perder un fotograma, ningún delta debe pasar hasta el siguiente clave")
	}
	tun.paquete(nal(5, true, 4), 5)
	if clave, marca, _ := leer(t, s); !clave || marca != 5 {
		t.Fatalf("se esperaba retomar en el clave 5")
	}
}

func TestTunelSinSuscriptoresNoAcumula(t *testing.T) {
	tun := nuevoTunelH264()
	for i := 0; i < 1000; i++ {
		tun.paquete(nal(1, false, 1000), 1)
	}
	if len(tun.fotograma) != 0 {
		t.Fatalf("sin nadie mirando no debe guardarse nada")
	}
}

func TestTunelHTTPEntregaElFlujo(t *testing.T) {
	tun := nuevoTunelH264()
	servidor := httptest.NewServer(http.HandlerFunc(tun.servir)) // escucha sólo en 127.0.0.1
	defer servidor.Close()
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, servidor.URL, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	for tun.cuantos() == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	tun.paquete(nal(5, true, 20), 42)
	cabecera := make([]byte, 9)
	if _, err := io.ReadFull(res.Body, cabecera); err != nil {
		t.Fatal(err)
	}
	if cabecera[4]&banderaClave == 0 || binary.BigEndian.Uint32(cabecera[5:9]) != 42 {
		t.Fatalf("cabecera inesperada: %v", cabecera)
	}
	cancelar()
	for i := 0; i < 100 && tun.cuantos() != 0; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if tun.cuantos() != 0 {
		t.Fatalf("al cerrar la conexión el suscriptor debe darse de baja")
	}
}

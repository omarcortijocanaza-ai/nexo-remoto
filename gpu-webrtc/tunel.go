package main

// Vídeo GPU por el túnel (respaldo sin WebRTC).
//
// Cuando el celular no consigue conexión WebRTC directa (NAT simétrico de los datos móviles) y no
// hay TURN, el cliente caía a JPEG sueltos por el túnel de Cloudflare. Aquí se ofrece el MISMO
// H.264 que va por WebRTC, reagrupado en fotogramas completos, para que el servidor Node lo
// reenvíe por WebSocket y el navegador lo decodifique con WebCodecs: mucha más calidad con menos
// datos que los JPEG.
//
// GET /h264 entrega un flujo sin fin de mensajes:
//
//	[4 bytes longitud big-endian][1 byte banderas][4 bytes marca de tiempo RTP][Annex B …]
//
// La longitud cuenta todo lo que va detrás de ella. Bandera bit 0 = fotograma clave (lleva IDR;
// NVENC repite SPS/PPS en cada uno, así que con él se puede empezar a decodificar).
//
// Cada suscriptor tiene una cola corta. Si se llena (cliente lento), se descartan fotogramas
// hasta el siguiente clave: un fotograma delta sin su referencia sólo produciría basura. El
// control fino de congestión lo hace el servidor Node, que ve el WebSocket de cada cliente.

import (
	"encoding/binary"
	"net/http"
	"sync"

	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
)

const (
	colaTunel         = 32 // fotogramas: a 60 FPS, ≈ 0,5 s
	cabeceraMensaje   = 1 + 4
	banderaClave      = 1
	maxFotogramaTunel = 4 << 20
)

type suscriptorTunel struct {
	cola           chan []byte
	esperandoClave bool
}

type tunelH264 struct {
	mu           sync.Mutex
	suscriptores map[*suscriptorTunel]struct{}
	depack       codecs.H264Packet
	fotograma    []byte
	clave        bool
	descartado   bool // el fotograma en curso perdió un trozo: no se emite
}

func nuevoTunelH264() *tunelH264 {
	return &tunelH264{suscriptores: make(map[*suscriptorTunel]struct{})}
}

func (t *tunelH264) cuantos() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.suscriptores)
}

// esClave dice si un fragmento Annex B contiene un IDR (5) o un SPS (7).
func esClave(annexB []byte) bool {
	for i := 0; i+3 < len(annexB); i++ {
		if annexB[i] == 0 && annexB[i+1] == 0 && annexB[i+2] == 1 {
			tipo := annexB[i+3] & 0x1f
			if tipo == 5 || tipo == 7 {
				return true
			}
			i += 3
		}
	}
	return false
}

// paquete recibe cada paquete RTP de ffmpeg (ya con la marca de tiempo de salida) y emite el
// fotograma cuando llega el bit de marca. Sin suscriptores no hace nada: el vídeo por WebRTC no
// paga este trabajo.
func (t *tunelH264) paquete(p *rtp.Packet, marcaTiempo uint32) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.suscriptores) == 0 {
		t.fotograma = t.fotograma[:0]
		t.clave = false
		t.descartado = false
		return
	}
	nal, err := t.depack.Unmarshal(p.Payload)
	if err != nil {
		t.descartado = true
	} else if len(nal) > 0 {
		if len(t.fotograma)+len(nal) > maxFotogramaTunel {
			t.descartado = true
		} else {
			t.fotograma = append(t.fotograma, nal...)
			if !t.clave && esClave(nal) {
				t.clave = true
			}
		}
	}
	if !p.Marker {
		return
	}
	if !t.descartado && len(t.fotograma) > 0 {
		t.emitir(t.fotograma, t.clave, marcaTiempo)
	}
	t.fotograma = t.fotograma[:0]
	t.clave = false
	t.descartado = false
}

func (t *tunelH264) emitir(datos []byte, clave bool, marcaTiempo uint32) {
	mensaje := make([]byte, 4+cabeceraMensaje+len(datos))
	binary.BigEndian.PutUint32(mensaje[0:4], uint32(cabeceraMensaje+len(datos)))
	if clave {
		mensaje[4] = banderaClave
	}
	binary.BigEndian.PutUint32(mensaje[5:9], marcaTiempo)
	copy(mensaje[9:], datos)
	for s := range t.suscriptores {
		if s.esperandoClave && !clave {
			continue
		}
		select {
		case s.cola <- mensaje:
			s.esperandoClave = false
		default:
			s.esperandoClave = true // cola llena: se retoma en el próximo clave
		}
	}
}

func (t *tunelH264) servir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming no disponible", http.StatusInternalServerError)
		return
	}
	s := &suscriptorTunel{cola: make(chan []byte, colaTunel), esperandoClave: true}
	t.mu.Lock()
	t.suscriptores[s] = struct{}{}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.suscriptores, s)
		t.mu.Unlock()
	}()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case mensaje := <-s.cola:
			if _, err := w.Write(mensaje); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

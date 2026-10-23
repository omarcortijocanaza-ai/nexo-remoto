package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

type bridge struct {
	track        *webrtc.TrackLocalStaticRTP
	mu           sync.Mutex
	peers        map[*webrtc.PeerConnection]struct{}
	packets      atomic.Uint64
	bytes        atomic.Uint64
	frames       atomic.Uint64
	pli          atomic.Uint64
	fir          atomic.Uint64
	nack         atomic.Uint64
	timelineInit bool
	outTimestamp uint32
	outSequence  uint16
	frameStep    uint32
}

func newBridge() (*bridge, error) {
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeH264,
			ClockRate:   90000,
			SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64002a",
		},
		"video", "nexo-gpu",
	)
	if err != nil {
		return nil, err
	}
	fps, err := strconv.Atoi(os.Getenv("NEXO_GPU_FPS"))
	if err != nil || (fps != 30 && fps != 45 && fps != 60) {
		fps = 60
	}
	return &bridge{track: track, peers: make(map[*webrtc.PeerConnection]struct{}), frameStep: uint32(90000 / fps)}, nil
}

func (b *bridge) readRTP(address string) error {
	udpAddress, err := net.ResolveUDPAddr("udp4", address)
	if err != nil {
		return err
	}
	conn, err := net.ListenUDP("udp4", udpAddress)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetReadBuffer(8 << 20); err != nil {
		log.Printf("buffer UDP: %v", err)
	}
	buffer := make([]byte, 1600)
	for {
		n, _, err := conn.ReadFromUDP(buffer)
		if err != nil {
			return err
		}
		var packet rtp.Packet
		if packet.Unmarshal(buffer[:n]) != nil {
			continue
		}
		b.packets.Add(1)
		b.bytes.Add(uint64(n))
		if !b.timelineInit {
			b.timelineInit = true
			b.outTimestamp = packet.Timestamp
			b.outSequence = packet.SequenceNumber
		} else {
			b.outSequence++
		}
		packet.SequenceNumber = b.outSequence
		packet.Timestamp = b.outTimestamp
		// Packet.Unmarshal keeps Payload and extension slices backed by `buffer`.
		// The next UDP read reuses that buffer while Pion may still be processing
		// the current packet through interceptors/SRTP. A deep clone prevents the
		// next frame from overwriting bytes that are still in flight.
		safePacket := packet.Clone()
		if err := b.track.WriteRTP(safePacket); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			log.Printf("RTP: %v", err)
		}
		if packet.Marker {
			b.frames.Add(1)
			b.outTimestamp += b.frameStep
		}
	}
}

func (b *bridge) offer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var offer webrtc.SessionDescription
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if decoder.Decode(&offer) != nil || offer.Type != webrtc.SDPTypeOffer || offer.SDP == "" {
		http.Error(w, "invalid offer", http.StatusBadRequest)
		return
	}
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{
		ICEServers: servidoresIce(r),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// C7(a): Registrar el par en b.peers inmediatamente tras crearlo (antes de
	// SetRemoteDescription y de esperar ICE) para que si la conexión falla durante
	// esos hasta 4 s, closePeer lo encuentre y lo elimine sin dejar pares zombis.
	b.mu.Lock()
	b.peers[pc] = struct{}{}
	b.mu.Unlock()

	closePeer := func() {
		b.mu.Lock()
		_, exists := b.peers[pc]
		if exists {
			delete(b.peers, pc)
		}
		b.mu.Unlock()
		if exists {
			_ = pc.Close()
		}
	}
	sender, err := pc.AddTrack(b.track)
	if err != nil {
		closePeer()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	go func() {
		buffer := make([]byte, 1500)
		for {
			n, _, err := sender.Read(buffer)
			if err != nil {
				return
			}
			// C7(b): Decodificar paquetes RTCP entrantes para contabilizar PLI, FIR y NACK.
			pkts, err := rtcp.Unmarshal(buffer[:n])
			if err != nil {
				continue
			}
			for _, p := range pkts {
				switch p.(type) {
				case *rtcp.PictureLossIndication:
					b.pli.Add(1)
				case *rtcp.FullIntraRequest:
					b.fir.Add(1)
				case *rtcp.TransportLayerNack:
					b.nack.Add(1)
				}
			}
		}
	}()
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateDisconnected {
			closePeer()
		}
	})
	if err = pc.SetRemoteDescription(offer); err != nil {
		closePeer()
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		closePeer()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err = pc.SetLocalDescription(answer); err != nil {
		closePeer()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	select {
	case <-gathered:
	case <-time.After(4 * time.Second):
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(pc.LocalDescription())
}

func (b *bridge) stats(w http.ResponseWriter, _ *http.Request) {
	b.mu.Lock()
	peers := len(b.peers)
	b.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"peers":   peers,
		"packets": b.packets.Load(),
		"bytes":   b.bytes.Load(),
		"frames":  b.frames.Load(),
		"pli":     b.pli.Load(),
		"fir":     b.fir.Load(),
		"nack":    b.nack.Load(),
	})
}

func main() {
	b, err := newBridge()
	if err != nil {
		log.Fatal(err)
	}
	rtpPort := os.Getenv("NEXO_GPU_RTP_PORT")
	if rtpPort == "" {
		rtpPort = "5004"
	}
	webRTCPort := os.Getenv("NEXO_GPU_WEBRTC_PORT")
	if webRTCPort == "" {
		webRTCPort = "9090"
	}
	go func() {
		if err := b.readRTP(net.JoinHostPort("127.0.0.1", rtpPort)); err != nil {
			log.Fatal(err)
		}
	}()
	mux := http.NewServeMux()
	mux.HandleFunc("/offer", b.offer)
	mux.HandleFunc("/ice-test", b.probarIce)
	mux.HandleFunc("/health", b.stats)
	mux.HandleFunc("/stats", b.stats)
	server := &http.Server{Addr: net.JoinHostPort("127.0.0.1", webRTCPort), Handler: mux, ReadHeaderTimeout: 3 * time.Second}
	go func() {
		log.Printf("NEXO GPU WebRTC en %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	if runtime.GOOS == "windows" {
		signal.Notify(stop, os.Interrupt)
	} else {
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	}
	stdinEOF := make(chan struct{})
	if os.Getenv("NEXO_EXIT_ON_STDIN_EOF") == "1" {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			close(stdinEOF)
		}()
	}
	select {
	case <-stop:
	case <-stdinEOF:
	}
	b.mu.Lock()
	for pc := range b.peers {
		_ = pc.Close()
	}
	b.mu.Unlock()
	_ = server.Close()
}

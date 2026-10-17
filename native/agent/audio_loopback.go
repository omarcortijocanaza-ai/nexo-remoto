//go:build windows

package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/signal"
	"runtime"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

type audioDeviceEntry struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

type audioDevicesOutput struct {
	Outputs []audioDeviceEntry `json:"outputs"`
	Inputs  []audioDeviceEntry `json:"inputs"`
}

func enumerateEndpoints(mmde *wca.IMMDeviceEnumerator, dataFlow uint32) ([]audioDeviceEntry, error) {
	defaultID := ""
	var defDev *wca.IMMDevice
	if err := mmde.GetDefaultAudioEndpoint(dataFlow, wca.EConsole, &defDev); err == nil && defDev != nil {
		_ = defDev.GetId(&defaultID)
		defDev.Release()
	}

	var dc *wca.IMMDeviceCollection
	if err := mmde.EnumAudioEndpoints(dataFlow, wca.DEVICE_STATE_ACTIVE, &dc); err != nil {
		return nil, err
	}
	defer dc.Release()

	var count uint32
	if err := dc.GetCount(&count); err != nil {
		return nil, err
	}

	result := make([]audioDeviceEntry, 0, count)
	for i := uint32(0); i < count; i++ {
		var item *wca.IMMDevice
		if err := dc.Item(i, &item); err != nil || item == nil {
			continue
		}
		var id string
		_ = item.GetId(&id)

		name := id
		var ps *wca.IPropertyStore
		if err := item.OpenPropertyStore(wca.STGM_READ, &ps); err == nil && ps != nil {
			var pv wca.PROPVARIANT
			if err := ps.GetValue(&wca.PKEY_Device_FriendlyName, &pv); err == nil {
				if s := pv.String(); s != "" {
					name = s
				}
				_ = pv.Clear()
			}
			ps.Release()
		}
		item.Release()

		result = append(result, audioDeviceEntry{
			ID:      id,
			Name:    name,
			Default: id != "" && id == defaultID,
		})
	}
	return result, nil
}

func runAudioDevices() error {
	runtime.LockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		return err
	}
	defer ole.CoUninitialize()

	var mmde *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &mmde); err != nil {
		return err
	}
	defer mmde.Release()

	outputs, err := enumerateEndpoints(mmde, wca.ERender)
	if err != nil {
		return err
	}
	inputs, err := enumerateEndpoints(mmde, wca.ECapture)
	if err != nil {
		return err
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(audioDevicesOutput{
		Outputs: outputs,
		Inputs:  inputs,
	})
}

func isWaveFormatFloat(wfx *wca.WAVEFORMATEX) bool {
	if wfx.WFormatTag == 3 { // WAVE_FORMAT_IEEE_FLOAT
		return true
	}
	if wfx.WFormatTag == 0xFFFE && wfx.CbSize >= 22 { // WAVE_FORMAT_EXTENSIBLE
		subFormatData1 := *(*uint32)(unsafe.Add(unsafe.Pointer(wfx), 24))
		if subFormatData1 == 3 {
			return true
		}
		if subFormatData1 == 1 {
			return false
		}
	}
	return wfx.WBitsPerSample == 32
}

// decodeMixToStereoFloat32 convierte cuadros del formato de mezcla de WASAPI
// (float32 o s16le, 1..N canales) en muestras float32 estéreo intercaladas (L, R).
func decodeMixToStereoFloat32(raw []byte, frames int, channels int, bitsPerSample int, isFloat bool) []float32 {
	if frames <= 0 || channels <= 0 {
		return nil
	}
	bytesPerSample := bitsPerSample / 8
	if bytesPerSample <= 0 {
		return nil
	}
	frameBytes := channels * bytesPerSample
	if len(raw) < frames*frameBytes {
		frames = len(raw) / frameBytes
	}
	out := make([]float32, frames*2)
	for f := 0; f < frames; f++ {
		base := f * frameBytes
		readChan := func(ch int) float32 {
			if ch >= channels {
				ch = 0
			}
			off := base + ch*bytesPerSample
			if isFloat && bytesPerSample == 4 {
				bits := binary.LittleEndian.Uint32(raw[off : off+4])
				val := math.Float32frombits(bits)
				if math.IsNaN(float64(val)) || math.IsInf(float64(val), 0) {
					return 0
				}
				return val
			}
			if bytesPerSample == 2 {
				v := int16(binary.LittleEndian.Uint16(raw[off : off+2]))
				return float32(v) / 32768.0
			}
			if bytesPerSample == 4 {
				v := int32(binary.LittleEndian.Uint32(raw[off : off+4]))
				return float32(float64(v) / 2147483648.0)
			}
			return 0
		}
		l := readChan(0)
		r := l
		if channels >= 2 {
			r = readChan(1)
		}
		out[f*2] = l
		out[f*2+1] = r
	}
	return out
}

// resampleStereoLinear remuestrea muestras estéreo intercaladas de srcRate a dstRate.
func resampleStereoLinear(in []float32, srcRate, dstRate int) []float32 {
	inFrames := len(in) / 2
	if inFrames == 0 || srcRate <= 0 || dstRate <= 0 {
		return nil
	}
	if srcRate == dstRate {
		return in
	}
	outFrames := int(math.Round(float64(inFrames) * float64(dstRate) / float64(srcRate)))
	if outFrames <= 0 {
		return nil
	}
	out := make([]float32, outFrames*2)
	ratio := float64(srcRate) / float64(dstRate)
	for i := 0; i < outFrames; i++ {
		srcPos := float64(i) * ratio
		idx0 := int(srcPos)
		frac := float32(srcPos - float64(idx0))
		if idx0 >= inFrames-1 {
			idx0 = inFrames - 1
			out[i*2] = in[idx0*2]
			out[i*2+1] = in[idx0*2+1]
		} else {
			idx1 := idx0 + 1
			out[i*2] = in[idx0*2]*(1-frac) + in[idx1*2]*frac
			out[i*2+1] = in[idx0*2+1]*(1-frac) + in[idx1*2+1]*frac
		}
	}
	return out
}

// float32StereoToS16LE convierte muestras float32 estéreo intercaladas en bytes s16le
// con 1 o 2 canales de salida.
func float32StereoToS16LE(stereo []float32, dstChannels int) []byte {
	frames := len(stereo) / 2
	if frames <= 0 {
		return nil
	}
	if dstChannels < 1 {
		dstChannels = 2
	}
	out := make([]byte, frames*dstChannels*2)
	clampToS16 := func(v float32) int16 {
		if v > 1.0 {
			v = 1.0
		} else if v < -1.0 {
			v = -1.0
		}
		return int16(math.Round(float64(v) * 32767.0))
	}
	for f := 0; f < frames; f++ {
		l := stereo[f*2]
		r := stereo[f*2+1]
		if dstChannels == 1 {
			m := clampToS16((l + r) * 0.5)
			binary.LittleEndian.PutUint16(out[f*2:f*2+2], uint16(m))
		} else {
			sL := clampToS16(l)
			sR := clampToS16(r)
			off := f * dstChannels * 2
			binary.LittleEndian.PutUint16(out[off:off+2], uint16(sL))
			binary.LittleEndian.PutUint16(out[off+2:off+4], uint16(sR))
		}
	}
	return out
}

type loopbackSession struct {
	dev       *wca.IMMDevice
	ac        *wca.IAudioClient
	acc       *wca.IAudioCaptureClient
	wfx       *wca.WAVEFORMATEX
	deviceID  string
	isFloat   bool
	srcRate   int
	srcChans  int
	srcBits   int
	frameSize int
}

func (s *loopbackSession) close() {
	if s.ac != nil {
		_ = s.ac.Stop()
	}
	if s.acc != nil {
		s.acc.Release()
		s.acc = nil
	}
	if s.wfx != nil {
		ole.CoTaskMemFree(uintptr(unsafe.Pointer(s.wfx)))
		s.wfx = nil
	}
	if s.ac != nil {
		s.ac.Release()
		s.ac = nil
	}
	if s.dev != nil {
		s.dev.Release()
		s.dev = nil
	}
}

func openDefaultLoopback(mmde *wca.IMMDeviceEnumerator) (*loopbackSession, error) {
	var dev *wca.IMMDevice
	if err := mmde.GetDefaultAudioEndpoint(wca.ERender, wca.EConsole, &dev); err != nil || dev == nil {
		return nil, fmt.Errorf("No se encontró dispositivo de salida por defecto: %v", err)
	}

	s := &loopbackSession{dev: dev}
	_ = dev.GetId(&s.deviceID)

	if err := dev.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &s.ac); err != nil {
		s.close()
		return nil, fmt.Errorf("Activate IAudioClient falló: %v", err)
	}

	if err := s.ac.GetMixFormat(&s.wfx); err != nil || s.wfx == nil {
		s.close()
		return nil, fmt.Errorf("GetMixFormat falló: %v", err)
	}

	s.isFloat = isWaveFormatFloat(s.wfx)
	s.srcRate = int(s.wfx.NSamplesPerSec)
	s.srcChans = int(s.wfx.NChannels)
	s.srcBits = int(s.wfx.WBitsPerSample)
	s.frameSize = int(s.wfx.NBlockAlign)

	// Buffer de 100 ms (en unidades de 100 ns)
	const bufferDuration = wca.REFERENCE_TIME(100 * 10000)
	if err := s.ac.Initialize(
		wca.AUDCLNT_SHAREMODE_SHARED,
		wca.AUDCLNT_STREAMFLAGS_LOOPBACK,
		bufferDuration,
		0,
		s.wfx,
		nil,
	); err != nil {
		s.close()
		return nil, fmt.Errorf("Initialize loopback falló: %v", err)
	}

	if err := s.ac.GetService(wca.IID_IAudioCaptureClient, &s.acc); err != nil || s.acc == nil {
		s.close()
		return nil, fmt.Errorf("GetService IAudioCaptureClient falló: %v", err)
	}

	if err := s.ac.Start(); err != nil {
		s.close()
		return nil, fmt.Errorf("IAudioClient.Start falló: %v", err)
	}

	return s, nil
}

func currentDefaultRenderID(mmde *wca.IMMDeviceEnumerator) string {
	var dev *wca.IMMDevice
	if err := mmde.GetDefaultAudioEndpoint(wca.ERender, wca.EConsole, &dev); err != nil || dev == nil {
		return ""
	}
	defer dev.Release()
	var id string
	_ = dev.GetId(&id)
	return id
}

func runAudioLoopback(dstRate int, dstChannels int) error {
	if dstRate <= 0 {
		dstRate = 48000
	}
	if dstChannels < 1 || dstChannels > 2 {
		dstChannels = 2
	}

	runtime.LockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		return err
	}
	defer ole.CoUninitialize()

	var mmde *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &mmde); err != nil {
		return err
	}
	defer mmde.Release()

	sess, err := openDefaultLoopback(mmde)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Aviso loopback inicial: %v (emitiendo silencio hasta que haya salida)\n", err)
	}
	defer func() {
		if sess != nil {
			sess.close()
		}
	}()

	stopCh := make(chan os.Signal, 1)
	signal.Notify(stopCh, os.Interrupt)

	// Reloj de pared exacto en pasos de 10 ms para evitar cualquier deriva.
	framesPer10ms := dstRate / 100
	bytesPer10ms := framesPer10ms * dstChannels * 2
	maxQueueBytes := bytesPer10ms * 8 // máx 80 ms en cola
	var pcmQueue []byte
	outChunk := make([]byte, bytesPer10ms)

	t0 := time.Now()
	var tick int64
	for {
		select {
		case <-stopCh:
			return nil
		default:
		}

		tick++
		targetTime := t0.Add(time.Duration(tick) * 10 * time.Millisecond)
		if sleepDur := time.Until(targetTime); sleepDur > 0 {
			time.Sleep(sleepDur)
		}

		// Cada 500 ms (50 ticks) comprobar si cambió el dispositivo de salida por defecto.
		if tick%50 == 0 {
			defID := currentDefaultRenderID(mmde)
			if (sess == nil && defID != "") || (sess != nil && defID != "" && defID != sess.deviceID) {
				if sess != nil {
					sess.close()
					sess = nil
				}
				if newSess, err := openDefaultLoopback(mmde); err == nil {
					sess = newSess
				}
			}
		}

		// Drenar todos los paquetes disponibles de WASAPI loopback.
		if sess != nil {
			for {
				var packetLength uint32
				if err := sess.acc.GetNextPacketSize(&packetLength); err != nil {
					sess.close()
					sess = nil
					break
				}
				if packetLength == 0 {
					break
				}
				var data *byte
				var numFrames uint32
				var flags uint32
				if err := sess.acc.GetBuffer(&data, &numFrames, &flags, nil, nil); err != nil {
					sess.close()
					sess = nil
					break
				}
				if numFrames > 0 {
					var stereo []float32
					if (flags & wca.AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nil {
						stereo = make([]float32, int(numFrames)*2)
					} else {
						byteLen := int(numFrames) * sess.frameSize
						raw := unsafe.Slice(data, byteLen)
						stereo = decodeMixToStereoFloat32(raw, int(numFrames), sess.srcChans, sess.srcBits, sess.isFloat)
					}
					_ = sess.acc.ReleaseBuffer(numFrames)
					resampled := resampleStereoLinear(stereo, sess.srcRate, dstRate)
					pcmBytes := float32StereoToS16LE(resampled, dstChannels)
					pcmQueue = append(pcmQueue, pcmBytes...)
				} else {
					_ = sess.acc.ReleaseBuffer(numFrames)
				}
			}
		}

		if len(pcmQueue) > maxQueueBytes {
			pcmQueue = pcmQueue[len(pcmQueue)-maxQueueBytes:]
		}

		if len(pcmQueue) >= bytesPer10ms {
			copy(outChunk, pcmQueue[:bytesPer10ms])
			pcmQueue = pcmQueue[bytesPer10ms:]
		} else {
			n := copy(outChunk, pcmQueue)
			pcmQueue = pcmQueue[:0]
			for i := n; i < bytesPer10ms; i++ {
				outChunk[i] = 0
			}
		}

		if _, err := os.Stdout.Write(outChunk); err != nil {
			return nil
		}
	}
}

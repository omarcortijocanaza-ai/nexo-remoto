//go:build windows

package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

// findRenderDeviceByMatch busca un dispositivo de salida activo cuyo nombre
// contenga `match` (insensible a mayúsculas). JAMÁS devuelve el dispositivo por
// defecto si no hay coincidencia.
func findRenderDeviceByMatch(mmde *wca.IMMDeviceEnumerator, match string) (*wca.IMMDevice, string, error) {
	trimmed := strings.TrimSpace(match)
	if trimmed == "" {
		return nil, "", fmt.Errorf("Debe especificarse --match con el nombre del dispositivo de destino")
	}
	needle := strings.ToLower(trimmed)

	var dc *wca.IMMDeviceCollection
	if err := mmde.EnumAudioEndpoints(wca.ERender, wca.DEVICE_STATE_ACTIVE, &dc); err != nil {
		return nil, "", err
	}
	defer dc.Release()

	var count uint32
	if err := dc.GetCount(&count); err != nil {
		return nil, "", err
	}

	for i := uint32(0); i < count; i++ {
		var item *wca.IMMDevice
		if err := dc.Item(i, &item); err != nil || item == nil {
			continue
		}
		name := ""
		var ps *wca.IPropertyStore
		if err := item.OpenPropertyStore(wca.STGM_READ, &ps); err == nil && ps != nil {
			var pv wca.PROPVARIANT
			if err := ps.GetValue(&wca.PKEY_Device_FriendlyName, &pv); err == nil {
				name = pv.String()
				_ = pv.Clear()
			}
			ps.Release()
		}
		if strings.Contains(strings.ToLower(name), needle) {
			return item, name, nil
		}
		item.Release()
	}

	return nil, "", fmt.Errorf("No existe ningún dispositivo de salida activo que coincida con %q", match)
}

// s16leToStereoFloat32 convierte bytes s16le (1 o 2 canales) en muestras float32 estéreo.
func s16leToStereoFloat32(raw []byte, srcChannels int) []float32 {
	if srcChannels < 1 {
		srcChannels = 1
	}
	frameBytes := srcChannels * 2
	frames := len(raw) / frameBytes
	if frames <= 0 {
		return nil
	}
	out := make([]float32, frames*2)
	for f := 0; f < frames; f++ {
		off := f * frameBytes
		s0 := int16(binary.LittleEndian.Uint16(raw[off : off+2]))
		l := float32(s0) / 32768.0
		r := l
		if srcChannels >= 2 {
			s1 := int16(binary.LittleEndian.Uint16(raw[off+2 : off+4]))
			r = float32(s1) / 32768.0
		}
		out[f*2] = l
		out[f*2+1] = r
	}
	return out
}

// encodeStereoFloat32ToMix codifica muestras float32 estéreo al formato de mezcla del dispositivo.
func encodeStereoFloat32ToMix(stereo []float32, dstChannels int, bitsPerSample int, isFloat bool) []byte {
	frames := len(stereo) / 2
	if frames <= 0 || dstChannels <= 0 {
		return nil
	}
	bytesPerSample := bitsPerSample / 8
	if bytesPerSample <= 0 {
		return nil
	}
	out := make([]byte, frames*dstChannels*bytesPerSample)
	for f := 0; f < frames; f++ {
		l := stereo[f*2]
		r := stereo[f*2+1]
		for ch := 0; ch < dstChannels; ch++ {
			sample := l
			if ch == 1 {
				sample = r
			} else if ch > 1 {
				sample = 0
			}
			if sample > 1.0 {
				sample = 1.0
			} else if sample < -1.0 {
				sample = -1.0
			}
			off := (f*dstChannels + ch) * bytesPerSample
			if isFloat && bytesPerSample == 4 {
				binary.LittleEndian.PutUint32(out[off:off+4], math.Float32bits(sample))
			} else if bytesPerSample == 2 {
				v := int16(math.Round(float64(sample) * 32767.0))
				binary.LittleEndian.PutUint16(out[off:off+2], uint16(v))
			} else if bytesPerSample == 4 {
				v := int32(math.Round(float64(sample) * 2147483647.0))
				binary.LittleEndian.PutUint32(out[off:off+4], uint32(v))
			}
		}
	}
	return out
}

func runAudioPlay(match string, srcRate int, srcChannels int) (int, error) {
	if srcRate <= 0 {
		srcRate = 48000
	}
	if srcChannels < 1 || srcChannels > 2 {
		srcChannels = 1
	}

	runtime.LockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		return 1, err
	}
	defer ole.CoUninitialize()

	var mmde *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &mmde); err != nil {
		return 1, err
	}
	defer mmde.Release()

	dev, _, err := findRenderDeviceByMatch(mmde, match)
	if err != nil {
		// Código de salida 3 obligatorio cuando el dispositivo no existe.
		return 3, err
	}
	defer dev.Release()

	var ac *wca.IAudioClient
	if err := dev.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &ac); err != nil {
		return 1, fmt.Errorf("Activate IAudioClient falló: %v", err)
	}
	defer ac.Release()

	var wfx *wca.WAVEFORMATEX
	if err := ac.GetMixFormat(&wfx); err != nil || wfx == nil {
		return 1, fmt.Errorf("GetMixFormat falló: %v", err)
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(wfx)))

	isFloat := isWaveFormatFloat(wfx)
	dstRate := int(wfx.NSamplesPerSec)
	dstChans := int(wfx.NChannels)
	dstBits := int(wfx.WBitsPerSample)
	dstFrameBytes := int(wfx.NBlockAlign)

	const bufferDuration = wca.REFERENCE_TIME(100 * 10000) // 100 ms
	if err := ac.Initialize(wca.AUDCLNT_SHAREMODE_SHARED, 0, bufferDuration, 0, wfx, nil); err != nil {
		return 1, fmt.Errorf("IAudioClient.Initialize falló: %v", err)
	}

	var bufferFrameCount uint32
	if err := ac.GetBufferSize(&bufferFrameCount); err != nil {
		return 1, fmt.Errorf("GetBufferSize falló: %v", err)
	}

	var arc *wca.IAudioRenderClient
	if err := ac.GetService(wca.IID_IAudioRenderClient, &arc); err != nil || arc == nil {
		return 1, fmt.Errorf("GetService IAudioRenderClient falló: %v", err)
	}
	defer arc.Release()

	if err := ac.Start(); err != nil {
		return 1, fmt.Errorf("IAudioClient.Start falló: %v", err)
	}
	defer ac.Stop()

	// Leer bloques de ~10 ms desde stdin.
	srcFrameBytes := srcChannels * 2
	chunkBytes := (srcRate / 100) * srcFrameBytes
	if chunkBytes < srcFrameBytes {
		chunkBytes = srcFrameBytes * 480
	}
	readBuf := make([]byte, chunkBytes)
	var leftover []byte

	for {
		n, readErr := os.Stdin.Read(readBuf)
		if n > 0 {
			leftover = append(leftover, readBuf[:n]...)
			completeBytes := (len(leftover) / srcFrameBytes) * srcFrameBytes
			if completeBytes > 0 {
				rawFrames := leftover[:completeBytes]
				stereo := s16leToStereoFloat32(rawFrames, srcChannels)
				resampled := resampleStereoLinear(stereo, srcRate, dstRate)
				mixBytes := encodeStereoFloat32ToMix(resampled, dstChans, dstBits, isFloat)
				leftover = append([]byte(nil), leftover[completeBytes:]...)

				totalFrames := len(mixBytes) / dstFrameBytes
				writtenFrames := 0
				for writtenFrames < totalFrames {
					var padding uint32
					if err := ac.GetCurrentPadding(&padding); err != nil {
						return 1, fmt.Errorf("GetCurrentPadding falló: %v", err)
					}
					avail := int(bufferFrameCount - padding)
					if avail <= 0 {
						time.Sleep(4 * time.Millisecond)
						continue
					}
					toWrite := totalFrames - writtenFrames
					if toWrite > avail {
						toWrite = avail
					}
					var data *byte
					if err := arc.GetBuffer(uint32(toWrite), &data); err != nil {
						return 1, fmt.Errorf("IAudioRenderClient.GetBuffer falló: %v", err)
					}
					byteCount := toWrite * dstFrameBytes
					startOff := writtenFrames * dstFrameBytes
					dstSlice := unsafe.Slice(data, byteCount)
					copy(dstSlice, mixBytes[startOff:startOff+byteCount])
					if err := arc.ReleaseBuffer(uint32(toWrite), 0); err != nil {
						return 1, fmt.Errorf("IAudioRenderClient.ReleaseBuffer falló: %v", err)
					}
					writtenFrames += toWrite
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				// Esperar a que se vacíe el buffer antes de cerrar.
				for i := 0; i < 25; i++ {
					var padding uint32
					if err := ac.GetCurrentPadding(&padding); err != nil || padding == 0 {
						break
					}
					time.Sleep(5 * time.Millisecond)
				}
				return 0, nil
			}
			return 1, readErr
		}
	}
}

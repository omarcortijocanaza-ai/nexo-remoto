# Bitácora Fase F3 — Ejecución (Argon 4)

- **Fase:** F3 · Agente nativo `nexo-agent.exe` en Go
- **Rama:** `windows-port`
- **Etiqueta de inicio:** `f3-start` (`60da820`)
- **Fecha:** 2026-10-16

---

## 1. Archivos creados o modificados

- `native/agent/go.mod` y `native/agent/go.sum`: módulo `nexo/agent` (`go 1.24`) con `golang.org/x/sys v0.31.0`, `github.com/go-ole/go-ole v1.3.0` y `github.com/moutend/go-wca v0.3.0`.
- `native/agent/main.go`: punto de entrada con activación inmediata de `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`, acoplamiento al escritorio interactivo `Default` (`attachDefaultDesktop()`) y subcomandos `serve`, `audio-loopback`, `audio-play`, `audio-devices` y `version`.
- `native/agent/protocol.go`: servidor JSON-lines por `stdin`/`stdout` usando `bufio.Reader.ReadBytes('\n')` (sin límite de 64 KiB, soporta líneas > 1 MiB), despacho secuencial con `recover()` por petición, emisión de eventos asíncronos y cierre inmediato al recibir EOF en `stdin`.
- `native/agent/input.go`: inyección Win32 `SendInput` con estructura `winInput` de 40 bytes en `amd64`, coordenadas absolutas normalizadas sobre el escritorio virtual completo (`MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`), verificación post-movimiento con `GetCursorPos`/`SetCursorPos`, botones de ratón, rueda vertical/horizontal con `NEXO_WHEEL_FACTOR`, texto `KEYEVENTF_UNICODE` con soporte de pares sustitutos UTF-16 y cadencia por unidad de código para compatibilidad con WinUI 3 (`Notepad.exe` de Windows 11 24H2), y teclas por scan code (`KEYEVENTF_SCANCODE` / `KEYEVENTF_EXTENDEDKEY`) con liberación automática de modificadores en caso de error.
- `native/agent/monitors.go`: enumeración DXGI mediante COM (`CreateDXGIFactory1` → `EnumAdapters1(0)` → `EnumOutputs` → `GetDesc`) en hilo bloqueado con `runtime.LockOSThread()` y `CoInitializeEx`, más métricas de escritorio virtual (`SM_XVIRTUALSCREEN`, `SM_YVIRTUALSCREEN`, `SM_CXVIRTUALSCREEN`, `SM_CYVIRTUALSCREEN`).
- `native/agent/clipboard.go`: lectura y escritura de `CF_UNICODETEXT` con hasta 10 reintentos de 10 ms ante bloqueo del portapapeles.
- `native/agent/desktops.go`: lectura de `VirtualDesktopIDs` y `CurrentVirtualDesktop` desde el registro de Windows 11/10 (sección 4.4) y cambio de escritorio mediante `Win+Ctrl+Left/Right` con pausa de 80 ms.
- `native/agent/foreground.go`: consulta de `GetForegroundWindow`, ruta del proceso (`QueryFullProcessImageNameW`) y elevación (`OpenProcessToken` + `TokenElevation`, asumiendo `elevated: true` ante `ERROR_ACCESS_DENIED` por UIPI).
- `native/agent/session.go`: vigilancia del escritorio de entrada (`OpenInputDesktop` cada 500 ms para emitir `{"event":"desktop","state":"normal"|"secure"}`), vigilancia de topología de monitores cada 2 s (`{"event":"displays-changed"}`) e hilo dedicado bloqueado para `SetThreadExecutionState` (`keepawake`).
- `native/agent/audio_loopback.go`: captura WASAPI loopback a `s16le` 48 kHz estéreo por `stdout` con bucle temporizado por reloj monotónico cada 10 ms (1920 bytes por tick), generación de silencio sintético cuando el sistema está en silencio, conversión `float32`/`s16`/`s32` → `s16le`, remuestreo lineal estéreo cuando el formato de mezcla no es 48 kHz y seguimiento automático si cambia el dispositivo de salida predeterminado.
- `native/agent/audio_play.go`: reproducción WASAPI de PCM `s16le` desde `stdin` hacia el dispositivo de salida activo cuyo nombre contiene `--match` (insensible a mayúsculas); devuelve código de salida `3` si ningún dispositivo coincide y jamás cae en el dispositivo por defecto.
- `native/agent/agent_test.go`: 5 pruebas unitarias puras (`TestWinInputSize`, `TestNormalizeVirtualCoord`, `TestComputeDesktopInfoFromBytes`, `TestBuildTextInputEventsSurrogatePair`, `TestAudioFloat32AndResample`).
- `scripts/windows/agent-probe.ps1`: script de prueba integral del protocolo `serve`.
- `docs/windows/bitacora/F3-argon.md`: esta bitácora.

---

## 2. Verificaciones ejecutadas y salidas reales

### 2.1 `go vet ./...` y `go test -v ./...`

```text
PS D:\nexo-remoto\native\agent> go vet ./... ; go test -v ./...
=== RUN   TestWinInputSize
--- PASS: TestWinInputSize (0.00s)
=== RUN   TestNormalizeVirtualCoord
--- PASS: TestNormalizeVirtualCoord (0.00s)
=== RUN   TestComputeDesktopInfoFromBytes
--- PASS: TestComputeDesktopInfoFromBytes (0.00s)
=== RUN   TestBuildTextInputEventsSurrogatePair
--- PASS: TestBuildTextInputEventsSurrogatePair (0.00s)
=== RUN   TestAudioFloat32AndResample
--- PASS: TestAudioFloat32AndResample (0.00s)
PASS
ok  	nexo/agent	0.036s
```

### 2.2 Compilación con `scripts/windows/build.ps1` y `version`

```text
PS D:\nexo-remoto> pwsh -NoProfile -File scripts/windows/build.ps1
=== NEXO · Compilación de binarios Windows ===
Directorio de salida: D:\nexo-remoto\bin\win

[1/2] Compilando nexo-agent.exe...
  [OK] D:\nexo-remoto\bin\win\nexo-agent.exe (2347520 bytes)
[2/2] Omitiendo gpu-webrtc.exe (native\gpu-webrtc\main.go aún no existe; se crea en F5).

Compilación finalizada correctamente.

PS D:\nexo-remoto> .\bin\win\nexo-agent.exe version
nexo-agent version 1 (windows/amd64)
```

### 2.3 Dispositivos de audio (`bin\win\nexo-agent.exe audio-devices`)

```text
PS D:\nexo-remoto> .\bin\win\nexo-agent.exe audio-devices
{
  "defaultOutput": "Auriculares (AirPods de Letzus)",
  "inputs": [
    "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
    "Micrófono (DroidCam Virtual Audio)",
    "Voicemeeter Out B3 (VB-Audio Voicemeeter VAIO)",
    "Voicemeeter Out A1 (VB-Audio Voicemeeter VAIO)",
    "Voicemeeter Out A3 (VB-Audio Voicemeeter VAIO)",
    "Voicemeeter Out A2 (VB-Audio Voicemeeter VAIO)",
    "Voicemeeter Out B2 (VB-Audio Voicemeeter VAIO)",
    "Voicemeeter Out A5 (VB-Audio Voicemeeter VAIO)",
    "Varios micrófonos (Realtek(R) Audio)",
    "Voicemeeter Out A4 (VB-Audio Voicemeeter VAIO)"
  ],
  "outputs": [
    "LG FULL HD (NVIDIA High Definition Audio)",
    "Voicemeeter AUX Input (VB-Audio Voicemeeter VAIO)",
    "Headphones (Realtek(R) Audio)",
    "24E3 (NVIDIA High Definition Audio)",
    "Voicemeeter VAIO3 Input (VB-Audio Voicemeeter VAIO)",
    "Auriculares (AirPods de Letzus)",
    "Altavoces (Realtek(R) Audio)",
    "Voicemeeter Input (VB-Audio Voicemeeter VAIO)"
  ]
}
```

> **Nota sobre cable virtual (Regla 6):** En este equipo está instalado **VB-Audio Voicemeeter VAIO** (`"Voicemeeter Input (VB-Audio Voicemeeter VAIO)"` como entrada de render virtual y `"Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)"` como salida de grabación virtual), en lugar del paquete independiente VB-CABLE (`"CABLE Input"`). Se deja documentado aquí para tenerlo presente en F7 (`NEXO_MIC_DEVICE_MATCH`).

### 2.4 Prueba integral de `serve` (`pwsh -File scripts/windows/agent-probe.ps1`)

```text
1) READY: {"dpiAware":true,"elevated":false,"event":"ready","session":1,"user":"USUARIO","version":"1"}

2) MONITORS:

index name         description            x   y width height primary rotation
----- ----         -----------            -   - ----- ------ ------- --------
    0 \\.\DISPLAY1 Generic PnP Monitor    0   0  1920   1080    True        0
    1 \\.\DISPLAY2 Generic PnP Monitor 1920 -88  1920   1080   False        0
   Escritorio virtual: x=0 y=-88 width=3840 height=1168

3) PRUEBA DE TEXTO Y PORTAPAPELES EN NOTEPAD:
   Texto enviado     : "Hola ñandú áéíóú 😀\n2ª línea"
   Texto portapapeles: "Hola ñandú áéíóú 😀\n2ª línea"
   Resultado         : IGUAL

4) POINTER MOVE (centro monitor 0):
   Esperada: (960, 540) | Real ([System.Windows.Forms.Cursor]::Position): (960, 541) | Diferencia: dx=0 px, dy=1 px

5) DESKTOP.INFO: supported=True index=1 count=2

6) FOREGROUND: process=Notepad.exe elevated=False title=*nexo-probe-ba266cd0.txt: Bloc de notas

7) CIERRE POR STDIN EOF: exited=True en 8 ms (código=0)
```

### 2.5 Verificación de `audio-loopback` (5 s con sonido y 5 s en silencio) y `audio-play`

```text
=== 1. audio-loopback 5 s CON SONIDO ===
loop-sound.raw: 944640 bytes (4.92 s) | loop-sound.wav: 944718 bytes

=== 2. audio-loopback 5 s EN SILENCIO ===
loop-silence.raw: 954240 bytes (4.97 s) | loop-silence.wav: 954318 bytes

=== 3. audio-play 3 s hacia cable virtual VB-Audio ("Voicemeeter Input") ===
audio-play --match "Voicemeeter Input" exitCode=0 stderr=

=== 4. audio-play con --match "NoExiste" (debe salir con código 3) ===
audio-play --match "NoExiste" exitCode=3 stderr=Error en audio-play: No existe ningún dispositivo de salida activo que coincida con "NoExiste"

=== 5. audio-play con --match "CABLE Input" (comprobación en este equipo) ===
audio-play --match "CABLE Input" exitCode=3 stderr=Error en audio-play: No existe ningún dispositivo de salida activo que coincida con "CABLE Input"
```

---

## 3. Hallazgos técnicos relevantes

1. **Cadencia `VK_PACKET` (`KEYEVENTF_UNICODE`) en el nuevo `Notepad.exe` (WinUI 3 / `RichEditD2DPT`) de Windows 11 24H2:**
   Cuando se inyectan múltiples unidades UTF-16 `KEYEVENTF_UNICODE` en una sola llamada `SendInput` (incluso el par sustituto `[down(high), up(high), down(low), up(low)]`), el control `RichEditD2DPT` de WinUI 3 drena la cola de mensajes `WM_KEYDOWN(VK_PACKET)` en un bucle `PeekMessage` antes de traducirlos con `ToUnicodeEx`, sobrescribiendo `pti->wchInjected` en `win32kfull` con la última unidad inyectada. Enviar cada unidad UTF-16 (`[down(u), up(u)]`) con una pausa de 18 ms entre unidades (para cadenas interactivas de hasta 128 bytes) garantiza que `Notepad.exe` reciba exactamente `"Hola ñandú áéíóú 😀\n2ª línea"` (`Resultado: IGUAL`).
2. **Escritorio interactivo `Winsta0\Default`:**
   Tanto `nexo-agent.exe` (`attachDefaultDesktop()`) como `scripts/windows/agent-probe.ps1` se aseguran de ejecutarse sobre el escritorio interactivo `Default` cuando son invocados desde consolas o sandboxes secundarios.

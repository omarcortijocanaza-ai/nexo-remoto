# Bitácora Fase F3 — Revisión (Opus 5.5)

- **Fase:** F3 · Revisión del agente nativo `nexo-agent.exe`
- **Rama:** `windows-port`
- **Commit revisado:** `9eb63fd`
- **Fecha:** 2026-10-16

---

## 1. Contraste del protocolo y subcomandos contra la sección 4.2

Se revisaron todos los archivos de `native/agent/`:

| Operación / Subcomando | Contrato (sección 4.2) | Estado en `native/agent` |
|---|---|---|
| `ready` | `{"event":"ready","version":"1","dpiAware":true,"elevated":bool,"session":N,"user":"..."}` | Cumple (`protocol.go:70-77`). `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` se invoca como primera instrucción de `main()`. |
| `ping` | `{"id":N,"ok":true}` | Cumple. |
| `monitors` | `{"id":N,"ok":true,"monitors":[...],"virtual":{...}}` | Cumple (`monitors.go`): COM DXGI `CreateDXGIFactory1` → `EnumAdapters1(0)` → `EnumOutputs` → `GetDesc` en hilo con `runtime.LockOSThread()` y `CoInitializeEx`. |
| `pointer` | `move\|down\|up\|click`, coordenadas absolutas sobre escritorio virtual + verificación `GetCursorPos`/`SetCursorPos` | Cumple (`input.go`). |
| `scroll` | `x, y, dx, dy` con `NEXO_WHEEL_FACTOR` | Cumple (`input.go`). |
| `text` | `KEYEVENTF_UNICODE` con pares sustitutos UTF-16, `\n` → Enter (`0x1C`), `\t` → Tab (`0x0F`) | Cumple (`input.go`). |
| `keys` | `events:[{scan,ext,up}]`, libera modificadores en orden inverso ante error | Cumple (`input.go:343-395`). |
| `clipboard.get` / `clipboard.set` | `CF_UNICODETEXT`, 10 reintentos × 10 ms | Cumple (`clipboard.go`). |
| `desktop.info` / `desktop.switch` | Registro Windows 11/10 (`VirtualDesktopIDs`, `CurrentVirtualDesktop`), `1..N \| "next" \| "previous"` | Cumple (`desktops.go`). Se corrigió durante esta revisión la espera entre pasos (ver sección 2). |
| `foreground` | `{title, process, elevated}` (`elevated:true` si `OpenProcessToken` da `ERROR_ACCESS_DENIED`) | Cumple (`foreground.go`). |
| `keepawake` | `SetThreadExecutionState` en hilo bloqueado (`LockOSThread`) | Cumple (`session.go`). |
| `desktop.state` y eventos | `{"event":"desktop","state":"normal"\|"secure"}` cada 500 ms y `{"event":"displays-changed"}` | Cumple (`session.go`). |
| `audio-loopback` | WASAPI loopback → `s16le` 48 kHz estéreo, silencio sintético cada 10 ms, sigue cambio de dispositivo | Cumple (`audio_loopback.go`). |
| `audio-play` | Reproduce en `--match`; sale con código `3` si no existe; jamás usa el dispositivo por defecto | Cumple (`audio_play.go:23-63, 152-156`). |

---

## 2. Defecto detectado y corregido en la revisión

- **Transiciones múltiples o consecutivas en `desktop.switch` (`native/agent/desktops.go`):**
  En Windows 11 24H2 (`10.0.26100`), `Explorer.exe` tarda ~200–250 ms en completar la animación de cambio de escritorio virtual tras recibir `Win+Ctrl+Left/Right` y actualizar `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops\CurrentVirtualDesktop`. Con la pausa original de 80 ms, al saltar 2 escritorios (`1 → 3`) o encadenar `next` y `previous`, `Explorer.exe` ignoraba el segundo atajo por seguir animando el primero.
  - **Corrección:** Se añadió `waitDesktopIndex(expected, 450*time.Millisecond)` más 90 ms de asentamiento por cada paso en `switchDesktop`.

---

## 3. Verificaciones de revisión y salidas reales

### 3.1 Estructura `INPUT` en `amd64`, coordenadas en monitores con origen negativo y soltado de modificadores

- `unsafe.Sizeof(winInput{}) == 40` verificado por `TestWinInputSize`.
- En este equipo el monitor secundario (`\\.\DISPLAY2`) tiene coordenada `y = -88` (`virtual: {x:0, y:-88, width:3840, height:1168}`). El movimiento a ambos monitores responde `ok:true`:

```text
=== 2. COORDENADAS ABSOLUTAS EN AMBOS MONITORES (INCLUIDO Y NEGATIVO -88) ===
Monitores: {"id":201,"monitors":[{"index":0,"name":"\\\\.\\DISPLAY1","description":"Generic PnP Monitor","x":0,"y":0,"width":1920,"height":1080,"primary":true,"rotation":0},{"index":1,"name":"\\\\.\\DISPLAY2","description":"Generic PnP Monitor","x":1920,"y":-88,"width":1920,"height":1080,"primary":false,"rotation":0}],"ok":true,"virtual":{"x":0,"y":-88,"width":3840,"height":1168}}
Monitor 0 (\\.\DISPLAY1, origen=0,0) -> move(960,540): {"id":210,"ok":true}
Monitor 1 (\\.\DISPLAY2, origen=1920,-88) -> move(2880,452): {"id":211,"ok":true}
```

### 3.2 Robustez de `serve` (JSON inválido, op desconocida, línea de 1 MiB y cierre de `stdin` a mitad de op)

```text
=== 1. ROBUSTEZ DE SERVE (JSON inválido, op desconocida, JSON de 1 MiB) ===
ready: {"dpiAware":true,"elevated":false,"event":"ready","session":1,"user":"USUARIO","version":"1"}
JSON inválido -> {"error":"JSON de petición inválido","id":null,"ok":false}
Op desconocida -> {"error":"Operación desconocida: no_existe","id":101,"ok":false}
JSON 1 MiB (clipboard.set) -> {"id":102,"ok":true}
clipboard.get longitud tras 1 MiB: 1048576 bytes (esperado 1048576)
Ping posterior -> {"id":104,"ok":true}

=== 4. CIERRE DE STDIN A MITAD DE UNA OP LARGA ===
Proceso serve terminó tras cerrar stdin a mitad de op en 91 ms (código=0)
```

### 3.3 Escritorios virtuales (`1, 3, 2, next, previous` y escritorio inexistente `4`)

Ruta de registro utilizada por Windows 11 24H2 en este equipo:
`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops` (tanto `VirtualDesktopIDs` como `CurrentVirtualDesktop` viven en esta clave).

```text
Inicial: {"count":3,"id":1,"index":1,"ok":true,"supported":true}
switch(1) -> resp={"id":2,"index":1,"ok":true} info={"count":3,"id":3,"index":1,"ok":true,"supported":true}
switch(3) -> resp={"id":2,"index":3,"ok":true} info={"count":3,"id":3,"index":3,"ok":true,"supported":true}
switch(2) -> resp={"id":2,"index":2,"ok":true} info={"count":3,"id":3,"index":2,"ok":true,"supported":true}
switch("next") -> resp={"id":2,"index":3,"ok":true} info={"count":3,"id":3,"index":3,"ok":true,"supported":true}
switch("previous") -> resp={"id":2,"index":2,"ok":true} info={"count":3,"id":3,"index":2,"ok":true,"supported":true}
switch(4) -> resp={"error":"Escritorio 4 no existe (hay 3)","id":2,"ok":false} info={"count":3,"id":3,"index":2,"ok":true,"supported":true}
```

### 3.4 Captura WASAPI `audio-loopback` durante 60 s (comprobación de deriva ≤ ±0,1 s)

```text
=== 5. WASAPI AUDIO-LOOPBACK 60 SEGUNDOS (COMPROBACIÓN DE DERIVA) ===
Captura 60 s: bytes=11516160 | duración PCM=59.980 s | reloj=60.013 s | deriva=-0.020 s
```

La deriva medida en 60 segundos es de `-0,020 s` (dentro del margen exigido de `60 s ± 0,1 s`).

---

## 4. Dictamen

Fase **F3 aprobada** (`f3-ok`).

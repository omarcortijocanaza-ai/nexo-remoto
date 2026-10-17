# NEXO en Windows · plan de migración, contratos y prompts

> Escrito el 2026-10-16 por Opus 5.5 después de leer todo el código de
> `~/Downloads/teclado-remoto` (etiqueta `linux-base-2026-10-16`).
> **Ejecutor:** Argon 4 (trabajo en bruto). **Revisor y corrector:** Opus 5.5.
> Repositorio privado: `omarcortijocanaza-ai/nexo-remoto`.

## Índice

0. [Cómo usar este plan (para Letzus)](#0-cómo-usar-este-plan-para-letzus)
1. [Decisiones ya tomadas](#1-decisiones-ya-tomadas)
2. [Qué hay hoy y qué se conserva](#2-qué-hay-hoy-y-qué-se-conserva)
3. [Arquitectura de destino en Windows](#3-arquitectura-de-destino-en-windows)
4. [Contratos técnicos](#4-contratos-técnicos)
5. [Defectos encontrados y mejoras](#5-defectos-encontrados-y-mejoras)
6. [Trampas conocidas de Windows](#6-trampas-conocidas-de-windows)
7. [Encabezados comunes de los prompts](#7-encabezados-comunes-de-los-prompts)
8. [Fases con sus prompts](#8-fases-con-sus-prompts)
9. [Matriz final de pruebas](#9-matriz-final-de-pruebas)
10. [Riesgos y plan B](#10-riesgos-y-plan-b)

---

## 0. Cómo usar este plan (para Letzus)

### Una vez, en Windows

1. Instala Git y GitHub CLI (PowerShell normal):
   ```powershell
   winget install --id Git.Git -e
   winget install --id GitHub.cli -e
   ```
2. Cierra y abre PowerShell. Inicia sesión con **la misma cuenta de GitHub** de Linux
   (`omarcortijocanaza-ai`):
   ```powershell
   gh auth login
   ```
3. Clona el repositorio en una ruta **sin espacios ni acentos**:
   ```powershell
   mkdir C:\nexo
   gh repo clone omarcortijocanaza-ai/nexo-remoto C:\nexo\nexo-remoto
   cd C:\nexo\nexo-remoto
   git checkout windows-port
   ```
   (La rama `windows-port` ya existe en GitHub; `main` es el Linux estable.)

### En cada fase

```text
┌───────────────┐   ┌────────────────┐   ┌──────────────────┐   ┌───────────────┐
│ Sesión nueva  │──▶│ Argon 4 hace   │──▶│ Sesión nueva de  │──▶│ ¿Etiqueta     │
│ de Argon 4 en │   │ la fase y deja │   │ Opus 5.5: pega el│   │ fN-ok? → fase │
│ C:\nexo\...   │   │ su bitácora    │   │ prompt R-FN      │   │ siguiente     │
│ pega A-FN     │   │ y su commit    │   │ revisa y corrige │   │ si no, repetir│
└───────────────┘   └────────────────┘   └──────────────────┘   └───────────────┘
```

1. Abre una sesión **nueva** de Argon 4 con la carpeta `C:\nexo\nexo-remoto`.
2. Pega el **encabezado común del ejecutor** (sección 7) seguido del prompt **A-FN** de la
   fase.
3. Cuando termine, abre una sesión **nueva** de Opus 5.5 (Claude Code) en la misma carpeta y
   pega el **encabezado común del revisor** seguido del prompt **R-FN**.
4. Si Opus deja la etiqueta `fN-ok`, pasa a la fase siguiente. Si la rechaza, Opus deja en
   `docs/windows/bitacora/FN-reencargo.md` un prompt corregido para Argon: úsalo en vez del
   original.
5. Los pasos marcados **👤 TÚ** los haces tú (instalar un driver, probar desde el celular,
   escribir una contraseña). Ningún agente debe escribir tus contraseñas.

Reglas para ti:
- **Una fase por sesión.** No pegues dos fases juntas aunque parezcan pequeñas.
- **No te saltes la revisión.** Los errores que dejó Kimi en el widget de eww eran
  justamente de los que "corren sin quejarse pero no hacen lo que deberían".
- Si Argon 4 no puede ejecutar comandos en tu herramienta, corre tú los bloques de
  "Verificación" y pégale la salida.
- Si una fase se tuerce mucho: `git reset --hard fN-start` y se repite, en vez de parchear.

### Orden y duración aproximada

| Fase | Qué deja funcionando | Obligatoria |
|---|---|---|
| F0 | Herramientas instaladas, línea base medida | Sí |
| F1 | `server.js` arranca en Windows; Linux idéntico | Sí |
| F2 | Correcciones de seguridad y robustez comunes | Sí |
| F3 | `nexo-agent.exe`: entrada, monitores, portapapeles, escritorios, audio | Sí |
| F4 | **Primer control remoto real** (entrada + vídeo JPEG + portal) | Sí |
| F5 | Vídeo H.264 por NVENC (ruta principal) | Sí |
| F6 | Audio del sistema y respaldo WebRTC/CPU | Sí |
| F7 | Micrófono del celular con VB-CABLE | Sí |
| F8 | Lanzador, ciclo de vida, `nexo-control`, túnel, aviso del enlace | Sí |
| F9 | Arranque automático, autologon, energía, firewall, bandeja | Sí |
| F10 | Documentación y pruebas integrales | Sí |
| L | Verificación en Linux antes de fusionar a `main` | Sí (al volver a Arch) |
| O1 | Medición por datos móviles + TURN | Opcional, muy recomendada por el CGNAT |
| O2 | HTTPS en LAN | Opcional |
| O3 | Segunda sesión aislada en Windows (investigación) | Opcional |

---

## 1. Decisiones ya tomadas

No se vuelven a discutir. Si un agente cree que alguna es un error, lo anota en la bitácora
y **sigue el plan**.

| # | Decisión | Motivo |
|---|---|---|
| D1 | Repositorio privado `omarcortijocanaza-ai/nexo-remoto`, rama de trabajo `windows-port`. `main` = Linux estable. | No romper el host Linux mientras se migra. |
| D2 | **Un solo código base** con capa `platform/` (`linux` y `windows`), no un fork. | Cliente, emparejamiento, auth, archivos y protocolo son comunes (≈50 %). |
| D3 | El código Linux se **mueve tal cual** a `platform/linux/` sin cambiar lógica. | En Windows no se puede probar Linux; mover sin reescribir es lo único seguro. |
| D4 | El host Windows usa un **agente nativo en Go**, `nexo-agent.exe`, persistente y con protocolo JSON por líneas. | Go ya está en el proyecto (puente Pion, `windows-helper`); un proceso persistente quita el coste de lanzar un proceso por evento. |
| D5 | Entrada con `SendInput`: **texto con `KEYEVENTF_UNICODE`**, teclas y atajos por **código de exploración** (scan code) a partir de `KeyboardEvent.code`. | Elimina todo el rodeo del portapapeles de Chromium/Wayland; el scan code respeta la distribución latam del host. |
| D6 | Vídeo principal: **`ffmpeg` (`ddagrab`) → `h264_nvenc` → RTP → el mismo puente Pion**. Se elimina GStreamer en Windows. | `ddagrab` es Desktop Duplication; la RTX 3060 Ti tiene NVENC; el puente compila para Windows sin cambios (comprobado). |
| D7 | Respaldo WebRTC/CPU con `@roamhq/wrtc` (tiene binario `win32-x64`, comprobado) y respaldo JPEG con **un `ffmpeg` persistente** (no un proceso por cuadro). | Mantiene las tres rutas de degradación del diseño original. |
| D8 | Audio del sistema con **WASAPI loopback** dentro de `nexo-agent.exe`. | No necesita "Mezcla estéreo" ni cables virtuales. |
| D9 | Micrófono del celular con **VB-CABLE** (driver gratuito de VB-Audio, lo instala Letzus). NEXO escribe en `CABLE Input`; Discord/OBS eligen `CABLE Output`. **Nunca** se cae a los altavoces. | Windows no permite crear un micrófono sin driver firmado. |
| D10 | Después de encender a distancia: **inicio de sesión automático** con Sysinternals Autologon + tarea programada al iniciar sesión. | La pantalla de login, bloqueo y UAC es un escritorio seguro que una app de usuario no puede capturar ni controlar. |
| D11 | La segunda sesión aislada ("NEXO independiente") **no existe en Windows v1**. Queda la fase O3 de investigación, **sin parchear RDP** (viola la licencia y se rompe con cada actualización). | Windows 10/11 sólo permite una sesión gráfica interactiva. |
| D12 | NEXO en Windows corre **con privilegios elevados** (tarea programada con "máximos privilegios"), sin aviso de UAC al arrancar. | Sin eso, UIPI impide controlar ventanas de administrador (Administrador de tareas, instaladores) y el usuario cree que "no funciona el clic". |
| D13 | PowerShell 7 (`pwsh`) para todos los scripts de Windows; los `.cmd` sólo llaman a `pwsh`. | PowerShell 5.1 lee los `.ps1` sin BOM como ANSI y rompe los acentos. |
| D14 | Node.js 24 LTS en Windows. Go ≥ 1.24. FFmpeg "full" de gyan.dev vía winget (`Gyan.FFmpeg`). cloudflared vía winget (`Cloudflare.cloudflared`). | Versiones con soporte; winget evita descargar binarios sin verificar. |
| D15 | Mismos puertos que Linux: HTTP 8765, puente 9090, RTP 5004, todos configurables por variable. | El cliente y la documentación no cambian. |
| D16 | Se bloquea **`Win+L` remoto** y se mantiene el equipo despierto mientras haya un cliente. | Si Windows se bloquea, NEXO pierde la pantalla y no hay forma de volver a entrar desde fuera. |

---

## 2. Qué hay hoy y qué se conserva

### Inventario por archivo

| Archivo | En Windows | Nota |
|---|---|---|
| `index.html`, `microfono.html`, `microfono-cliente.js`, `pizarra.html` | **Se conserva** | Cambios mínimos: portal sin "NEXO independiente", aviso de pantalla segura. |
| `keyboard-translation.js` | **Se conserva** | El cliente lo usa tal cual; el servidor Windows usa su propio mapa (`platform/windows/keymap.js`). |
| `auth-manager.js`, `device-manager.js` | **Se conserva + correcciones** | Escrituras atómicas, scrypt asíncrono (F2). |
| `server.js` | **Se divide** | Lo común queda; lo de Hyprland pasa a `platform/linux/` (F1). |
| `launcher.js` | **Se adapta** | Apagado por IPC, matar árboles de procesos, huérfanos, logs (F8). |
| `webrtc-host.js` | **Se adapta** | Recibe las fábricas de captura por parámetro (F1) y la ruta Windows (F6). |
| `gpu-stream.js` | Sólo Linux | En Windows lo reemplaza `gpu-stream-windows.js` (F5). |
| `gpu-webrtc/main.go` | **Se conserva + correcciones** | Compila para Windows sin cambios (comprobado el 2026-10-16). |
| `microfono-host.js` | **Se conserva** | Elige el módulo de micrófono virtual según la plataforma. |
| `microfono-virtual.js` | Sólo Linux | En Windows: `microfono-virtual-windows.js` (F7). |
| `entorno.js`, `entrada-x11.js`, `greeter/`, `mapa-atajos.*` | Sólo Linux | Llaman a `process.getuid()` y a sockets de Hyprland: **no se pueden ni cargar** en Windows. |
| `headless/` | Sólo Linux | Ver D11. **Ojo:** su instalador debe aprender a copiar `platform/` y `lib/` (F1). |
| `nexo-control`, `nexo-doctor` (bash) | Sólo Linux | En Windows: `scripts/windows/nexo-control.ps1` y `nexo-doctor.ps1` (F8). |
| `rotate-token.js` | **Se conserva** | Ya es JavaScript puro. |
| `windows-helper/` | **Se conserva** | Es para **clientes** Windows; se sigue sirviendo desde el botón WIN. |
| `bin/wlrctl` | Sólo Linux | — |
| `linux-extra/nexo-avisar-enlace.sh` | Referencia | Se porta como `scripts/windows/nexo-avisar-enlace.ps1` (F8). |

### Lo que el sistema hace hoy y debe seguir haciendo en Windows

- Emparejamiento por enlace con token (se canjea por cookie y sale de la URL), por código
  `XXXX-XXXX` de un solo uso, lista y revocación de dispositivos, rotación del token.
- Contraseña de "Mi PC" (scrypt, cookie `HttpOnly` de 8 h, bloqueo tras 5 fallos por origen).
- Vídeo con tres rutas: GPU H.264 compartido → WebRTC CPU → JPEG por WebSocket.
- Perfiles 720p/900p/1080p × 30/45/60, calidad automática, reposo del codificador sin
  clientes, cambio de monitor sin renegociar.
- Entrada: tacto (MOVER/DIRECTO), mouse de PC con arrastre, rueda, teclado físico, panel de
  teclado móvil, AltGr como Super, botón SUPER, atajos, escritorios virtuales.
- Audio del sistema, micrófono del celular (también con la pantalla bloqueada), PiP,
  portapapeles manual, archivos de hasta 100 MiB, diagnóstico sin secretos, PWA.
- Acceso local y por Internet a la vez.

---

## 3. Arquitectura de destino en Windows

```text
 Celular / otra PC (navegador)
        │  HTTPS por túnel TryCloudflare  ó  HTTP en LAN
        ▼
 ┌───────────────────────────── node launcher.js ─────────────────────────────┐
 │                                                                             │
 │  server.js (común)                         gpu-stream-windows.js            │
 │   ├─ HTTP, auth, dispositivos, archivos     ├─ ffmpeg ddagrab → h264_nvenc   │
 │   ├─ colas de entrada, señalización         │      → RTP 127.0.0.1:5004      │
 │   ├─ webrtc-host.js (wrtc: CPU + audio)     └─ nexo-gpu-webrtc.exe (Pion)    │
 │   ├─ microfono-host.js                             :9090 ← /gpu-webrtc/*     │
 │   └─ platform/windows ──JSON por líneas──▶ nexo-agent.exe serve              │
 │          ├─ ffmpeg (JPEG persistente, vídeo CPU)    SendInput, DXGI,        │
 │          ├─ nexo-agent.exe audio-loopback ─PCM─▶     portapapeles,          │
 │          └─ nexo-agent.exe audio-play ◀─PCM── mic    escritorios virtuales  │
 │                                                                             │
 │  cloudflared.exe (túnel)                                                    │
 └─────────────────────────────────────────────────────────────────────────────┘
        ▲
  nexo-tray.exe (bandeja, sin consola) ← tarea programada "NEXO" al iniciar sesión
```

### Estructura nueva de carpetas

```text
lib/
  proc.js              runCommand, runCommandInput, startCommandInput (movidos de server.js)
  paths.js             defaultStateDir(), logsDir()
  safe.js              safeDecode, cookieValue, atomicWriteJson (F2)
platform/
  index.js             elige linux | windows
  linux/index.js       todo lo de Hyprland/wtype/grim/pw-record, movido tal cual (F1)
  linux/media.js       fábricas de captura CPU/audio para webrtc-host (movidas)
  windows/index.js     implementación del contrato (F4)
  windows/agent-client.js  RPC con nexo-agent.exe (F4)
  windows/keymap.js    KeyboardEvent.code → scan code, teclas nombradas, atajos (F4)
  windows/ffmpeg.js    localización de ffmpeg, argumentos, separador de JPEG (F4/F5)
native/
  agent/               módulo Go de nexo-agent.exe (F3)
  tray/                módulo Go de nexo-tray.exe (F9)
gpu-stream-windows.js  orquestador de vídeo GPU en Windows (F5)
microfono-virtual-windows.js  micrófono VB-CABLE (F7)
scripts/
  pair.js              genera código de emparejamiento (común Linux/Windows) (F8)
  windows/setup.ps1, build.ps1, check-env.ps1, nexo-control.ps1, nexo-control.cmd,
          nexo-doctor.ps1, install-autostart.ps1, uninstall-autostart.ps1,
          nexo-avisar-enlace.ps1, smoke.ps1
docs/windows/bitacora/ F0-argon.md, F0-opus.md, …
```

---

## 4. Contratos técnicos

Esto lo decidió el revisor. **El ejecutor implementa esto, no otra cosa.**

### 4.1 Contrato de plataforma (`platform/index.js`)

```js
'use strict';
// NEXO_PLATFORM sólo existe para pruebas; en uso normal manda process.platform.
const nombre = process.env.NEXO_PLATFORM || (process.platform === 'win32' ? 'windows' : 'linux');
module.exports = require(`./${nombre}`);
```

Cada implementación exporta **exactamente** estas claves (las asíncronas devuelven Promise):

| Clave | Firma | Linux (F1, código movido) | Windows (F4–F7) |
|---|---|---|---|
| `name` | `'linux' \| 'windows'` | `'linux'` | `'windows'` |
| `capabilities` | objeto | ver abajo | ver abajo |
| `init` | `({ log, stateDir }) → Promise` | no hace nada | arranca `nexo-agent.exe serve` |
| `close` | `() → Promise` | `restoreClipboardOnExit()` | cierra el agente |
| `listMonitors` | `() → [{ name, description, x, y, width, height, primary, index }]` | `hyprIpc('j/monitors')` filtrado como hoy | op `monitors` del agente |
| `pointer` | `(data, monitor)`; `data = { action, x, y, button }` con `x,y` ∈ [0,1] ya validados | cuerpo actual de `pointerAction` | mover + botón vía agente |
| `scroll` | `({ x, y, dx, dy }, monitor)` | mover + `wlrctl pointer scroll` / X11 | mover + rueda vía agente |
| `text` | `(texto)` | `runChromiumAwareText(texto)` | op `text` |
| `namedKey` | `(nombre)` (`enter`, `copy`, `alt_tab`…) | `runWtype(keyCommand(nombre))` | `keymap.named()` → op `keys` |
| `keyEvent` | `(value)` evento sin Super (puede traer Ctrl/Alt/Shift) | `browserKeyCommand` → `wtype` / texto | `keymap.combo()` → op `keys` |
| `shortcut` | `(value)` con Super, o Alt+Tab/Alt+F4 | `runHyprShortcut(value)` | `keymap.shortcut()` → op `keys` (con bloqueados) |
| `workspace` | `(1..10 \| 'next' \| 'previous')` | `workspaceAction` | op `desktop.switch` |
| `clipboardGet` | `() → string` | `wl-paste` | op `clipboard.get` |
| `clipboardSet` | `(texto)` | `wl-copy` | op `clipboard.set` |
| `screenshotJpeg` | `({ monitor, quality }) → Buffer` | `grim -t jpeg -q 65 -` | `ffmpeg -frames:v 1` |
| `startJpegStream` | `({ monitor, fps, quality, onFrame }) → { stop() }` | el bucle actual de `grim` | un `ffmpeg` persistente |
| `spawnSystemAudio` | `({ latencyMs }) → ChildProcess` (stdout = s16le, 48000 Hz, 2 canales) | `pw-record` actual | `nexo-agent.exe audio-loopback` |
| `spawnRawVideo` | `({ monitor, width, height, fps }) → { child, stream }` (stream = cuadros yuv420p) | `wf-recorder` + FIFO actual | `ffmpeg … -f rawvideo pipe:1` |
| `defaultAudioTarget` | `() → string` | `pactl get-default-sink` | nombre del dispositivo de salida por defecto |
| `keepAwake` | `(boolean)` | no hace nada | op `keepawake` |
| `on` | `(evento, fn)` eventos: `'desktop-state'` (`'normal' \| 'secure'`), `'displays-changed'` | nunca emite | reemite eventos del agente |

`capabilities`:

```js
// Linux
{ gpuVideo: true, cpuVideo: true, systemAudio: true, virtualMic: true,
  independentSession: true, loginScreen: true, textBatchMs: 30 }
// Windows
{ gpuVideo: true, cpuVideo: true, systemAudio: true, virtualMic: true,
  independentSession: false, loginScreen: false, textBatchMs: 0 }
```

El servidor conserva **todo lo demás**: validación de coordenadas, colas
(`enqueuePointer`, `pumpPointer`, `enqueueScroll`), agrupado de texto (`encolarTexto`,
`vaciarTexto`), el armado de Super por AltGr de clientes viejos (`conSuperDeAltGr`),
emparejamiento, auth, archivos, diagnóstico, señalización y rutas HTTP.

Regla del agrupado: `TECLEO_AGRUPAR_MS = process.env.NEXO_AGRUPAR_MS !== undefined ?
Math.max(0, Number(process.env.NEXO_AGRUPAR_MS) || 0) : platform.capabilities.textBatchMs`.
**No** usar `Number(x) || 30`: con 0 daría 30.

### 4.2 Protocolo de `nexo-agent.exe serve`

- Entrada: una petición JSON por línea en **stdin**. Salida: una respuesta o evento JSON por
  línea en **stdout**. Registro humano en **stderr**. UTF-8 sin BOM.
- **Al cerrarse stdin el agente termina** (así nunca queda huérfano si muere Node).
- Al arrancar emite: `{"event":"ready","version":"1","dpiAware":true,"elevated":true,"session":1,"user":"Letzus"}`.
- Petición: `{"id":7,"op":"pointer",...}` → respuesta `{"id":7,"ok":true,...}` o
  `{"id":7,"ok":false,"error":"mensaje en español"}`. Las peticiones se atienden **en orden**.
- Eventos sin `id`: `{"event":"desktop","state":"normal"|"secure"}` cuando cambia (sondeo
  cada 500 ms de `OpenInputDesktop` + nombre del escritorio: `Default` = normal, cualquier
  otro = secure); `{"event":"displays-changed"}` cuando cambia la lista de monitores
  (sondeo cada 2 s).

| op | Parámetros | Respuesta | Implementación |
|---|---|---|---|
| `ping` | — | `{}` | — |
| `monitors` | — | `{ monitors:[{ index, name, description, x, y, width, height, primary, rotation }], virtual:{x,y,width,height} }` | DXGI: `CreateDXGIFactory1` → `EnumAdapters1(0)` → `EnumOutputs(i)` → `GetDesc` (`DesktopCoordinates`, `DeviceName`, `Rotation`). `index` = `i` = `output_idx` de `ddagrab`. Píxeles físicos. |
| `pointer` | `{ action:"move"\|"down"\|"up"\|"click", x, y, button:"left"\|"right"\|"middle" }` (x,y absolutos del escritorio virtual) | `{}` | Siempre mueve primero: `SendInput` con `MOUSEEVENTF_MOVE\|ABSOLUTE\|VIRTUALDESK`, `dx = round((x−vx)·65535/(vw−1))`; después `GetCursorPos` y, si difiere más de 1 px, `SetCursorPos(x,y)`. Luego el botón. `click` = down+up en el mismo `SendInput`. |
| `scroll` | `{ x, y, dx, dy }` | `{}` | Mueve y envía `MOUSEEVENTF_WHEEL` con `mouseData = −round(dy·F)` y `MOUSEEVENTF_HWHEEL` con `round(dx·F)`; `F = NEXO_WHEEL_FACTOR` (por defecto 1). |
| `text` | `{ text }` | `{}` | `KEYEVENTF_UNICODE` por unidad UTF-16 (los pares sustitutos van seguidos); `\n` → Enter real, `\t` → Tab real. Un solo `SendInput` por bloque de ≤ 64 eventos. |
| `keys` | `{ events:[{ scan, ext, up }] }` | `{}` | `KEYEVENTF_SCANCODE` (+`EXTENDEDKEY` si `ext`). Si `SendInput` falla a mitad, suelta Ctrl/Alt/Shift/Win antes de responder error. |
| `clipboard.get` | — | `{ text }` | `OpenClipboard` con hasta 10 reintentos de 10 ms, `CF_UNICODETEXT`. |
| `clipboard.set` | `{ text }` | `{}` | Ídem, `EmptyClipboard` + `SetClipboardData(CF_UNICODETEXT)`. |
| `desktop.info` | — | `{ supported, index, count }` | Registro (ver 4.4). |
| `desktop.switch` | `{ target: 1..10 \| "next" \| "previous" }` | `{ index }` | Calcula la diferencia y envía `Win+Ctrl+←/→` tantas veces como haga falta, 80 ms entre cada una. |
| `foreground` | — | `{ title, process, elevated }` | `GetForegroundWindow`, `GetWindowThreadProcessId`, `OpenProcess` + `GetTokenInformation(TokenElevation)`; si no se puede abrir, `elevated:true`. |
| `keepawake` | `{ on }` | `{}` | `SetThreadExecutionState(ES_CONTINUOUS\|ES_SYSTEM_REQUIRED\|ES_DISPLAY_REQUIRED)` en un hilo fijo (`runtime.LockOSThread`). |
| `desktop.state` | — | `{ state }` | Igual que el evento. |

Subcomandos aparte (procesos propios, como hoy `pw-record`/`pw-play`):

| Subcomando | Qué hace |
|---|---|
| `nexo-agent.exe audio-loopback --rate 48000 --channels 2` | WASAPI loopback del dispositivo de salida por defecto. Escribe **s16le 48 kHz estéreo** en stdout. **Si no suena nada, WASAPI no entrega paquetes: el agente debe escribir silencio a ritmo real** (bloques de 10 ms) para que WebRTC no se quede sin reloj. Sigue al dispositivo por defecto si cambia. Termina si stdout se rompe o stdin se cierra. |
| `nexo-agent.exe audio-play --match "CABLE Input" --rate 48000 --channels 1` | Lee s16le de stdin y lo reproduce en el dispositivo de salida cuyo nombre contiene `--match`. **Si no existe, sale con código 3** y mensaje en stderr; **jamás** usa el dispositivo por defecto. |
| `nexo-agent.exe audio-devices` | JSON con dispositivos de salida y entrada (`id`, `name`, `default`). |
| `nexo-agent.exe version` | Imprime la versión. |

Al arrancar, el agente llama a `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`
**antes** de cualquier otra llamada de ventanas o DXGI.

### 4.3 Mapa de teclas en Windows (`platform/windows/keymap.js`)

JavaScript puro, probado con `node --test` en cualquier sistema.

- `code → { scan, ext }` (conjunto 1). Tabla obligatoria:
  `KeyA 1E, KeyB 30, KeyC 2E, KeyD 20, KeyE 12, KeyF 21, KeyG 22, KeyH 23, KeyI 17, KeyJ 24,
  KeyK 25, KeyL 26, KeyM 32, KeyN 31, KeyO 18, KeyP 19, KeyQ 10, KeyR 13, KeyS 1F, KeyT 14,
  KeyU 16, KeyV 2F, KeyW 11, KeyX 2D, KeyY 15, KeyZ 2C, Digit1 02 … Digit9 0A, Digit0 0B,
  Minus 0C, Equal 0D, BracketLeft 1A, BracketRight 1B, Backslash 2B, Semicolon 27, Quote 28,
  Backquote 29, Comma 33, Period 34, Slash 35, IntlBackslash 56, Enter 1C, Escape 01,
  Backspace 0E, Tab 0F, Space 39, CapsLock 3A, F1 3B … F10 44, F11 57, F12 58,
  ShiftLeft 2A, ShiftRight 36, ControlLeft 1D, AltLeft 38`
  y con `ext:true`: `ControlRight 1D, AltRight 38, MetaLeft 5B, MetaRight 5C, ContextMenu 5D,
  Insert 52, Delete 53, Home 47, End 4F, PageUp 49, PageDown 51, ArrowUp 48, ArrowDown 50,
  ArrowLeft 4B, ArrowRight 4D, PrintScreen 37, NumpadEnter 1C, NumpadDivide 35`.
- Modificadores: Ctrl `1D`, Shift `2A`, Alt `38`, Win `5B` ext.
- `key → code` para eventos sin `code` (paneles móviles, teclas nombradas):
  `Enter, Backspace, Delete, Tab, Escape, ArrowLeft/Right/Up/Down, Home, End, PageUp,
  PageDown, Insert, F1–F12, ' ' → Space`, y letras/dígitos sueltos → `KeyX`/`DigitN`.
- `named(nombre)`: los mismos nombres que `KEYS` y `SHORTCUTS` de `keyboard-translation.js`
  (`enter`, `backspace`, …, `copy`=Ctrl+C, `paste`=Ctrl+V, `cut`, `selectall`, `undo`,
  `redo`=**Ctrl+Y en Windows**, `save`, `find`, `alt_tab`).
- `combo(value)`: modificadores pulsados en orden Ctrl, Alt, Shift, Win → tecla → soltar en
  orden inverso. Si el evento no trae `code` ni hay `key` mapeable, devuelve `null` y el
  servidor responde `Entrada inválida (…)` como hoy.
- `shortcut(value)`:
  - `meta` + `' '` sin otros modificadores → **sólo un toque de Win** (abre Inicio). En
    Windows `Win+Espacio` cambia el idioma del teclado: no es lo que el usuario espera.
  - Bloqueados (error `Atajo no disponible en remoto: …`): `Win+L` siempre. Lista ampliable con
    `NEXO_BLOCKED_SHORTCUTS` (`"meta+l,ctrl+alt+delete"`).
  - Lo demás, `combo()` con Win.

### 4.4 Escritorios virtuales

- Windows 11: `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops`,
  valores `VirtualDesktopIDs` (REG_BINARY, n×16 bytes) y `CurrentVirtualDesktop` (16 bytes).
- Windows 10: `CurrentVirtualDesktop` vive en
  `…\Explorer\SessionInfo\<SessionId>\VirtualDesktops`; `VirtualDesktopIDs` en la ruta de
  Windows 11.
- `index` = posición (1-based) del GUID actual dentro de la lista. Si falta
  `CurrentVirtualDesktop` (no se cambió nunca de escritorio) se asume 1.
- `supported:false` si no hay lista: entonces sólo funcionan `next`/`previous`.
- Ir a un escritorio que no existe no crea nada: responde error `Escritorio N no existe (hay M)`.

### 4.5 Cadenas de FFmpeg

Encontrar `ffmpeg`: `NEXO_FFMPEG` → `where ffmpeg` → error claro.

**Vídeo GPU** (F5). `gpu-stream-windows.js` prueba en este orden y guarda la primera que
produce RTP durante 3 s en `<stateDir>\.nexo-gpu-pipeline.json`
(`{ ffmpegVersion, chain, probedAt }`); repite el sondeo si cambia la versión de ffmpeg:

| Cadena | Filtro de entrada (`-f lavfi -i "…"`) | Cuándo |
|---|---|---|
| `d3d11-native` | `ddagrab=output_idx=N:framerate=FPS:draw_mouse=1` | Sólo si W×H = resolución del monitor (perfil 1080p en monitores 1080p: el predeterminado). |
| `d3d11-scale` | `ddagrab=…,scale_d3d11=W:H:format=nv12` | Si el filtro `scale_d3d11` existe (`ffmpeg -filters`). |
| `cuda-scale` | `ddagrab=…,hwmap=derive_device=cuda,scale_cuda=W:H:format=nv12` | Si existen `scale_cuda` y el mapeo. |
| `cpu-scale` | `ddagrab=…,hwdownload,format=bgra,scale=W:H:flags=bilinear,format=nv12` | Siempre posible; usa CPU como hoy `wf-recorder`. |
| `gdigrab` | `-f gdigrab -framerate FPS -offset_x X -offset_y Y -video_size WxH -i desktop` + `-vf scale=W:H,format=nv12` | Último recurso. |

Codificador común (los mismos valores que Linux, `gpu-stream.js:175-184`):

```text
-c:v h264_nvenc -preset p1 -tune ull -rc cbr -b:v B -maxrate B -bufsize max(240000,B/30)
-g max(15,FPS/2) -bf 0 -forced-idr 1 -profile:v high -delay 0 -zerolatency 1 -strict_gop 1 -aud 1
-bsf:v dump_extra=freq=keyframe
-f rtp -payload_type 96 "rtp://127.0.0.1:5004?pkt_size=1200"
```

Siempre con `-hide_banner -loglevel error -nostdin`. Bitrate por perfil: 1080p 10000 kbps,
900p 7000, 720p 4500 (igual que Linux).

**Vídeo CPU** (F6): `ddagrab=output_idx=N:framerate=FPS:draw_mouse=1,hwdownload,format=bgra`
+ `-vf scale=W:H:flags=fast_bilinear,format=yuv420p -f rawvideo pipe:1`.

**JPEG persistente** (F4): `ddagrab=output_idx=N:framerate=10:draw_mouse=1,hwdownload,format=bgra`
+ `-vf scale='min(1280,iw)':-2 -c:v mjpeg -q:v 8 -f image2pipe pipe:1`. El separador corta
por `FF D8` … `FF D9`. **Captura instantánea**: igual con `-frames:v 1 -q:v 5`.

### 4.6 Estado y registros en Windows

- `lib/paths.js`: `defaultStateDir(root)` = `NEXO_STATE_DIR` si existe; en `win32`,
  `%LOCALAPPDATA%\NEXO\state`; en Linux, `root` (**como hoy**). `logsDir()` =
  `%LOCALAPPDATA%\NEXO\logs` en Windows.
- ACL (la hace `install-autostart.ps1` y la revisa el doctor):
  `icacls "%LOCALAPPDATA%\NEXO" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administradores:(OI)(CI)F"`
  (usar los SID `*S-1-5-18` y `*S-1-5-32-544` para no depender del idioma).
- Log de ejecución: `nexo-runtime.log`, rotación a 5 MiB × 3 archivos, **con el token
  enmascarado** (`token=***`). La consola interactiva sí puede mostrar los enlaces completos.

---

## 5. Defectos encontrados y mejoras

### 5.1 Defectos del código actual (se corrigen en la migración)

| ID | Defecto | Evidencia | Fase |
|---|---|---|---|
| **C1** | **Una sola petición sin autenticar tumba el servidor.** `cookieValue()` hace `decodeURIComponent` sin protección y se llama antes de comprobar nada; `Cookie: nexo_device=%` lanza `URIError` dentro del manejador y el proceso muere. Lo mismo con `/files/%`, `/devices/%` y una cabecera `Host` inválida (`new URL`). Llega desde Internet por el túnel. | **Comprobado el 2026-10-16** en un servidor de prueba (puerto 18999): `/health` 200 → petición con esa cookie → servidor caído (`curl` 000). | F2 |
| C2 | El token se escribe en el registro: `console.log('TOKEN=…')` (`server.js:1556`) y los enlaces completos del lanzador. `nexo-runtime.log` pesa 1,2 MB, no rota y en Linux es legible por todos (`-rw-r--r--`), incluido el usuario `nexo`. | `grep TOKEN= nexo-runtime.log` | F2 (común), F8 (Windows), L (Linux: `chmod 600`) |
| C3 | Escrituras de estado no atómicas (`writeState`, `saveState`, `saveAuth`, rotación). Un corte de luz a mitad deja JSON truncado, `readState` devuelve `null`, `DeviceStore` arranca vacío y el siguiente guardado **borra todos los dispositivos emparejados**. | `device-manager.js:29-33` | F2 |
| C4 | `scryptSync` en el hilo principal en login y emparejamiento: cada intento congela el vídeo de respaldo, la entrada y la señalización. | `auth-manager.js:15`, `device-manager.js:53` | F2 |
| C5 | Subida de archivos sin control de presión (`output.write` ignora el retorno: 100 MiB pueden acabar en memoria) y sin manejar el `error` del `WriteStream`: disco lleno → excepción no capturada → caída. | `server.js:1254-1276` | F2 |
| C6 | WebSocket hecho a mano: supone un cuadro por `chunk`, no valida longitud ni máscara; latido de 30 s (hasta 60 s para detectar un socket muerto). | `server.js:1510-1535` | F2 (librería `ws`, latido 15 s) |
| C7 | Puente Go: (a) el par entra en `peers` **después** de reunir ICE (hasta 4 s): si falla antes, `closePeer` no lo encuentra y luego se registra un par muerto que impide el reposo de NVENC; (b) el RTCP se lee y se tira: no se sabe cuántos PLI/NACK llegan; (c) en Windows no hay `SIGTERM` y no sale al morir el padre. | `gpu-webrtc/main.go:139-176` | F5 |
| C8 | La cookie de dispositivo caduca a los 30 días **aunque se use a diario**: un día deja de entrar sin aviso. | `device-manager.js:119-130` | F2 (renovación deslizante) |
| C9 | El proxy `/gpu-webrtc/*` reenvía cualquier método y ruta con **todas** las cabeceras, cookies incluidas. | `server.js:1358-1371` | F2 |
| C10 | Respaldo JPEG: un proceso `grim` por cuadro + 25 ms fijos. | `server.js:639-657` | F4 (Windows: ffmpeg persistente). Linux sin cambios. |
| C11 | Valores fijos de Linux: `/usr/bin/node`, FIFOs en `/tmp`, `alsa_output.pci-0000_09_00.4…`, IP `104.16.231.132` en el vigilante del túnel, `process.getuid()` al cargar `entorno.js`. | varios | F1/F8 |
| C12 | Windows no tiene `SIGTERM`: `process.on('SIGTERM')` nunca se dispara, `child.kill()` mata sin limpiar y los nietos (ffmpeg, puente, cloudflared) **quedan huérfanos ocupando los puertos**: el reinicio falla con `EADDRINUSE`. | diseño de `launcher.js` | F8 |
| C13 | Los modos `0600/0700` no protegen nada en Windows. | — | F8/F9 (ACL) |
| C14 | `test/device-manager.test.js:53` comprueba el modo `0600`: falla en Windows. | — | F1 |
| C15 | `headless/install-headless` copia sólo `*.js` de la raíz y cuatro carpetas: si aparecen `platform/` y `lib/` y no se copian, **la sesión independiente de Linux entra en bucle de reinicios**. | `install-headless:44-70` | F1 |
| C16 | Si el servidor responde `chooser:false`, el cliente salta directo a `launchClient()` **sin pedir la contraseña**: en Windows (sin segunda sesión) quedaría roto con 401. Hay que seguir mostrando el portal, sin la tarjeta de NEXO. | `index.html`, función del portal | F4 |

### 5.2 Mejoras que trae el port a Windows

| ID | Mejora | Fase |
|---|---|---|
| W1 | Texto por `KEYEVENTF_UNICODE`: desaparecen el rodeo del portapapeles, las carreras de mapas de `wtype` y el agrupado de 30 ms. | F3/F4 |
| W2 | Agente persistente: sin procesos por evento (Kimi L2). | F3 |
| W3 | Aviso en el cliente cuando Windows muestra una pantalla segura (bloqueo/UAC) y pausa de la captura en vez de un bucle de reinicios. | F4/F5 |
| W4 | Aviso cuando la ventana al frente es de administrador y NEXO no está elevado. | F4 |
| W5 | Equipo despierto mientras haya clientes; `Win+L` bloqueado en remoto. | F4 |
| W6 | Bandeja con enlaces, código de emparejamiento y reinicio. | F9 |
| W7 | Sondeo automático de la mejor cadena de vídeo, recordado entre arranques. | F5 |
| W8 | Aviso del enlace nuevo al celular (ntfy o Telegram) al arrancar: imprescindible con TryCloudflare + CGNAT. | F8 |
| W9 | Renovación deslizante de la cookie de dispositivo (C8). | F2 |

---

## 6. Trampas conocidas de Windows

El revisor las comprueba una por una en la fase que corresponda.

1. **`INPUT` de `SendInput` mide 40 bytes en amd64.** Con otra estructura, `SendInput`
   devuelve 0 y no pasa nada, sin error visible. Prueba unitaria `unsafe.Sizeof == 40` y
   comprobar siempre el valor de retorno.
2. **DPI.** Sin `PER_MONITOR_AWARE_V2` antes de todo, las coordenadas salen escaladas al
   125/150 % y los clics caen desplazados.
3. **COM en Go** (WASAPI): `runtime.LockOSThread()` + `CoInitializeEx` en el mismo hilo,
   siempre.
4. **WASAPI loopback no entrega nada con el sistema en silencio** → generar silencio.
5. **El formato de mezcla suele ser float32 48 kHz**, pero puede ser 44,1 kHz: convertir y
   remuestrear en el agente; la salida es siempre s16le 48 kHz.
6. **`ddagrab` pierde el acceso** (`DXGI_ERROR_ACCESS_LOST`) con UAC, bloqueo, cambio de
   resolución o juegos a pantalla completa exclusiva: ffmpeg sale. Reintentar con espera
   creciente (1 s → 5 s) y no inundar el registro.
7. **Nada de FIFOs**: Windows no tiene `mkfifo`. Todo por `stdout`/`stdin`.
8. **`child.kill()` en Windows es `TerminateProcess`**: no hay limpieza ni se matan los
   nietos. Apagado por IPC + `taskkill /PID n /T /F` tras 1,5 s.
9. **Rangos de puertos reservados** por Hyper-V/WSL (`netsh int ipv4 show excludedportrange
   protocol=tcp`): 5004, 8765 o 9090 pueden caer dentro y `listen` da `EACCES`. El doctor lo
   comprueba.
10. **Firewall**: la primera escucha abre un diálogo. Reglas explícitas sólo en perfil
    **Privado** para `node.exe` y `nexo-gpu-webrtc.exe` (TCP 8765 y UDP de WebRTC).
11. **SmartScreen/Defender** sobre `.exe` sin firma compilados localmente: normal; el doctor
    lo explica. No desactivar Defender.
12. **Rutas con espacios** en `schtasks`, `icacls` y argumentos de ffmpeg: comillas siempre.
13. **`Win+Espacio`** cambia el idioma de entrada: AltGr solo debe tocar sólo Win.
14. **`Ctrl+Alt+Supr` no se puede sintetizar** desde una app de usuario: no intentarlo.
15. **UIPI**: un proceso no elevado no puede enviar entrada a uno elevado (D12).
16. **Inicio rápido de Windows** rompe Wake-on-LAN desde apagado: desactivarlo (F9).
17. **El arranque dual**: tras Wake-on-LAN, GRUB arranca su entrada predeterminada. Para
    llegar a Windows a distancia hace falta `GRUB_DEFAULT=saved` + `grub-reboot` desde Linux o
    poner Windows como predeterminado. **No se toca desde la sesión de Windows**; queda anotado
    para la fase L.
18. **`CRLF`**: `.gitattributes` fuerza LF salvo `.cmd/.bat/.ps1`. Nunca convertir los
    scripts bash de Linux.
19. **Windows Hello "sólo Hello"**: con cuenta Microsoft sin contraseña, Autologon no
    funciona hasta desactivar "Para mayor seguridad, permitir sólo el inicio de sesión de
    Windows Hello".

---

## 7. Encabezados comunes de los prompts

### 7.1 Encabezado del ejecutor (pegar antes de cada prompt A-FN)

```text
Eres el EJECUTOR de una fase de la migración de NEXO a Windows. El plan y la arquitectura
ya están decididos por el revisor; tu trabajo es implementarlos con exactitud.

Antes de escribir código:
1. Lee AGENTS.md completo.
2. Lee en PLAN-MIGRACION-WINDOWS.md las secciones 1, 3, 4, 5 y 6, y la sección de TU fase.
3. Lee las bitácoras de las fases anteriores en docs/windows/bitacora/ (sobre todo las
   notas del revisor "-opus.md": dicen qué cambió respecto al plan).
4. Lee de verdad los archivos que vas a tocar. No supongas cómo funcionan por su nombre.

Reglas:
- Rama windows-port. Al empezar: `git pull`, luego `git tag fN-start` (N = tu fase) y push
  de la etiqueta.
- Toca SOLO los archivos que lista tu fase. Si necesitas tocar otro, anótalo como duda.
- No cambies el comportamiento en Linux. Si tu fase mueve código Linux, muévelo carácter
  por carácter, con sus comentarios.
- No decidas arquitectura. Si algo no está en el plan o el plan no encaja con la realidad
  (una versión, una API), NO improvises: escríbelo en la sección "Dudas" de tu bitácora,
  elige la opción más conservadora y sigue con lo demás.
- No metas secretos ni estado privado en git (revisa `git status` antes de cada commit).
- Comentarios en español explicando el porqué, como el código existente.
- Ejecuta TODAS las verificaciones de tu fase y copia la salida REAL. "Corrió sin error"
  no es "funciona": compara con la salida esperada.

Al terminar:
- Escribe docs/windows/bitacora/FN-argon.md con: archivos creados/modificados (lista),
  funciones tocadas, decisiones que tuviste que tomar, comandos de verificación con su
  salida real, lo que NO pudiste verificar y por qué, y "Dudas".
- Un commit (o varios) con mensaje "FN: <resumen>", y `git push`.
- No crees la etiqueta fN-ok: esa la pone el revisor.
```

### 7.2 Encabezado del revisor (pegar antes de cada prompt R-FN)

```text
Eres el REVISOR Y CORRECTOR (Opus 5.5) de la fase N de la migración de NEXO a Windows.
El ejecutor (Argon 4) ya hizo el trabajo en bruto. Tu trabajo: que la fase quede perfecta.

1. Lee AGENTS.md, CLAUDE.md, las secciones 1–6 del plan y la de esta fase, y
   docs/windows/bitacora/FN-argon.md.
2. Revisa el diff completo: `git diff --stat fN-start..HEAD` y
   `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change fN-start..HEAD`.
   Todo archivo fuera de la lista de la fase es sospechoso hasta que se justifique.
3. Contrasta contra los contratos de la sección 4: nombres, firmas, formatos, códigos de
   salida. Una desviación no anotada en la bitácora es un defecto.
4. Vuelve a ejecutar TÚ las verificaciones de la fase. No te fíes de la salida pegada.
5. Busca fallos silenciosos: errores tragados con catch vacío, valores por defecto con
   `|| x` que convierten 0 en x, procesos que quedan vivos, rutas Linux en código Windows,
   cambios de lógica en código que debía moverse tal cual, y las trampas de la sección 6
   que toquen esta fase.
6. Corrige directamente lo que encuentres (commits "FN-rev: …"). Si la fase está mal
   planteada de raíz, recházala: escribe docs/windows/bitacora/FN-reencargo.md con un
   prompt corregido y autocontenido para Argon (causa raíz ya diagnosticada, arreglo ya
   decidido, archivos exactos, verificación).
7. Escribe docs/windows/bitacora/FN-opus.md: veredicto (APROBADO / APROBADO CON NOTAS /
   RECHAZADO), defectos encontrados y cómo se corrigieron, desviaciones del plan que se
   aceptan, y pendientes para fases siguientes.
8. Si aprobaste: `git tag fN-ok`, push de rama y etiqueta. Termina diciéndole a Letzus en
   dos líneas qué quedó funcionando y qué debe probar él (👤) si la fase lo pide.
```

---

## 8. Fases con sus prompts

---

### F0 · Entorno de Windows y línea base

**Objetivo:** todas las herramientas instaladas y comprobadas, y una medición de lo que
el hardware puede hacer, antes de tocar código.

**👤 TÚ, antes de empezar:**
1. Instala **VB-CABLE** desde `https://vb-audio.com/Cable/` (el zip "VBCABLE_Driver_Pack"),
   ejecuta `VBCABLE_Setup_x64.exe` como administrador, reinicia.
2. Comprueba en *Configuración → Sistema → Sonido* que aparecen "CABLE Input" (salida) y
   "CABLE Output" (entrada). Tu salida por defecto debe seguir siendo tus parlantes/audífonos.

#### A-F0 · prompt para Argon 4

```text
FASE F0 — Entorno de Windows y línea base.

Archivos que puedes crear: scripts/windows/setup.ps1, scripts/windows/check-env.ps1,
scripts/windows/build.ps1, docs/windows/bitacora/F0-argon.md. No toques nada más.

1. scripts/windows/setup.ps1 (PowerShell 7, idempotente, sin pedir nada al usuario salvo
   la elevación de winget): instala si faltan, con `winget install --id <id> -e
   --accept-source-agreements --accept-package-agreements`:
   Microsoft.PowerShell, Git.Git, GitHub.cli, OpenJS.NodeJS.LTS (debe quedar Node 24.x),
   GoLang.Go, Gyan.FFmpeg, Cloudflare.cloudflared. Al final imprime la versión de cada uno.
   Si `node --version` no empieza por v24, avisa y no sigas.
2. scripts/windows/check-env.ps1: comprueba y muestra en una tabla OK/FALLA:
   - node, npm, go, git, gh, ffmpeg, cloudflared en PATH y su versión.
   - `ffmpeg -hide_banner -filters` contiene ddagrab; anota si contiene scale_d3d11,
     scale_cuda y hwmap.
   - `ffmpeg -hide_banner -encoders` contiene h264_nvenc.
   - `nvidia-smi` responde (nombre de la GPU y versión del driver).
   - Dispositivos de audio: lista los de salida con
     `Get-CimInstance Win32_SoundDevice` y avisa si no hay ninguno con "VB-Audio" en el
     nombre (VB-CABLE no instalado).
   - Puertos 8765, 9090 y 5004: que estén libres (`Get-NetTCPConnection` /
     `Get-NetUDPEndpoint`) y que NO caigan en los rangos excluidos de
     `netsh int ipv4 show excludedportrange protocol=tcp` y `protocol=udp`.
   - La ruta del repositorio no tiene espacios ni caracteres no ASCII.
   Código de salida 0 si todo lo obligatorio está bien, 1 si no.
3. scripts/windows/build.ps1: compila con Go para windows/amd64, con
   `-trimpath -ldflags "-s -w"`, hacia bin\win\:
   - gpu-webrtc → bin\win\nexo-gpu-webrtc.exe
   - windows-helper → bin\win\nexo-super-bridge.exe (y cópialo también a
     windows-helper\dist\nexo-super-bridge.exe, que es donde lo sirve server.js)
   - native\agent → bin\win\nexo-agent.exe (SOLO si la carpeta existe: aparece en F3)
   - native\tray → bin\win\nexo-tray.exe con -ldflags "-H windowsgui -s -w" (SOLO si existe:
     aparece en F9)
   Falla con código 1 si alguna compilación falla.
4. Ejecuta en este orden y copia la salida real a la bitácora:
   a) `pwsh -File scripts/windows/setup.ps1`
   b) `pwsh -File scripts/windows/check-env.ps1`
   c) `npm ci`
   d) `node -e "const w=require('@roamhq/wrtc');console.log(typeof w.RTCPeerConnection, Object.keys(w.nonstandard))"`
      Esperado: `function [ 'i420ToRgba', ... 'RTCVideoSource', 'RTCAudioSource', ... ]`
      (debe incluir RTCVideoSource, RTCAudioSource y RTCAudioSink).
   e) `npm test` — anota cuántas pasan y cuáles fallan (se espera que falle la comprobación
      de modo 0600 de test/device-manager.test.js; NO la arregles aquí, es de F1).
   f) `pwsh -File scripts/windows/build.ps1`
   g) Línea base de captura y codificación, para cada monitor N (0 y 1), 5 segundos:
      `ffmpeg -hide_banner -f lavfi -i "ddagrab=output_idx=N:framerate=60:draw_mouse=1" -t 5 -c:v h264_nvenc -preset p1 -tune ull -f null -`
      Anota los fps que reporta ffmpeg al final y si dio error.
      Repite con la cadena cpu-scale de la sección 4.5 a 1280x720 y anota fps.
      Si existe scale_d3d11, repite con d3d11-scale a 1280x720.
   h) Captura un cuadro de cada monitor a PNG en el escritorio
      (`-frames:v 1 ... hwdownload,format=bgra` → `C:\Users\<usuario>\Desktop\monitorN.png`)
      y anota cuál es cuál según su contenido (que Letzus lo mire si no puedes ver imágenes).
5. Bitácora docs/windows/bitacora/F0-argon.md con todo lo anterior y una tabla final:
   herramienta | versión | OK.
6. Commit "F0: entorno de Windows y línea base" y push.
```

#### R-F0 · prompt para Opus 5.5

```text
FASE F0 — revisión.

Verifica:
1. Los tres scripts corren en una consola nueva de pwsh sin tocar nada a mano. setup.ps1
   ejecutado dos veces seguidas no reinstala nada (idempotente).
2. check-env.ps1 detecta FALLAS de verdad: prueba renombrando temporalmente ffmpeg en PATH
   (o con $env:PATH recortado en esa consola) y comprueba que sale 1 con FALLA visible.
3. La comprobación de puertos excluidos funciona (lee el formato real de netsh en el idioma
   del sistema; si Windows está en español la salida trae "Puerto de inicio").
4. build.ps1 produce los .exe y sale con 1 si una compilación falla (prueba rompiendo a
   propósito un go.mod en una copia, no en el repo).
5. Las cifras de la línea base son creíbles (60 fps con ddagrab+nvenc en esta RTX 3060 Ti;
   si da menos de 55, investiga antes de aprobar: tasa de refresco del monitor, HAGS,
   modo de energía de la GPU).
6. Deja en F0-opus.md la tabla definitiva: qué cadenas de la sección 4.5 están disponibles
   con la versión instalada de ffmpeg, y el orden real de monitores (output_idx 0/1 ↔
   izquierdo/derecho, HDMI/DP). Si alguna decisión de la sección 4 no encaja con lo medido,
   corrige la sección en PLAN-MIGRACION-WINDOWS.md y anótalo.
```

**Salida de la fase:** `check-env.ps1` en verde, `bin\win\` con dos `.exe`, wrtc cargando y
la tabla de cadenas FFmpeg disponibles.

---

### F1 · Capa de plataforma (refactor sin cambiar Linux)

**Objetivo:** `server.js` arranca en Windows (sin funciones de entrada todavía) y en Linux
hace exactamente lo mismo que hoy.

#### A-F1 · prompt para Argon 4

```text
FASE F1 — Capa de plataforma. Es un REFACTOR: en Linux no puede cambiar ni un
comportamiento. Mueve código, no lo reescribas.

Archivos permitidos: server.js, webrtc-host.js, microfono-host.js, launcher.js (sólo el
punto 7), auth-manager.js (sólo el punto 3), headless/install-headless (sólo el punto 8),
test/device-manager.test.js (sólo el punto 9), y los nuevos: lib/proc.js, lib/paths.js,
platform/index.js, platform/linux/index.js, platform/linux/media.js,
platform/windows/index.js, microfono-virtual-windows.js, test/platform-contract.test.js,
docs/windows/bitacora/F1-argon.md.

1. lib/proc.js: mueve tal cual de server.js runCommand, runCommandInput y
   startCommandInput. Reciben el entorno como parámetro opcional
   `options.env` y, si no viene, usan process.env. En Linux, server.js y platform/linux les
   pasan `entornoDe()` como hacen hoy: el comportamiento no cambia.
2. lib/paths.js: `defaultStateDir(root)` y `logsDir()` según la sección 4.6. En Linux
   devuelve exactamente `process.env.NEXO_STATE_DIR || root` como hoy.
3. server.js, launcher.js y auth-manager.js (bloque CLI) usan defaultStateDir(__dirname).
   gpu-stream.js NO se toca.
4. platform/index.js tal como la sección 4.1.
5. platform/linux/index.js: MUEVE de server.js, tal cual y con sus comentarios:
   executeWtype, enqueueInput y su `queue`, runWtype, MARCAS_ELECTRON, electronPorPid,
   procesoEsElectron, activeWindowIsChromium, todo el bloque del portapapeles
   (clipboardArgs, clipboardOwnedText, clipboardOriginal, clipboardRestoreTimer,
   CLIPBOARD_RESTORE_MS, scheduleClipboardRestore, SEGURO_POR_TECLADO,
   runChromiumAwareText, restoreClipboardOnExit), hyprSocketPath, hyprIpc, luaString,
   luaDispatch, layerPointerButtons, pointerAction (recibe `monitor` como segundo
   parámetro en vez de leer la variable global), la parte de pumpScroll que ejecuta el
   scroll (el `pointerAction move` + wlrctl/X11), mapaAtajosPath, generadorAtajos,
   keybindsRice, mapaAtajos, atajoDelRice, bindCache, effectiveBinds, runHyprShortcut,
   workspaceAction, y la lectura de monitores de updateMonitor (hyprIpc('j/monitors') +
   el filtro + el map). Las rutas relativas a __dirname deben seguir apuntando a la RAÍZ
   del proyecto (usa `path.join(__dirname, '..', '..', ...)`): wlrctl, mapa-atajos.json,
   mapa-atajos.py, .traza-teclado.
   Exporta el contrato de la sección 4.1 con capabilities de Linux, donde:
   text = runChromiumAwareText, namedKey = n => runWtype(keyCommand(n)) con el mismo error
   si es null, keyEvent = la rama actual de inputAction (browserKeyCommand → si es
   ['--', x] runChromiumAwareText(x), si no runWtype(args)), shortcut = runHyprShortcut,
   workspace = workspaceAction, clipboardGet = el `wl-paste` de GET /clipboard,
   clipboardSet = el `startCommandInput('wl-copy', …)` de POST /clipboard,
   screenshotJpeg = el grim de GET /screen, startJpegStream = el bucle de streamFrames con
   `grim -o <monitor.name> -t jpeg -q <quality> -` y la espera de 25 ms (devuelve stop()),
   spawnSystemAudio = el spawn de pw-record de startAudioCapture (incluido el fallback a
   'alsa_output.pci-0000_09_00.4.analog-stereo.monitor'), defaultAudioTarget = pactl
   get-default-sink, keepAwake/on = no-op, init = no-op, close = restoreClipboardOnExit.
6. platform/linux/media.js: mueve de webrtc-host.js la creación de la FIFO + wf-recorder de
   startVideo y el spawn de pw-record de startAudio, como dos funciones que devuelven
   { child, stream } y child respectivamente. webrtc-host.js recibe en su constructor
   `spawnRawVideo` y `spawnSystemAudio` y deja de requerir ./entorno. Toda la lógica de
   troceo de cuadros/bloques, reintentos y estadísticas se queda en webrtc-host.js.
7. launcher.js: en win32 no lanza gpu-stream.js; si existe gpu-stream-windows.js lanza ese,
   y si no, anota "Vídeo GPU de Windows todavía no disponible" una sola vez. Nada más.
8. headless/install-headless: añade `lib platform` a la lista de carpetas que se copian
   (la línea `for directory in assets bin node_modules windows-helper; do`) y cambia el
   verificador de require por este, que recorre subcarpetas y resuelve relativo al
   archivo:
     missing=''
     while IFS= read -r source; do
       base=$(dirname "$source")
       while read -r dependency; do
         target=$(realpath -m "$base/$dependency")
         [ -f "$target" ] || [ -f "$target.js" ] || [ -f "$target/index.js" ] || missing="$missing ${source#/opt/nexo/} -> $dependency"
       done < <(grep -oE "require\('\.{1,2}/[^']+'\)" "$source" | sed "s/require('//;s/')//")
     done < <(find /opt/nexo -maxdepth 3 -name '*.js' -not -path '*/node_modules/*')
     [ -z "$missing" ] || { printf 'Faltan módulos en /opt/nexo:%s\n' "$missing" >&2; exit 1; }
   OJO: el verificador corre DESPUÉS de copiar las carpetas; muévelo debajo del bucle de
   copia si hoy está antes.
9. test/device-manager.test.js: la comprobación de modo 0600 se salta en win32
   (`{ skip: process.platform === 'win32' }` en ese test o un `if` que lo explique).
10. platform/windows/index.js: stub del contrato. capabilities de Windows (sección 4.1),
    init/close/keepAwake/on no hacen nada, listMonitors devuelve
    [{ index:0, name:'\\\\.\\DISPLAY1', description:'Monitor (provisional)', x:0, y:0,
    width:1920, height:1080, primary:true }], todo lo demás lanza
    Error('No implementado en Windows todavía (fase F4)').
11. microfono-host.js: `require(process.platform === 'win32' ? './microfono-virtual-windows'
    : './microfono-virtual')`. microfono-virtual-windows.js: mismas exportaciones que
    microfono-virtual.js; asegurarDispositivo lanza Error('Micrófono de Windows pendiente
    (fase F7)'); la clase MicrofonoVirtual existe y su escribir() no hace nada.
12. server.js: sustituye las llamadas por platform.*, inicializa con
    `await platform.init({ log, stateDir })` antes de listen (envuelve el arranque en una
    función async), y `platform.close()` en el apagado. updateMonitor usa
    platform.listMonitors(). /screen, /stream, /clipboard, /audio-live y el bucle JPEG usan
    las funciones del contrato. El agrupado de texto usa la regla exacta de la sección 4.1.
    `require('./entorno')` y `require('./entrada-x11')` desaparecen de server.js (ahora los
    requiere sólo platform/linux).
13. test/platform-contract.test.js: comprueba que el módulo de la plataforma actual exporta
    todas las claves del contrato con el tipo correcto; en Linux además comprueba
    platform/windows (que no tiene dependencias de Linux); en Windows NO requiere
    platform/linux (cargaría entorno.js, que usa process.getuid).

Verificación (copia la salida real):
- `npm test` → todo en verde en Windows (incluido el test nuevo).
- `node --check` sobre cada .js tocado o creado.
- Arranque en Windows con estado temporal:
    $env:NEXO_STATE_DIR="$env:TEMP\nexo-f1"; $env:NEXO_GPU='0'; $env:NEXO_MICROFONO='0'
    $env:REMOTE_KEYBOARD_HOST='127.0.0.1'; $env:REMOTE_KEYBOARD_TOKEN='prueba-f1'
    node server.js
  y en otra consola:
    curl.exe -s http://127.0.0.1:8765/health          → {"ok":true}
    curl.exe -s -H "x-remote-token: prueba-f1" http://127.0.0.1:8765/info
      → JSON con "monitors":[{..."name":"\\\\.\\DISPLAY1"...}]
    curl.exe -s -X POST -H "x-remote-token: prueba-f1" -H "content-type: application/json" -d "{\"type\":\"text\",\"value\":\"a\"}" http://127.0.0.1:8765/input
      → {"ok":true} (el texto se agrupa) y en la consola del servidor el error
        "No implementado en Windows todavía (fase F4)" al vaciarse el grupo, SIN que el
        servidor se caiga.
  Detén el servidor con Ctrl+C.
- `git diff --color-moved=zebra f1-start -- server.js webrtc-host.js` y explica en la
  bitácora cada bloque que NO aparezca como movido.
```

#### R-F1 · prompt para Opus 5.5

```text
FASE F1 — revisión. Es la fase más delicada para Linux: no se puede ejecutar Linux aquí.

1. Con `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change f1-start..HEAD`
   comprueba que cada función listada en A-F1 punto 5 y 6 aparece como bloque MOVIDO.
   Lee línea a línea todo lo que no sea movimiento: sólo se admiten el parámetro
   `monitor` de pointerAction, las rutas `..', '..'`, los module.exports, la inyección de
   fábricas en webrtc-host.js y el paso de `env` a lib/proc.js. Cualquier otro cambio de
   lógica se revierte.
2. Trampas concretas a buscar:
   - pointerAction o la parte movida de pumpScroll siguen leyendo una variable `monitor`
     global que ya no existe en ese módulo (en Linux daría ReferenceError en el primer clic,
     y en Windows no se nota porque no se carga).
   - __dirname dentro de platform/linux apuntando a platform/linux en vez de a la raíz
     (wlrctl, mapa-atajos.py, .traza-teclado).
   - El agrupado de texto con `|| 30`.
   - startJpegStream de Linux sin respetar el límite `writableLength < 400 * 1024` por
     espectador (eso debe quedarse en el servidor, que es quien conoce a los espectadores).
   - La restauración del portapapeles al salir (restoreClipboardOnExit) sigue conectada a
     `process.on('exit')` y al apagado.
   - install-headless: el verificador corre después de copiar lib/ y platform/, y su
     regex encuentra los require de platform/linux/index.js hacia '../../entorno' etc.
     Prueba el verificador con bash (Git Bash sirve) sobre una copia del árbol en una
     carpeta temporal que simule /opt/nexo, quitando a propósito lib/proc.js: debe fallar
     con el nombre del módulo.
3. Simula el arranque de la plataforma Linux en Windows lo más lejos posible:
   `node -e "process.getuid=()=>1000; require('./platform/linux')"` debe cargar sin error
   de sintaxis ni de require (entorno.js mirará /run/user/1000 y no encontrará nada: eso es
   correcto).
4. Repite la verificación de A-F1 en Windows.
5. Anota en F1-opus.md la lista exacta de cosas que la fase L deberá probar en Linux por
   culpa de este refactor (clic en terminal, menú Inicio de NEXO, espacio en Chromium,
   atajos Super del rice, scroll, cambio de escritorio, JPEG, audio, greeter X11).
```

**Salida:** servidor arrancando en Windows; Linux con código movido sin cambios de lógica.

---

### F2 · Correcciones transversales de seguridad y robustez

**Objetivo:** corregir C1–C6, C8 y C9 en el código común, con pruebas.

#### A-F2 · prompt para Argon 4

```text
FASE F2 — Correcciones comunes (sirven a Linux y a Windows).

Archivos permitidos: server.js, auth-manager.js, device-manager.js, launcher.js (sólo C2
y C3), rotate-token.js (sólo C3), package.json, package-lock.json, y nuevos: lib/safe.js,
test/safe.test.js, test/server-http.test.js, docs/windows/bitacora/F2-argon.md.

C1 (CRÍTICO, comprobado): una petición con `Cookie: nexo_device=%` tumba el servidor.
  - lib/safe.js: `safeDecode(texto)` devuelve null si decodeURIComponent lanza.
    cookieValue() pasa a lib/safe.js usando safeDecode (valor inválido = '' ).
  - Todas las decodificaciones de rutas (/files/, /devices/) usan safeDecode y responden
    400 {"error":"Ruta inválida"} si da null.
  - `new URL(req.url, …)`: si lanza, 400 y fin.
  - Envuelve el cuerpo completo del manejador de peticiones en try/catch: un error
    síncrono responde 500 {"error":"Error interno"} (si aún no se enviaron cabeceras) y se
    registra con console.error, sin token ni cookies en el mensaje.
C2: borra `console.log(\`TOKEN=${token}\`)` de server.js. El lanzador sigue detectando el
  arranque por "Teclado remoto activo". (El enmascarado del log en archivo es de F8.)
C3: lib/safe.js `atomicWriteJson(file, value, mode)`: escribe en `${file}.tmp-${pid}`,
  fsync, cierra, renombra sobre el destino; en win32 reintenta el rename hasta 5 veces con
  50 ms si da EPERM/EBUSY/EACCES; aplica `mode` con chmod sólo fuera de win32. Úsala en
  device-manager.js (writeState), auth-manager.js (saveAuth), launcher.js (saveState) y
  rotate-token.js. Ninguna de esas escrituras queda con fs.writeFileSync directo.
C4: scrypt asíncrono. En auth-manager.js `verifyAuth` pasa a `verifyAuthAsync` (usa
  util.promisify(crypto.scrypt)); deja `verifyAuth` síncrona exportada para la CLI y los
  tests existentes. En device-manager.js `consumePairingAsync` igual. server.js usa las
  asíncronas en /auth/login y /pair. Mismos parámetros de scrypt (longitud 32, salt igual):
  los hashes existentes deben seguir validando.
C5: subida de archivos con stream.pipeline(req, limitador, writeStream): el limitador es
  un Transform que cuenta bytes y falla con un error marcado `tooLarge` al pasar
  maxUploadBytes. En cualquier error: borrar el temporal, 413 si tooLarge, 500 si no. El
  WriteStream con 'wx' que falla también responde 500 sin tumbar nada.
C6: sustituye el WebSocket hecho a mano por la librería `ws` (versión exacta 8.x más
  reciente que tenga al menos dos semanas; fíjala sin ^ en package.json). Usa
  `new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })` y
  `handleUpgrade` dentro del 'upgrade' existente, conservando las mismas comprobaciones de
  dispositivo/sesión y las rutas /live y /audio-live. Envío binario con
  `socket.send(buffer, { binary: true })` sólo si `socket.bufferedAmount < 400*1024`
  (vídeo) o `< 128*1024` (audio), como hoy. Latido con ping cada 15 s y terminate() si no
  hubo pong. Borra websocketFrame() y el latido viejo.
C8: renovación deslizante en DeviceStore.get(): si al dispositivo le quedan menos de 15
  días, `expiresAt = now + maxAgeMs`, se guarda, y get() devuelve también
  `renewed: true`. server.js, cuando un dispositivo viene renovado, reenvía la cookie con
  el MISMO secreto (lo tiene en la petición) y Max-Age nuevo.
C9: el proxy /gpu-webrtc/* sólo acepta POST /gpu-webrtc/offer y GET /gpu-webrtc/health y
  /gpu-webrtc/stats; lo demás 404. Reenvía sólo content-type y content-length (nada de
  cookie, authorization ni x-remote-token).

Pruebas (node --test):
- test/safe.test.js: safeDecode, cookieValue con '%', '%E0%A4%A', valores normales;
  atomicWriteJson (escribe, sobrescribe, no deja .tmp).
- test/server-http.test.js: arranca server.js como proceso hijo en un puerto libre
  (REMOTE_KEYBOARD_PORT), con NEXO_STATE_DIR temporal, NEXO_GPU=0, NEXO_MICROFONO=0,
  NEXO_REQUIRE_LOGIN=0, NEXO_PLATFORM sin tocar, REMOTE_KEYBOARD_TOKEN fijo, y comprueba:
  1) cookie `nexo_device=%` → 403 y /health sigue en 200 después;
  2) Host inválido → 400 y el servidor vivo;
  3) GET /files/%E0%A4%A con token → 400 y vivo;
  4) emparejamiento por token: GET /?token=… → 302 y Set-Cookie nexo_device;
     GET /info con esa cookie → 200;
  5) subida de 1 KiB → 201; subida mayor que NEXO_MAX_UPLOAD_BYTES=2048 → 413 y sin
     archivo temporal en el directorio;
  6) proxy: GET /gpu-webrtc/otra → 404.
  Mata el hijo al final aunque una prueba falle.

Verificación: `npm test` en verde, salida completa en la bitácora.
```

#### R-F2 · prompt para Opus 5.5

```text
FASE F2 — revisión.
1. Reproduce C1 contra el commit f2-start (debe caerse) y contra HEAD (no debe caerse):
   arranca cada versión en un puerto distinto con estado temporal y lanza la petición.
2. Comprueba que los hashes de contraseña y de código existentes siguen validando con las
   funciones asíncronas: crea credenciales con la versión vieja (git stash / worktree en
   f2-start) y verifícalas con la nueva.
3. Revisa que no quede ningún fs.writeFileSync directo sobre archivos de estado
   (`git grep -n writeFileSync`), salvo los que no son estado (anótalos).
4. WebSocket: con el navegador integrado abre http://127.0.0.1:<puerto>/?token=… con
   NEXO_GPU=0 y comprueba en la pestaña de red que /live se conecta (en Windows aún no hay
   imagen hasta F4: lo que se comprueba es el upgrade 101 y que no hay errores en consola).
   Comprueba también el latido: un socket sin pong se cierra a los ~30 s.
5. C8: simula un dispositivo con expiresAt dentro de 10 días editando el JSON temporal y
   comprueba que la siguiente petición devuelve Set-Cookie y el archivo tiene la fecha nueva.
6. Busca cualquier ruta que pueda mandar el token o una cookie al log.
7. Anota en F2-opus.md qué hay que probar en Linux en la fase L (WebSocket de audio JPEG,
   login, emparejamiento) porque esta fase tocó código común.
```

---

### F3 · `nexo-agent.exe` (Go)

**Objetivo:** el agente nativo completo según la sección 4.2, probado por sí solo.

#### A-F3 · prompt para Argon 4

```text
FASE F3 — Agente nativo nexo-agent.exe en Go. Implementa EXACTAMENTE el protocolo de la
sección 4.2 del plan, incluidos los subcomandos de audio.

Archivos permitidos: todo lo nuevo bajo native/agent/, scripts/windows/agent-probe.ps1,
scripts/windows/build.ps1 (sólo si necesitas ajustar la compilación del agente),
docs/windows/bitacora/F3-argon.md.

Estructura:
  native/agent/go.mod            module nexo/agent ; go 1.24 ; dependencias fijadas:
                                 golang.org/x/sys, github.com/go-ole/go-ole,
                                 github.com/moutend/go-wca (sólo para WASAPI)
  native/agent/main.go           subcomandos: serve | audio-loopback | audio-play |
                                 audio-devices | version ; DPI awareness lo primero
  native/agent/protocol.go       lectura de líneas, despacho en orden, respuestas,
                                 eventos, salida al cerrarse stdin
  native/agent/input.go          SendInput: estructura INPUT de 40 bytes, ratón absoluto
                                 + verificación con GetCursorPos/SetCursorPos, botones,
                                 rueda, texto UNICODE, teclas por scan code, soltar
                                 modificadores ante error
  native/agent/monitors.go       enumeración DXGI por COM (CreateDXGIFactory1,
                                 EnumAdapters1(0), EnumOutputs, GetDesc) y escritorio
                                 virtual (GetSystemMetrics SM_XVIRTUALSCREEN…)
  native/agent/clipboard.go
  native/agent/desktops.go       registro de escritorios virtuales (sección 4.4) y switch
  native/agent/foreground.go     ventana al frente + elevación
  native/agent/session.go        estado del escritorio de entrada (normal/secure),
                                 keepawake en hilo bloqueado
  native/agent/audio_loopback.go WASAPI loopback → s16le 48 kHz estéreo, silencio
                                 sintético, conversión float32→s16, remuestreo lineal
                                 si la mezcla no es 48 kHz, seguir al dispositivo por
                                 defecto si cambia
  native/agent/audio_play.go     render en el dispositivo cuyo nombre contiene --match;
                                 código de salida 3 si no existe
  native/agent/*_test.go         pruebas de las funciones puras: tamaño de INPUT, cálculo
                                 de coordenadas normalizadas, índice de escritorio a
                                 partir de bytes de registro, conversión de audio,
                                 construcción de eventos de texto con pares sustitutos

Reglas:
- Toda llamada COM en un hilo con runtime.LockOSThread() y CoInitializeEx.
- Comprueba SIEMPRE el retorno de SendInput (debe ser igual al número de eventos) y
  devuelve error con GetLastError si no.
- Ningún panic debe tumbar `serve`: recover por petición y respuesta ok:false.
- Mensajes de error en español.
- stderr sólo para registro; stdout sólo JSON (en serve) o PCM (en audio-*).

scripts/windows/agent-probe.ps1: arranca `bin\win\nexo-agent.exe serve` como proceso con
stdin/stdout redirigidos (System.Diagnostics.Process), y:
  1) espera el evento ready e imprime su contenido;
  2) monitors → imprime la tabla;
  3) abre notepad.exe, espera a que esté al frente, envía text "Hola ñandú áéíóú 😀\n2ª línea",
     luego keys Ctrl+A, Ctrl+C (scan codes 1D/1E y 1D/2E), luego clipboard.get, y compara
     con lo enviado (Notepad usa \r\n: normaliza); imprime IGUAL o DISTINTO;
  4) pointer move al centro del monitor 0, lee la posición con
     [System.Windows.Forms.Cursor]::Position y la imprime junto a la esperada;
  5) desktop.info;
  6) foreground;
  7) cierra stdin y comprueba que el proceso termina en < 2 s.
  Cierra Notepad sin guardar al final (keys Alt+F4 y luego la tecla de "No guardar", o
  Stop-Process).

Verificación (salida real a la bitácora):
- `cd native/agent; go vet ./...; go test ./...`
- `pwsh -File scripts/windows/build.ps1`
- `bin\win\nexo-agent.exe version`
- `bin\win\nexo-agent.exe audio-devices` → debe listar "CABLE Input".
- `pwsh -File scripts/windows/agent-probe.ps1` → IGUAL en el texto, posición del cursor
  a ≤ 1 px, y salida limpia.
- Audio: reproduce un video con sonido en el navegador y ejecuta
  `bin\win\nexo-agent.exe audio-loopback --rate 48000 --channels 2 > $env:TEMP\loop.raw`
  durante 5 s (Ctrl+C), luego
  `ffmpeg -f s16le -ar 48000 -ac 2 -i $env:TEMP\loop.raw $env:TEMP\loop.wav` y anota el
  tamaño: 5 s deben ser ≈ 960 000 bytes. Repite con el sistema en SILENCIO: el tamaño
  debe ser el mismo (silencio sintético), no cero.
- audio-play: `ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -f s16le -ar 48000 -ac 1 - | bin\win\nexo-agent.exe audio-play --match "CABLE Input" --rate 48000 --channels 1`
  y comprueba en Configuración → Sonido → CABLE Output que el medidor se mueve (anota si
  no puedes verlo). Con `--match "NoExiste"` el código de salida debe ser 3 y NO debe
  sonar nada por los parlantes.
```

#### R-F3 · prompt para Opus 5.5

```text
FASE F3 — revisión del agente nativo.
1. Lee todo native/agent. Contrasta cada op y subcomando con la sección 4.2: nombres,
   parámetros, respuestas, eventos, códigos de salida.
2. Revisa a mano la estructura INPUT/MOUSEINPUT/KEYBDINPUT (alineación y tamaño en amd64),
   las constantes (MOUSEEVENTF_*, KEYEVENTF_*), el cálculo de coordenadas absolutas con
   monitores en posiciones negativas (pon el monitor secundario a la izquierda del
   principal en Configuración → Pantalla y repite la prueba del cursor en ambos), y el
   orden de soltado de modificadores.
3. Prueba con escalado de pantalla al 125 % en un monitor: el cursor debe caer donde se
   pide (DPI awareness).
4. WASAPI: comprueba los tres casos (sonando, silencio, cambio de dispositivo por defecto
   a mitad de captura) y que no haya deriva: 60 s de captura deben medir 60 s ± 0,1.
5. audio-play nunca cae en el dispositivo por defecto (lee el código, no sólo la prueba).
6. Robustez de serve: envía una línea que no sea JSON, una op desconocida y un JSON enorme
   (1 MiB): debe responder error y seguir vivo. Mata el proceso padre (cierra stdin) a
   mitad de una op larga: debe terminar.
7. Escritorios virtuales: crea 3 escritorios (Win+Ctrl+D) y prueba desktop.switch a 1, 3,
   2, next, previous; anota si funciona en esta versión de Windows y la ruta de registro
   real usada.
8. Corrige y deja F3-opus.md con lo comprobado.
```

---

### F4 · Primer control remoto real en Windows

**Objetivo:** desde el celular y desde otra PC, por LAN, se ve la pantalla (JPEG) y se
controla todo: mouse, tacto, teclado, atajos, portapapeles, escritorios, monitores.

#### A-F4 · prompt para Argon 4

```text
FASE F4 — platform/windows funcional (salvo vídeo GPU, audio y micrófono).

Archivos permitidos: platform/windows/index.js, nuevos platform/windows/agent-client.js,
platform/windows/keymap.js, platform/windows/ffmpeg.js, test/keymap-windows.test.js,
test/jpeg-splitter.test.js, test/agent-client.test.js; en server.js SÓLO lo indicado en
los puntos 6 y 7; en index.html SÓLO lo del punto 8; docs/windows/bitacora/F4-argon.md.

1. agent-client.js: lanza bin\win\nexo-agent.exe serve (ruta configurable con
   NEXO_AGENT_PATH), espera "ready" (timeout 5 s), `call(op, params)` con id incremental y
   timeout de 2 s por petición, rechaza todas las pendientes si el agente muere, lo relanza
   con espera creciente (0,5 s → 8 s) y emite los eventos ('desktop', 'displays-changed').
   Nunca deja el proceso huérfano: al cerrar, stdin.end() y, si no sale en 1 s, kill().
2. keymap.js: según la sección 4.3, exportando codeToScan, named, combo, shortcut,
   isBlocked. Puro: no requiere nada de Windows.
3. ffmpeg.js: findFfmpeg(), jpegStreamArgs({index, fps, quality}),
   screenshotArgs({index, quality}), y la clase JpegSplitter (stream Transform que emite un
   Buffer por JPEG completo, cortando por FF D8 … FF D9, tolerante a trozos partidos en
   cualquier byte).
4. platform/windows/index.js implementa el contrato completo salvo spawnSystemAudio y
   spawnRawVideo (siguen lanzando "fase F6"):
   - listMonitors → op monitors (conserva index para ffmpeg).
   - pointer(data, monitor): x = monitor.x + round(x·(width−1)), igual y; action tap →
     click, down/dragstart → down, up → up, move → move; button right|left.
   - scroll → op scroll con las mismas coordenadas.
   - text, namedKey, keyEvent, shortcut según 4.3 (shortcut rechaza los bloqueados con el
     mensaje exacto del plan).
   - workspace → desktop.switch. clipboardGet/Set.
   - screenshotJpeg → ffmpeg una vez. startJpegStream → UN ffmpeg persistente por monitor
     (si cambia el monitor, se para y se lanza otro), relanzado con espera creciente si
     muere; stop() lo mata con taskkill /T /F si no sale en 1 s.
   - keepAwake → op keepawake. on → eventos del agente ('desktop-state' con 'normal'|'secure').
   - defaultAudioTarget → '' por ahora.
5. Pruebas: keymap (códigos de la tabla, Ctrl+Shift+C, AltGr ya convertido a meta,
   meta+espacio = toque de Win, Win+L bloqueado, redo = Ctrl+Y), splitter (JPEG partido en
   1 byte, en 3 trozos, dos JPEG en un trozo), agent-client con un agente falso
   (un script node que habla el protocolo).
6. server.js: (a) cuando platform.capabilities.independentSession es false,
   /session-options responde { kind:'shared', chooser:true, original:{name:'Mi PC'},
   alternative:{ available:false, supported:false, name:'NEXO', url:'' } };
   (b) suscribe platform.on('desktop-state') y avisa a los clientes por el canal de
   control con rtcHost.notify({ type:'secure-desktop', active: state === 'secure' });
   (c) llama platform.keepAwake(true) cuando hay al menos un cliente (par WebRTC,
   espectador JPEG o WebSocket de audio) y keepAwake(false) 60 s después de quedarse sin
   ninguno; (d) en el diagnóstico (/diagnostics y /diagnostics/export) añade
   server.platform = platform.name.
7. server.js: nada más. El resto ya debería funcionar con el contrato.
8. index.html (cambios mínimos, mismo estilo del archivo):
   (a) si options.alternative?.supported === false, la tarjeta de NEXO independiente se
   oculta (hidden) en el portal; Mi PC y "Sólo micrófono" siguen;
   (b) mensaje {type:'secure-desktop', active:true} del canal de control → banner fijo
   "Windows muestra una pantalla protegida (bloqueo o permiso de administrador). NEXO no
   puede verla ni controlarla hasta que se cierre." ; active:false lo quita.

Verificación (salida real a la bitácora):
- `npm test` en verde.
- Arranque local: $env:NEXO_GPU='0'; $env:NEXO_MODE='local'; node launcher.js
  (estado en %LOCALAPPDATA%\NEXO\state). Anota la URL LOCAL que imprime.
- Con el navegador del propio PC: abre la URL LOCAL, empareja, entra con la contraseña
  (créala antes con `node auth-manager.js set Letzus`, leyendo la contraseña de stdin;
  pide a Letzus que la escriba él), y comprueba: imagen JPEG que se actualiza, clic,
  doble clic, clic derecho, arrastrar una ventana, rueda, escribir "ñandú áéíóú ¿?" en
  el Bloc de notas, Ctrl+C/Ctrl+V, AltGr+E (abre el Explorador: Win+E), AltGr solo (abre
  Inicio), AltGr+L (debe salir el error de bloqueado y la sesión NO se bloquea),
  escritorios 1/2/next/previous, cambio de monitor desde el botón de monitores.
- Anota cuáles pasan y cuáles no. Lo que no pase no lo "arregles" fuera de la lista de
  archivos: anótalo.
```

**👤 TÚ, al final de F4 (con Opus):** desde el celular en la misma Wi-Fi, abre la URL LOCAL,
empareja, entra a "Mi PC", y prueba MOVER, DIRECTO, el panel de teclado y escribir en el
Bloc de notas. Dile a Opus qué falla.

#### R-F4 · prompt para Opus 5.5

```text
FASE F4 — revisión del primer control remoto.
1. Revisa platform/windows contra la sección 4.1 y keymap contra la 4.3, tabla por tabla.
2. Prueba tú en el navegador integrado toda la lista de A-F4. Añade: arrastre largo
   (seleccionar texto en el Bloc de notas arrastrando), clic en un menú desplegable,
   clic en el monitor de la izquierda y de la derecha, texto largo pegado desde el panel
   (2000 caracteres), escribir rápido sin pérdidas ni desorden, y que un clic después de
   escribir no se adelante al texto (orden de la cola).
3. Abre el Administrador de tareas (elevado): con NEXO sin elevar, el clic no debe
   funcionar Y debe registrarse el motivo; con NEXO elevado (lánzalo desde una consola de
   administrador) debe funcionar. Deja anotado para F9.
4. Bloquea la pantalla localmente (Win+L en el teclado físico): el cliente debe mostrar el
   banner de pantalla protegida y el ffmpeg de JPEG no debe entrar en un bucle de
   reinicios cada segundo (mira el registro). Al desbloquear, la imagen vuelve sola.
5. Verifica que no quedan ffmpeg ni nexo-agent huérfanos tras Ctrl+C del lanzador
   (Get-Process ffmpeg, nexo-agent). Si quedan, es aceptable SÓLO hasta F8; anótalo.
6. Pide a Letzus la prueba 👤 con el celular y corrige lo que reporte.
```

---

### F5 · Vídeo H.264 por NVENC

**Objetivo:** la ruta principal de vídeo: 1080p a 45/60 FPS compartida entre clientes,
reposo sin clientes, cambio de perfil y de monitor sin renegociar.

#### A-F5 · prompt para Argon 4

```text
FASE F5 — gpu-stream-windows.js y correcciones del puente Pion (C7).

Archivos permitidos: nuevo gpu-stream-windows.js, platform/windows/ffmpeg.js (añadir
argumentos GPU y el sondeo), gpu-webrtc/main.go, test/ffmpeg-args.test.js,
docs/windows/bitacora/F5-argon.md.

1. gpu-stream-windows.js replica las responsabilidades de gpu-stream.js (léelo entero):
   perfil desde .nexo-gpu-profile.json (mismos valores válidos y bitrates), monitor desde
   .nexo-monitor.json, reposo tras NEXO_GPU_IDLE_STOP_MS sin pares (consultando
   /health del puente cada 500 ms), reanudación al llegar un par, reconfiguración cada
   700 ms si cambian monitor o perfil, relanzado del puente si cambian los FPS. Diferencias:
   - Mapea el nombre de monitor guardado a output_idx con su propio agent-client (op
     monitors). Si el nombre no existe, usa el primary.
   - Elige la cadena con el sondeo de la sección 4.5 y la recuerda en
     <stateDir>\.nexo-gpu-pipeline.json. Sondeo: lanza la cadena 3 s hacia RTP local y
     comprueba con /stats del puente que `packets` aumentó; la primera que funcione gana.
     d3d11-native sólo se prueba si el perfil coincide con la resolución del monitor; si no,
     se salta a la siguiente.
   - Un solo proceso ffmpeg (no hay GStreamer).
   - Espera creciente 1 s → 5 s si ffmpeg muere seguido; si el agente informa
     desktop 'secure', NO relanza: espera el evento 'normal'.
   - Apagado: escucha process.on('message') {type:'shutdown'} además de SIGINT/SIGTERM;
     mata ffmpeg y el puente con taskkill /T /F tras 900 ms.
   - Puente: bin\win\nexo-gpu-webrtc.exe con stdin en 'pipe' (ver punto 2).
2. gpu-webrtc/main.go (C7):
   a) Registra el par en b.peers JUSTO después de crearlo (antes de SetRemoteDescription);
      closePeer queda idempotente; si algo falla antes de responder, se cierra y se quita.
   b) En la goroutine que hoy lee y descarta RTCP, decodifica con rtcp.Unmarshal y cuenta
      PLI, FIR y NACK en contadores atómicos; /stats los incluye (pli, fir, nack).
   c) Si NEXO_EXIT_ON_STDIN_EOF=1, una goroutine lee os.Stdin hasta EOF y entonces cierra
      todo y sale. signal.Notify usa os.Interrupt (y syscall.SIGTERM sólo fuera de Windows,
      con build tags o comprobando runtime.GOOS).
   d) No cambies la renumeración RTP ni el códec.
   Compila para linux y windows: `GOOS=linux go build ./...` y `GOOS=windows go build ./...`
   dentro de gpu-webrtc deben pasar los dos.
3. test/ffmpeg-args.test.js: argumentos de cada cadena para 720p/900p/1080p y 30/45/60
   (bitrate, bufsize, gop) iguales a los de Linux.

Verificación:
- `npm test`, compilación del puente para las dos plataformas, build.ps1.
- Lanzador local con GPU: $env:NEXO_MODE='local'; node launcher.js. Navegador del PC: la
  cabecera del cliente debe mostrar GPU, FPS y RTT. Anota la cadena elegida.
- 1080p@60 durante 60 s: FPS del diagnóstico ≥ 58, paquetes perdidos 0 en LAN, uso de CPU
  de ffmpeg (Get-Process ffmpeg | Select CPU, cada 10 s).
- Cambia el perfil a 720p@30 y a 900p@45 desde el cliente: la imagen sigue sin recargar.
- Cambia de monitor desde el cliente: la imagen cambia sin renegociar (no se vuelve a
  pedir /gpu-webrtc/offer: mira la pestaña de red).
- Cierra el cliente: a los 60 s ffmpeg ya no existe (reposo); al abrirlo vuelve en < 2 s.
- Dos clientes a la vez (dos pestañas): ambos a FPS completos.
```

#### R-F5 · prompt para Opus 5.5

```text
FASE F5 — revisión del vídeo GPU.
1. Revisa main.go: el par muerto ya no cuenta para el reposo (fuerza un fallo de ICE
   cortando la red del navegador a mitad de la oferta y mira /health del puente).
2. Comprueba que el sondeo no deja ffmpeg vivos entre cadenas y que el resultado se
   recuerda (segundo arranque sin sondeo).
3. Prueba el ACCESS_LOST: abre un diálogo UAC localmente (p. ej. ejecutar como
   administrador cualquier programa) con un cliente conectado. Debe aparecer el banner, no
   debe haber bucle de reinicios, y al cerrar el UAC la imagen vuelve sola.
4. Mide la latencia de punta a punta con una prueba visual: un cronómetro en pantalla
   (https://www.online-stopwatch.com o similar a pantalla completa) y una foto con el
   celular de la pantalla física junto al cliente; anota la diferencia. Compárala con la
   de Linux si Letzus la tiene.
5. Revisa PLI/NACK en /stats con un cliente por Wi-Fi: si los PLI son frecuentes, anótalo
   para una futura fase de IDR bajo demanda (requiere un codificador propio; fuera de v1).
6. Compila y ejecuta el puente para Linux en la misma rama (sólo compilar: la prueba real
   es de la fase L).
```

---

### F6 · Audio del sistema y respaldo WebRTC/CPU

#### A-F6 · prompt para Argon 4

```text
FASE F6 — spawnSystemAudio y spawnRawVideo en Windows.

Archivos permitidos: platform/windows/index.js, platform/windows/ffmpeg.js,
test/ffmpeg-args.test.js, docs/windows/bitacora/F6-argon.md. NO toques webrtc-host.js
salvo que falte algo del contrato (anótalo).

1. spawnSystemAudio({ latencyMs }) → `nexo-agent.exe audio-loopback --rate 48000
   --channels 2` con stdio ['pipe','pipe','pipe'] (stdin abierto: si Node muere, el agente
   lo nota y sale). Devuelve el ChildProcess; su stdout es el PCM que webrtc-host.js y
   /audio-live ya saben trocear.
2. spawnRawVideo({ monitor, width, height, fps }) → ffmpeg con la cadena "Vídeo CPU" de
   la sección 4.5 hacia pipe:1. Devuelve { child, stream: child.stdout }. El tamaño de
   cuadro que espera webrtc-host.js es width*height*3/2: width y height deben ser pares
   (ya los redondea dimensions()).
3. defaultAudioTarget → nombre del dispositivo de salida por defecto (audio-devices).

Verificación:
- Lanzador con $env:NEXO_GPU='0' (fuerza la ruta CPU). El cliente debe mostrar vídeo por
  WebRTC (no JPEG: la cabecera NO dice GPU y el diagnóstico dice transport rtc) y el audio
  del sistema debe oírse en el navegador del cliente (activa el audio en el cliente y
  reproduce algo en el host).
- Con GPU activa: vídeo GPU + audio a la vez; al conectar el GPU, el ffmpeg de vídeo CPU
  debe detenerse (Get-Process ffmpeg debe mostrar sólo el de GPU).
- Ruta JPEG + /audio-live: fuerza el respaldo JPEG (en el cliente, si hay opción; si no,
  bloquea UDP saliente de node.exe con una regla temporal del firewall y quítala después)
  y comprueba que el audio por WebSocket suena.
- 10 minutos de audio sin cortes ni deriva (anota si se oye eco o retardo creciente).
```

#### R-F6 · prompt para Opus 5.5

```text
FASE F6 — revisión de audio y vídeo CPU.
1. Comprueba la sincronía audio/vídeo con un video de prueba de sincronía (clap/beep).
2. Cambia la salida por defecto del host (parlantes ↔ audífonos) con un cliente oyendo:
   el audio debe seguir en < 2 s.
3. Silencio prolongado (5 min) y luego sonido: el audio vuelve al instante.
4. Cierra todos los clientes: el proceso audio-loopback termina (no queda capturando).
5. Revisa que no se quedan nexo-agent audio-loopback huérfanos tras reiniciar el servidor.
```

---

### F7 · Micrófono del celular con VB-CABLE

#### A-F7 · prompt para Argon 4

```text
FASE F7 — microfono-virtual-windows.js completo.

Archivos permitidos: microfono-virtual-windows.js, test/microfono-windows.test.js,
docs/windows/bitacora/F7-argon.md. Lee microfono-virtual.js y microfono-host.js enteros:
la versión Windows tiene que exponer EXACTAMENTE la misma API (MicrofonoVirtual con
asegurarProceso, escribir, reiniciarFallos, silenciar, detenerProceso, estado, cerrar;
asegurarDispositivo, descargarDispositivo, NOMBRE_FUENTE, NOMBRE_SINK).

1. asegurarDispositivo(): ejecuta `nexo-agent.exe audio-devices` y comprueba que existe un
   dispositivo de SALIDA cuyo nombre contiene NEXO_MIC_DEVICE (por defecto "CABLE Input").
   Si no existe lanza Error('VB-CABLE no está instalado: instala VB-Audio Virtual Cable y
   reinicia (ver PLAN-MIGRACION-WINDOWS.md, F0)'). Devuelve { sink:'CABLE Input',
   fuente:'CABLE Output' }. Cachea el resultado 30 s.
2. asegurarProceso(sampleRate, channelCount): lanza `nexo-agent.exe audio-play --match
   "<NEXO_MIC_DEVICE>" --rate <sr> --channels <ch>`. Si sale con código 3: error claro,
   fallosDeEnlace++ y a la tercera bloqueado = true, igual que la versión Linux.
3. escribir(), silenciar() (escribe ceros, no corta el flujo), nivel con caída suave, estado()
   con descripcion 'CABLE Output (micrófono del celular)': copia la lógica de la versión
   Linux; sólo cambia cómo se lanza el proceso.
4. descargarDispositivo(): no hace nada en Windows (el driver lo gestiona el usuario).
5. Prueba unitaria con un agente falso (script node) que imita audio-devices y audio-play,
   incluido el código 3.

Verificación:
- Por la URL de Internet NO hace falta aún: usa el navegador del PC con
  http://127.0.0.1:8765/microfono (localhost cuenta como contexto seguro). Habla al
  micrófono del PC: en Configuración → Sonido → CABLE Output el medidor debe moverse.
- GET /microfono/estado → conectado true, nivel > 0 mientras hablas.
- Silenciar desde el cliente → el medidor de CABLE Output queda quieto pero el dispositivo
  sigue "en uso".
```

**👤 TÚ:** en Discord (Configuración de voz → Dispositivo de entrada = **CABLE Output**),
abre NEXO **por la URL de Internet** en el celular, toca 🎤 y habla. Bloquea el teléfono
un minuto: la voz debe seguir llegando. Prueba también la página `/microfono` sola.

#### R-F7 · prompt para Opus 5.5

```text
FASE F7 — revisión del micrófono.
1. Confirma leyendo el código que NO hay ningún camino que reproduzca la voz por el
   dispositivo por defecto (sería el micrófono sonando por los parlantes de la casa).
2. Desinstalar VB-CABLE no se hace; simula su ausencia con NEXO_MIC_DEVICE="NoExiste": el
   cliente debe mostrar el error claro y el resto de NEXO seguir funcionando.
3. Un segundo celular que conecta el micrófono desconecta al primero (como en Linux).
4. Recoge el resultado de la prueba 👤 de Letzus con Discord y teléfono bloqueado.
```

---

### F8 · Lanzador, ciclo de vida, control, túnel y aviso del enlace

**Objetivo:** que NEXO en Windows arranque, se detenga y se reinicie de forma fiable, sin
huérfanos, con registros sin secretos, y que se pueda manejar como en Linux.

#### A-F8 · prompt para Argon 4

```text
FASE F8 — Ciclo de vida en Windows.

Archivos permitidos: launcher.js, server.js (sólo el punto 2), nuevos scripts/pair.js,
scripts/windows/nexo-control.ps1, scripts/windows/nexo-control.cmd,
scripts/windows/nexo-doctor.ps1, scripts/windows/nexo-avisar-enlace.ps1,
test/launcher-windows.test.js, docs/windows/bitacora/F8-argon.md.
En Linux el lanzador debe comportarse igual que hoy: todo lo nuevo va tras
`process.platform === 'win32'` salvo el enmascarado del log y la eliminación de la IP fija.

1. launcher.js en Windows:
   a) Hijos con stdio ['ignore','pipe','pipe','ipc'].
   b) shutdown(): envía {type:'shutdown'} a cada hijo, espera 1,5 s y ejecuta
      `taskkill /PID <pid> /T /F` en los que sigan vivos.
   c) <stateDir>\.nexo-pids.json con { launcher, server, gpu, tunnel } actualizado en cada
      arranque de hijo. Al arrancar el lanzador, si hay PIDs vivos de una ejecución
      anterior cuyo nombre de imagen coincide (node.exe, cloudflared.exe) y NO es él
      mismo, los mata con taskkill /T /F. También busca y mata ffmpeg.exe,
      nexo-agent.exe y nexo-gpu-webrtc.exe cuya línea de órdenes contenga la ruta del
      repositorio (Get-CimInstance Win32_Process vía `powershell -NoProfile -Command`).
   d) Instancia única: archivo de bloqueo <stateDir>\.nexo-launcher.lock abierto con 'wx'
      y el PID dentro; si existe y ese PID vive y es node.exe, imprime "NEXO ya está
      activo" y sale con 0; si no, lo reemplaza.
   e) cloudflared: CLOUDFLARED_PATH, si no `where cloudflared`, si no bin\win\cloudflared.exe.
   f) Registro a archivo en logsDir()\nexo-runtime.log, rotación 5 MiB × 3, todo lo que
      escriba con `token=` enmascarado (`token=***`) — también en Linux para el archivo (en
      Linux el archivo lo crea nexo-control con >>: allí basta con que el lanzador NO
      imprima el token cuando stdout no es una TTY; en una TTY sí lo muestra).
   g) El vigilante del túnel (startWatchdog) deja de forzar la IP 104.16.231.132: usa DNS
      normal; sólo si existe NEXO_WATCHDOG_IP la fuerza.
2. server.js y gpu-stream-windows.js: process.on('message', m => m?.type === 'shutdown' &&
   <el mismo apagado que SIGTERM>). En Linux no cambia nada (no hay canal ipc salvo que se
   lance así).
3. scripts/pair.js: el código de `nexo-control pair` (bash) pasado a un script Node
   común: `node scripts/pair.js [minutos]`, usando defaultStateDir. El bash de Linux NO se
   cambia en esta fase.
4. nexo-control.ps1 con los mismos subcomandos que el bash: start, show, link, pair
   [min], rotate [-y], status, stop, restart, log, doctor, credentials {status|init|set}.
   - start: si /health responde, muestra accesos; si no, lanza `node launcher.js` oculto
     (Start-Process -WindowStyle Hidden, redirigiendo a logs), espera /health y el
     remoteUrl como el bash (mismos tiempos), y muestra accesos.
   - credentials set: Read-Host -AsSecureString dos veces, compara, pasa la contraseña por
     stdin a `node auth-manager.js set <usuario>` sin que aparezca en la línea de órdenes
     ni en el historial.
   - log: Get-Content -Wait -Tail 80.
   nexo-control.cmd: `@pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0nexo-control.ps1" %*`
5. nexo-doctor.ps1: lo de check-env.ps1 + /health, procesos vivos, ACL de
   %LOCALAPPDATA%\NEXO (que sólo tengan acceso el usuario, SYSTEM y Administradores),
   reglas de firewall de NEXO, tarea programada NEXO, VB-CABLE, cadena GPU recordada,
   y si el proceso de NEXO está elevado. Nunca imprime el token.
6. nexo-avisar-enlace.ps1: porta linux-extra/nexo-avisar-enlace.sh (léelo entero):
   config en %APPDATA%\NEXO\nexo-aviso.conf (formato CLAVE=valor, mismas claves), modos
   vigilar | ahora | prueba, registro en logsDir()\nexo-aviso.log sin el token completo,
   Invoke-RestMethod para ntfy y Telegram. El modo vigilar lo lanzará la bandeja en F9.

Verificación:
- `npm test`.
- nexo-control start → status → link → pair → restart → stop, con salida real. Después
  de stop: Get-Process node, ffmpeg, nexo-agent, nexo-gpu-webrtc, cloudflared → ninguno de
  NEXO.
- Mata el lanzador a lo bruto (Stop-Process -Force sobre el node del lanzador) y luego
  nexo-control start: debe limpiar los huérfanos y arrancar sin EADDRINUSE.
- Dos `nexo-control start` seguidos: un solo lanzador.
- grep del log: `Select-String -Path $env:LOCALAPPDATA\NEXO\logs\*.log -Pattern 'token=(?!\*\*\*)'`
  → sin resultados.
- Modo remoto: la URL de Internet funciona desde el navegador del PC.
- nexo-avisar-enlace.ps1 prueba (si Letzus ya tiene configurado ntfy o Telegram).
```

**👤 TÚ:** desde el celular **con datos móviles** (Wi-Fi apagado), abre el enlace de
Internet. Anota si el vídeo dice GPU o si cayó al respaldo JPEG: eso decide la fase O1.

#### R-F8 · prompt para Opus 5.5

```text
FASE F8 — revisión del ciclo de vida.
1. Repite todas las verificaciones. Añade: reinicio de Windows con NEXO activo y arranque
   manual posterior (estado sucio), y cerrar la sesión de Windows con NEXO activo.
2. Revisa que la limpieza de huérfanos NUNCA puede matar un proceso ajeno: compara nombre
   de imagen y línea de órdenes, no sólo el PID (los PID se reutilizan).
3. Revisa en Linux, leyendo, que launcher.js no cambió de comportamiento salvo el
   enmascarado y el vigilante; anótalo para la fase L.
4. Que credentials set no deje la contraseña en el historial de PSReadLine
   (Get-Content (Get-PSReadLineOption).HistorySavePath).
5. Recoge el resultado 👤 por datos móviles.
```

---

### F9 · Arranque automático, inicio de sesión, energía, firewall y bandeja

#### A-F9 · prompt para Argon 4

```text
FASE F9 — NEXO como "parte de Windows".

Archivos permitidos: nuevos native/tray/* (Go), scripts/windows/install-autostart.ps1,
scripts/windows/uninstall-autostart.ps1, scripts/windows/build.ps1 (añadir la bandeja si
hace falta), docs/windows/bitacora/F9-argon.md.

1. native/tray (Go, fyne.io/systray con versión fijada; compila con -H windowsgui):
   - Al iniciar: si /health no responde, lanza `node launcher.js` (ruta del repositorio =
     carpeta padre de bin\win) con CREATE_NO_WINDOW, entorno NEXO_MODE=both, salida al
     log; si el lanzador muere, lo relanza con espera creciente hasta 60 s.
   - Lanza también `pwsh -NoProfile -WindowStyle Hidden -File
     scripts\windows\nexo-avisar-enlace.ps1 vigilar` si existe %APPDATA%\NEXO\nexo-aviso.conf.
   - Icono (genera uno simple embebido: un círculo con "N"; nada de arte de Riot en la
     bandeja) y tooltip con el estado.
   - Menú: "NEXO · activo/conectando/detenido" (deshabilitado), "Copiar enlace de
     Internet", "Copiar enlace local", "Generar código de emparejamiento" (ejecuta
     `node scripts\pair.js` y muestra el código en un MessageBox), "Abrir registros",
     "Reiniciar NEXO" (nexo-control restart), "Salir" (detiene NEXO con el mismo apagado
     ordenado y cierra la bandeja).
   - Los enlaces los lee de <stateDir>\.nexo-state.json; nunca los escribe en el log.
2. install-autostart.ps1 (requiere administrador; si no lo es, se relanza elevado):
   a) ACL de %LOCALAPPDATA%\NEXO (sección 4.6, con SID).
   b) Tarea programada "NEXO": al iniciar sesión del usuario actual, "Ejecutar con los
      privilegios más altos", "Ejecutar sólo cuando el usuario haya iniciado sesión",
      acción = bin\win\nexo-tray.exe, sin límite de tiempo, reiniciar si falla (3 veces,
      1 min). Con Register-ScheduledTask (no schtasks con cadenas a mano).
   c) Reglas de firewall sólo perfil Privado: TCP 8765 entrante para node.exe; UDP
      entrante para node.exe y nexo-gpu-webrtc.exe (WebRTC). Nombres "NEXO …". Sin reglas
      para el perfil Público.
   d) Energía (pregunta antes de cada uno, S/N, mostrando el comando):
      - powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 (no pedir
        contraseña al despertar) y powercfg /SETACTIVE SCHEME_CURRENT;
      - desactivar el Inicio rápido (HKLM\SYSTEM\CurrentControlSet\Control\Session
        Manager\Power HiberbootEnabled = 0), necesario para Wake-on-LAN desde apagado;
      - mostrar (no cambiar) si la tarjeta de red tiene "Wake on Magic Packet" activo
        (Get-NetAdapterPowerManagement) y decir cómo activarlo.
   e) Añade scripts\windows al PATH del usuario (si no está).
   f) Imprime los pasos manuales de Autologon (👤): `winget install --id
      Microsoft.Sysinternals.Autologon -e`, ejecutar Autologon64, poner usuario/contraseña
      (la guarda cifrada como secreto LSA), y la nota de Windows Hello (trampa 19).
3. uninstall-autostart.ps1: deshace b, c y e (no toca energía ni Autologon; dice cómo
   deshacerlos a mano).

Verificación:
- build.ps1 produce nexo-tray.exe. Ejecútalo a mano: aparece el icono, el menú funciona
  (copia un enlace y pégalo en el Bloc de notas; genera un código).
- install-autostart.ps1, cerrar sesión, iniciar sesión: NEXO arranca solo y el icono
  aparece; nexo-doctor en verde; el proceso node de NEXO está elevado
  (nexo-doctor lo dice).
- uninstall-autostart.ps1 y comprobar que la tarea y las reglas ya no existen; volver a
  instalar.
```

**👤 TÚ:** instala y configura Autologon. Apaga la PC desde Windows. Desde fuera de casa
(datos móviles), enciéndela con tu método de Wake-on-LAN. Recuerda que GRUB debe arrancar
Windows (trampa 17). Comprueba que te llega el aviso con el enlace y que entras.

#### R-F9 · prompt para Opus 5.5

```text
FASE F9 — revisión.
1. Revisa la tarea programada en el Programador de tareas: usuario, desencadenador,
   privilegios, "sólo cuando el usuario ha iniciado sesión" (NUNCA sesión 0: no vería el
   escritorio).
2. Firewall: ninguna regla en perfil Público; prueba conectando el PC a una red marcada
   como Pública que NEXO LAN no es accesible.
3. La bandeja no muestra consola en ningún momento (ni al reiniciar NEXO).
4. Matar node a lo bruto: la bandeja relanza NEXO; "Salir" lo deja todo cerrado sin
   huérfanos.
5. Reinicio completo de Windows con Autologon: NEXO accesible por Internet sin tocar nada.
6. Recoge la prueba 👤 de encendido remoto y anota lo que pase con GRUB.
```

---

### F10 · Documentación y pruebas integrales

#### A-F10 · prompt para Argon 4

```text
FASE F10 — Documentación y prueba de humo.

Archivos permitidos: nuevos README-WINDOWS.md, scripts/windows/smoke.ps1; PROGRESO.md
(añadir una sección "Windows" al final, sin tocar lo de Linux); README.md (sólo un párrafo
al principio que enlace README-WINDOWS.md y la tabla "Qué documento sirve para qué");
docs/windows/bitacora/F10-argon.md.

1. README-WINDOWS.md (español, mismo tono que README.md): requisitos, instalación desde
   cero (los pasos de la sección 0 + setup, build, credenciales, install-autostart,
   VB-CABLE, Autologon), uso diario (bandeja, nexo-control), emparejar, micrófono con
   Discord, límites conocidos (pantallas protegidas, ventanas elevadas, Win+L, juegos en
   pantalla completa exclusiva, sin segunda sesión), solución de problemas (doctor,
   puertos excluidos, firewall, SmartScreen) y desinstalación.
2. smoke.ps1: arranca NEXO en modo local con estado temporal en otro puerto, empareja por
   token con Invoke-WebRequest (guardando la cookie), comprueba /info, /diagnostics
   (platform = windows), escribe texto en un Bloc de notas por /input y lo verifica por
   portapapeles (como agent-probe), pide /screen y comprueba que es un JPEG (FF D8), y lo
   para todo verificando que no quedan procesos. Sale 0 o 1.
3. Ejecuta la matriz de la sección 9 del plan y marca cada fila con OK / FALLA / NO
   PROBADO, con una nota.
```

#### R-F10 · prompt para Opus 5.5

```text
FASE F10 — revisión final de Windows.
1. Sigue README-WINDOWS.md desde cero en una cuenta de usuario de Windows nueva (o pide a
   Letzus que lo haga) y corrige cada paso que no funcione tal como está escrito.
2. Ejecuta smoke.ps1 tres veces seguidas: las tres en verde.
3. Revisa la matriz de la sección 9: ninguna FALLA sin un pendiente explícito en PROGRESO.md.
4. Repasa `git log fN-start..` de todas las fases y confirma que no entró estado privado
   (`git log -p | Select-String "nexo_device=|\"hash\":|token\":"`).
5. Etiqueta windows-v1 si todo está bien. NO fusiones a main: eso es después de la fase L.
```

---

### L · Verificación en Linux (antes de fusionar a `main`)

Se hace al volver a arrancar Arch. Es obligatoria: varias fases tocaron código común.

#### Prompt para Opus 5.5 (en Linux)

```text
FASE L — Verificación en Linux de la rama windows-port antes de fusionarla a main.
Estás en Arch/Hyprland, carpeta ~/Downloads/teclado-remoto, que es TAMBIÉN la instalación
en uso de NEXO. Cuidado: el servicio está corriendo y Letzus lo usa.

1. Lee AGENTS.md, el plan y TODAS las bitácoras -opus.md (cada una deja una lista de "qué
   probar en Linux").
2. Prepara una copia de trabajo aparte para no romper la instalación en uso:
   `git worktree add ~/Downloads/nexo-L windows-port`, `npm ci` dentro, y arranca esa copia
   con NEXO_STATE_DIR temporal, otro REMOTE_KEYBOARD_PORT, NEXO_GPU_WEBRTC_PORT=9095,
   NEXO_GPU_RTP_PORT=5009, NEXO_MICROFONO=0 y NEXO_MODE=local. Compila el puente Go en
   bin/nexo-gpu-webrtc de la copia.
3. Prueba desde el navegador todo lo de la lista: clic sobre la ventana bajo el cursor
   (no la activa), menú Inicio del rice, espacio y comas en Chromium/Claude Desktop,
   atajos Super del mapa del rice (los bloqueados siguen bloqueados), scroll, escritorios,
   JPEG, audio por WebSocket y WebRTC, GPU NVENC, cambio de monitor, archivos, portapapeles,
   login, emparejamiento por código, rotación.
4. Prueba el instalador de la sesión independiente SÓLO en modo verificación: ejecuta su
   bloque de copia y el verificador de require contra un directorio temporal en vez de
   /opt/nexo (haz una copia del script con la ruta cambiada; no instales nada con sudo sin
   preguntar a Letzus).
5. C2 en Linux: chmod 600 nexo-runtime.log y que nexo-control lo cree con umask 077.
6. Trampa 17: explica a Letzus cómo dejar GRUB para que Wake-on-LAN llegue a Windows
   cuando quiera (GRUB_DEFAULT=saved + grub-reboot, o predeterminado Windows) y hazlo sólo
   si él lo pide.
7. Si todo pasa: fusiona windows-port en main (merge sin fast-forward, mensaje
   "Fusiona la migración a Windows (windows-v1)"), push, y en la carpeta en uso
   `git pull` + `npm ci` + `nexo-control restart`. Si algo falla, corrígelo en
   windows-port primero. Elimina el worktree al final.
```

---

### O1 · Opcional muy recomendada: medición remota real y TURN

```text
(Prompt para Opus 5.5, decide y ejecuta él mismo o encarga a Argon con un prompt propio.)
FASE O1 — Conexión por Internet en redes difíciles.
Contexto: el host está tras CGNAT (WIN Perú) y el celular por datos móviles también suele
estarlo. Con sólo STUN, WebRTC puede no encontrar ruta directa y NEXO cae al respaldo
JPEG por el túnel. Primero medir, después decidir.
1. Con Letzus en datos móviles: registra en /diagnostics qué transporte queda (gpu, rtc o
   fallback), el tipo de candidato ICE elegido (chrome://webrtc-internals en el celular
   si es Chrome) y FPS/RTT. Tres pruebas en momentos distintos.
2. Si cae al respaldo en alguna: propone a Letzus un TURN. Opción preferida: el TURN
   gestionado de Cloudflare (Realtime TURN) con credenciales de corta duración generadas
   por el servidor con una clave API guardada en %LOCALAPPDATA%\NEXO\state (nunca en el
   repo); revisa el precio y el cupo gratuito vigentes antes de recomendarlo. Alternativa:
   coturn propio, que NO sirve en este host por el CGNAT.
3. Implementación: el servidor entrega iceServers (STUN + TURN con usuario/credencial
   temporales) en /info; el cliente los usa en sus dos RTCPeerConnection; webrtc-host.js,
   microfono-host.js y el puente Pion (variable de entorno con JSON de iceServers) también.
   En LAN se sigue prefiriendo la ruta directa (ICE lo hace solo).
4. Repetir la medición del punto 1.
```

### O2 · Opcional: HTTPS en LAN

```text
FASE O2 — HTTPS en la red local (el micrófono por LAN lo necesita).
1. Certificado autofirmado con New-SelfSignedCertificate (SAN = IP LAN + nombre del
   equipo), exportado a PFX con contraseña aleatoria guardada en el estado privado.
2. server.js escucha HTTPS en NEXO_TLS_PORT (8443) cuando existe el PFX, además del HTTP
   sólo para 127.0.0.1 (el túnel sigue entrando por HTTP local).
3. Comprueba en Chrome Android que, aceptado el aviso, getUserMedia funciona; si no, la
   alternativa es instalar la CA en el teléfono (documentarlo) — decide con datos.
4. La cookie lleva Secure en HTTPS (ya lo hace isSecureRequest).
```

### O3 · Opcional: segunda sesión aislada en Windows (investigación)

```text
FASE O3 — Investigación, sin código de producción. Prohibido parchear termsrv.dll o usar
RDP Wrapper (viola la licencia de Windows 10/11 y se rompe con cada actualización).
Evalúa y documenta en docs/windows/O3-segunda-sesion.md, con pruebas reales:
1. Máquina virtual Hyper-V (Windows Pro) con su propio escritorio y un NEXO dentro de la
   VM (la VM puede ser Linux con el NEXO independiente actual, o Windows con licencia
   propia). Coste de GPU: sin GPU-P no hay NVENC dentro; medir la ruta CPU.
2. Windows Sandbox: desechable, sin persistencia; ¿sirve para el caso de uso?
3. Recomendación final a Letzus con pros, contras y esfuerzo. No implementes nada sin su
   decisión.
```

---

## 9. Matriz final de pruebas

| # | Prueba | Cliente | Ruta | Fase |
|---|---|---|---|---|
| 1 | Emparejar por enlace con token; la URL queda limpia | Celular | LAN | F4 |
| 2 | Emparejar por código `nexo-control pair` / bandeja | Celular | Internet | F8/F9 |
| 3 | Revocar un dispositivo y rotar el token | PC | LAN | F8 |
| 4 | Login de Mi PC; 5 fallos bloquean ese origen 15 min, no a otros | PC + celular | LAN | F2/F4 |
| 5 | Petición con cookie `%` no tumba el servidor | curl | LAN | F2 |
| 6 | Tacto MOVER: clic, scroll con inercia | Celular | LAN | F4 |
| 7 | Tacto DIRECTO: dibujar en Paint | Celular | LAN | F4 |
| 8 | Mouse de PC: arrastre, rueda, clic derecho, doble clic | PC | LAN | F4 |
| 9 | Teclado físico: ñ, acentos, emoji, texto rápido sin desorden | PC | LAN | F4 |
| 10 | Panel de teclado móvil y modo Enter | Celular | LAN | F4 |
| 11 | AltGr+tecla = Win+tecla; AltGr solo = Inicio; Win+L bloqueado | PC | LAN | F4 |
| 12 | Alt+Tab, Alt+F4, Ctrl+Shift+C/V con `nexo-super-bridge.exe` en el cliente | PC Windows | LAN | F4 |
| 13 | Escritorios 1–4, siguiente, anterior | PC | LAN | F4 |
| 14 | Cambio de monitor (izquierdo/derecho) sin renegociar | PC | LAN | F5 |
| 15 | Vídeo GPU 1080p@60 ≥ 58 FPS, 0 pérdidas | PC | LAN | F5 |
| 16 | Perfiles 720/900/1080 × 30/45/60 en caliente | Celular | LAN | F5 |
| 17 | Reposo de NVENC sin clientes y vuelta < 2 s | — | — | F5 |
| 18 | Dos clientes a la vez | PC + celular | LAN | F5 |
| 19 | Respaldo WebRTC/CPU con `NEXO_GPU=0` | PC | LAN | F6 |
| 20 | Respaldo JPEG + audio por WebSocket | PC | LAN | F6 |
| 21 | Audio del sistema 10 min, cambio de salida por defecto | Celular | LAN | F6 |
| 22 | Micrófono en Discord, también con el teléfono bloqueado | Celular | Internet | F7 |
| 23 | Página `/microfono` sola | Celular | Internet | F7 |
| 24 | Portapapeles manual en los dos sentidos | Celular | LAN | F4 |
| 25 | Subir y bajar un archivo de 90 MiB; uno de 110 MiB se rechaza | PC | LAN | F2/F4 |
| 26 | UAC o bloqueo: banner y recuperación sola | PC | LAN | F4/F5 |
| 27 | Ventana elevada controlable (NEXO elevado) | PC | LAN | F9 |
| 28 | Datos móviles: transporte, FPS y RTT anotados | Celular | Internet | F8/O1 |
| 29 | `nexo-control` completo; sin huérfanos tras stop y tras matar a lo bruto | — | — | F8 |
| 30 | Log sin token | — | — | F8 |
| 31 | Reinicio con Autologon: NEXO accesible solo, aviso del enlace recibido | Celular | Internet | F9 |
| 32 | Wake-on-LAN desde apagado hasta Windows | Celular | Internet | F9 |
| 33 | PiP y audio en segundo plano | Celular | Internet | F6 |
| 34 | `smoke.ps1` tres veces en verde | — | — | F10 |
| 35 | Linux: lista de la fase L completa | PC/celular | LAN | L |

---

## 10. Riesgos y plan B

| Riesgo | Probabilidad | Plan B |
|---|---|---|
| `@roamhq/wrtc` falla al cargar en Windows con Node 24 | Baja (hay binario `win32-x64`) | Probar Node 22 LTS; si tampoco, quitar la ruta CPU en Windows y dejar GPU + JPEG (el GPU usa Pion, no wrtc). El audio pasaría a ir por el puente Pion (añadir pista Opus al puente: fase extra). |
| Ninguna cadena de escalado GPU funciona en la versión de ffmpeg | Media | `d3d11-native` cubre el perfil por defecto (1080p en monitores 1080p); para 720p/900p, `cpu-scale`. |
| `go-wca` no compila con la versión de Go | Baja | Implementar las interfaces WASAPI mínimas a mano con `go-ole` (IMMDeviceEnumerator, IAudioClient, IAudioCaptureClient, IAudioRenderClient). |
| Los PLI son frecuentes por Wi-Fi y la imagen se rompe medio segundo | Media | Fase futura: codificador propio en el agente (Desktop Duplication + NVENC SDK o Media Foundation) que acepte "IDR ya" desde el puente. No entra en v1. |
| ICE no encuentra ruta por datos móviles (CGNAT doble) | Alta | O1 (TURN). |
| El registro de escritorios virtuales cambia en una actualización de Windows | Media | `supported:false` y sólo siguiente/anterior; la prueba 13 lo detecta. |
| Argon 4 se sale del plan en una fase | Media | `git reset --hard fN-start` y reencargo escrito por Opus. |

---

## 11. Notas posteriores a la implementación (F0–F10)

Lo que la realidad cambió respecto a las secciones anteriores. El detalle y la evidencia están
en `docs/windows/bitacora/`.

- **4.5 · URL RTP:** `rtp://127.0.0.1:PUERTO?pkt_size=1200&localaddr=127.0.0.1`. Sin `localaddr`,
  ffmpeg enlaza sus sockets UDP a `0.0.0.0` y Windows muestra el aviso de firewall (F5).
- **4.5 · Escalado en GPU:** con FFmpeg 9.0-full_build `d3d11-scale` (`Could not create the
  texture 80070057`) y `cuda-scale` (`derive_device=cuda: -40`) no funcionan en ninguna forma
  (`-i` ni `-vf`). 720p y 900p usan `cpu-scale`; 1080p en monitores 1080p va por `d3d11-native`.
- **4.6 · Archivos de estado nuevos:** `.nexo-pids.json` (`{pid, t}` por rol), `.nexo-launcher.lock`,
  `.nexo-stop` (petición de parada que vigila el lanzador), `.nexo-stopped` (parada deliberada: la
  bandeja no relanza), `.nexo-gpu-pipeline.json` (con `scaleChain`). Código nuevo común:
  `lib/lifecycle.js`, `lib/runtime-log.js`.
- **F8 · Parada:** `node launcher.js --stop` es la parada ordenada en Windows (no hay SIGTERM);
  la usan `nexo-control stop` y la bandeja. Los hijos Node también se apagan si se cierra el
  canal IPC (`disconnect`).
- **F7 · Variable:** `NEXO_MIC_DEVICE` (alias `NEXO_MIC_DEVICE_MATCH`).
- **Defectos comunes corregidos de paso (afectan a Linux, probar en la fase L):** la rotación del
  token se deshacía en el apagado (`launcher.js`); el `closed` tardío de un par viejo cerraba al
  par nuevo del micrófono (`microfono-host.js`); importaciones inexistentes que sólo fallaban en
  la primera llamada (`test/imports.test.js` lo vigila).

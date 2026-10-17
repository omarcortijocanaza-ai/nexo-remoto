# Bitácora Fase F4 — Ejecución (Argon 4)

- **Fase:** F4 · Primer control remoto real en Windows (`platform/windows` funcional salvo vídeo GPU, audio y micrófono)
- **Rama:** `windows-port`
- **Etiqueta de inicio:** `f4-start` (`0fbef7d`)
- **Fecha:** 2026-10-16

---

## 1. Archivos creados o modificados

- `platform/windows/agent-client.js`: cliente JSON-lines para `bin\win\nexo-agent.exe serve` (ruta configurable con `NEXO_AGENT_PATH`), espera del evento inicial `ready` (timeout 5 s), `call(op, params)` con `id` incremental y timeout de 2 s por petición, rechazo inmediato de peticiones pendientes si el agente muere, relanzado automático con espera creciente (`0,5 s → 8 s`), emisión de eventos (`desktop`, `desktop-state`, `displays-changed`), `.unref()` cuando está en reposo para no retener procesos de pruebas unitarias, y apagado limpio (`stdin.end()` + `kill()` / `taskkill /T /F` tras 1 s) sin dejar procesos huérfanos.
- `platform/windows/keymap.js`: módulo puro sin dependencias de Windows según la sección 4.3, exportando `codeToScan`, `named`, `combo`, `shortcut` e `isBlocked`. Incluye tabla completa de scan codes del conjunto 1, teclas con nombre (`redo` = `Ctrl+Y`), combinaciones en orden `Ctrl, Alt, Shift, Win` con liberación en orden inverso, `meta+Space` = toque de `Win` sola y bloqueo de `Win+L` (`Atajo no disponible en remoto: Win+L`) más `NEXO_BLOCKED_SHORTCUTS`.
- `platform/windows/ffmpeg.js`: localización de `ffmpeg.exe` (`findFfmpeg`), argumentos de captura continua (`jpegStreamArgs`) e instantánea (`screenshotArgs`) con `ddagrab` + `hwdownload,format=bgra` + `mjpeg`, y clase `JpegSplitter` (`stream.Transform` que emite un `Buffer` por cada JPEG completo `FF D8 … FF D9` tolerando fragmentos partidos en cualquier byte).
- `platform/windows/index.js`: implementación del contrato de plataforma Windows para F4:
  - `listMonitors` → op `monitors` conservando `index` para `ffmpeg`.
  - `pointer(data, monitor)` → `x = monitor.x + round(x·(width−1))`, `y = monitor.y + round(y·(height−1))`; `tap → click`, `down/dragstart → down`, `up → up`, `move → move`; `button: 'right' | 'left'`.
  - `scroll(data, monitor)` → op `scroll` con las mismas coordenadas.
  - `text`, `namedKey`, `keyEvent`, `shortcut` según 4.3, serializados en una cola de entrada para preservar el orden exacto (un clic o tecla posterior a `text` espera en la cola a que termine la entrega del texto).
  - Detección de UIPI (`foreground`): si la ventana en primer plano está elevada y NEXO no, registra un aviso claro indicando el ejecutable/título sin inundar el registro por el mismo PID.
  - `workspace` → `desktop.switch`; `clipboardGet` / `clipboardSet`.
  - `screenshotJpeg` → `ffmpeg` de un cuadro; `startJpegStream` → un único `ffmpeg` persistente compartido por monitor con pausa automática en escritorio `secure` (`Win+L`/UAC), relanzado con espera creciente (`1 s → 5 s`) si muere y apagado limpio con `taskkill /T /F` tras 1 s.
  - `keepAwake` → op `keepawake`; `on` → eventos del agente (`desktop-state` con `'normal'|'secure'` y `displays-changed`).
  - `spawnSystemAudio` y `spawnRawVideo` mantienen el error explícito de fase F6.
- `test/keymap-windows.test.js`, `test/jpeg-splitter.test.js`, `test/agent-client.test.js`: suite de pruebas unitarias para `keymap`, `JpegSplitter` y `agent-client` (con agente simulado en Node).
- `server.js` (puntos 6 y 7):
  - En `/session-options`, cuando `platform.capabilities.independentSession` es `false`, responde `{ kind:'shared', chooser:true, original:{name:'Mi PC'}, alternative:{ available:false, supported:false, name:'NEXO', url:'' } }`.
  - Suscribe `platform.on('desktop-state')` y notifica a los clientes con `rtcHost.notify({ type:'secure-desktop', active: state === 'secure' })` (y por `/live` si sólo hay visor JPEG).
  - Activa `platform.keepAwake(true)` cuando hay al menos un cliente (par WebRTC, espectador JPEG o WebSocket de audio) y `keepAwake(false)` 60 s después de quedarse sin clientes.
  - Añade `server.platform = platform.name` en `/diagnostics` y `/diagnostics/export`.
- `index.html` (punto 8):
  - Oculta la tarjeta `#choose-nexo` cuando `options.alternative?.supported === false` manteniendo el portal para login y las tarjetas de "Mi PC" y "Sólo micrófono".
  - Muestra el banner fijo de pantalla protegida al recibir `{ type:'secure-desktop', active:true }` y lo oculta con `active:false`.
  - Mantiene el flujo JPEG de respaldo si la pista WebRTC aún no tiene dimensiones de vídeo (`videoWidth === 0`).
- `docs/windows/bitacora/F4-argon.md`: esta bitácora.

---

## 2. Verificaciones ejecutadas y salidas reales

### 2.1 `npm test`

```text
PS D:\nexo-remoto> npm test

> nexo-remote-surface@1.0.0 test
> node --test

✔ agent-client: espera ready, call(op, params), evento desktop-state y cierre limpio por stdin EOF (66.5285ms)
✔ agent-client: rechaza pendientes si el agente muere, relanza con backoff y aplica timeout de 2 s (2616.5877ms)
✔ auth: creates and verifies password (85.6295ms)
✔ auth: creates challenges and sessions (85.8147ms)
✔ auth: rate limits failed attempts (334.6161ms)
✔ devices: pairs with main token and creates persistent cookie (1.6968ms)
✔ devices: pairs with temporary code only once (87.4864ms)
✔ devices: revokes and lists devices (86.4535ms)
✔ devices: sliding renewal extends cookie expiration on validateDeviceCookie (98.9721ms)
✔ JpegSplitter: extrae un JPEG partido de 1 en 1 byte e ignora basura previa/intermedia (2.3711ms)
✔ JpegSplitter: extrae un JPEG partido en 3 trozos (0.3719ms)
✔ JpegSplitter: extrae dos JPEGs completos entregados en un solo trozo (0.2815ms)
✔ keyboard: translates common special keys (0.9964ms)
✔ keyboard: translates chords safely (0.432ms)
✔ keyboard: translates shift combos and printable keys (1.0315ms)
✔ keyboard: translates Super combos for Hyprland and leaves Alt+Tab for the server (0.2337ms)
✔ keyboard: ignores modifier-only presses and repeats on chords (0.3177ms)
✔ keymap-windows: verifica todos los códigos de la tabla de la sección 4.3 (1.1322ms)
✔ keymap-windows: named keys incluye flechas, F1-F12, clipboard y redo = Ctrl+Y (0.5256ms)
✔ keymap-windows: combo respeta orden Ctrl, Alt, Shift, Win al pulsar y orden inverso al soltar (0.3514ms)
✔ keymap-windows: AltGr ya convertido a meta, meta+Space = toque de Win, Win+L bloqueado (0.7131ms)
✔ keymap-windows: NEXO_BLOCKED_SHORTCUTS permite bloquear atajos adicionales por entorno (0.4539ms)
✔ platform/index selecciona el adaptador del SO actual y expone la interfaz completa (3.857ms)
✔ platform/linux exporta todas las funciones y capacidades del contrato 4.1 (0.4945ms)
✔ platform/windows exporta todas las funciones y capacidades del contrato 4.1 (0.2966ms)
✔ lib/paths resuelve directorios y asegura permisos (1.7975ms)
✔ lib/proc exporta runFixed, spawnChecked y killTree (0.3766ms)
✔ safe: atomicWriteJson writes valid JSON and cleans up tmp file (3.4455ms)
✔ safe: atomicWriteJson serializes 20 concurrent writes without corruption or leftover .tmp files (17.5305ms)
✔ safe: readJsonSafe returns fallback when primary is missing and recovers from .bak when corrupt (2.0604ms)
✔ server HTTP/WS: /healthz, /auth/login, /files Range, /gpu-webrtc proxy filter, WS /live (1657.624ms)
✔ server HTTP: rate-limit global returns 429 on burst > 120 req / 10 s for unauthenticated IP (57.3452ms)
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2448.1334
```

### 2.2 Verificación integral en vivo (`server.js` con `NEXO_GPU=0`, `NEXO_MODE=local`)

```text
=== 1. ARRANCANDO SERVER.JS EN PUERTO 54729 (NEXO_GPU=0, NEXO_MODE=local) ===
URL LOCAL de prueba: http://127.0.0.1:54729/?token=***
2) /session-options: {"kind":"shared","chooser":true,"original":{"name":"Mi PC"},"alternative":{"available":false,"supported":false,"name":"NEXO","url":""}}
3) /diagnostics server: {"uptimeMs":146,"sessionKind":"shared","gpuEnabled":false,"platform":"windows"}
4) /screen JPEG instantáneo: 83613 bytes (SOI=FFD8, EOI=FFD9)
5) /live WebSocket JPEG: 5 cuadros recibidos, tamaños=[64917,64907,53781,53768,53777] bytes
6) Bloqueo de Win+L (AltGr+L): HTTP 500 -> {"error":"Atajo no disponible en remoto: Win+L"}
7) Portapapeles HTTP (/clipboard): OK ("Prueba portapapeles F4 ñandú áéíóú ¿?")
8) Puntero (move, tap, right tap, dragstart/move/up) y rueda (/scroll): HTTP 200 OK
9) Monitores en /info: \\.\DISPLAY1, \\.\DISPLAY2 (activo=\\.\DISPLAY1)
   Cambiado a \\.\DISPLAY2 -> HTTP 200
   Restaurado a \\.\DISPLAY1 -> HTTP 200
10) Escritorios virtuales (/workspace 2, 1, next, previous): HTTP 200 OK
11) Procesos residuales tras cerrar server.js: ninguno (limpio)
```

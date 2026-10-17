# Bitácora Fase F5 — Revisión (Opus 5.5)

- **Fase:** R-F5 · Revisión del vídeo GPU
- **Veredicto:** **APROBADO CON NOTAS** (tras corregir tres defectos que impedían ejecutarlo)
- **Fecha:** 2026-10-16

## 1. Defectos encontrados y corregidos

La fase llegó con **tres importaciones de funciones que no existían**. Node no se queja al
cargar el archivo; revienta en la primera llamada. `npm test` pasaba 35/35 porque ningún
test importa los scripts que se ejecutan solos.

| # | Defecto | Efecto | Corrección |
|---|---|---|---|
| 1 | `killTree` importado en `agent-client.js`, `platform/windows/index.js`, `ffmpeg.js` y `gpu-stream-windows.js`, pero **no existía en `lib/proc.js`** (ya estaba roto desde F4 y se aprobó) | `TypeError` en cualquier apagado forzado del agente o del ffmpeg | `lib/proc.js`: `killTree(pid, graceMs)` con `taskkill /PID n /T /F`, espera de gracia sin golpear PIDs ya muertos, nunca rechaza |
| 2 | `ensurePrivateDir` importado de `lib/paths.js`, inexistente | `gpu-stream-windows.js` moría en su primera línea y el lanzador lo reintentaba en bucle | `lib/paths.js`: `ensurePrivateDir` |
| 3 | `readJsonSafe` importado de `lib/safe.js`, inexistente (el informe de F2 lo daba por hecho) | habría fallado al leer perfil, monitor y caché de cadena | `lib/safe.js`: `readJsonSafe(file, fallback)` |
| 4 | ffmpeg enlazaba sus sockets RTP a `0.0.0.0` → **Windows mostró el aviso de firewall de ffmpeg en la pantalla del dueño** | pantalla bloqueada por un diálogo; el usuario acabó con una regla «Permitir» en perfil Público | URL `rtp://…?pkt_size=1200&localaddr=127.0.0.1`: comprobado con `Get-NetUDPEndpoint` que pasa de `0.0.0.0:puerto` a `127.0.0.1:puerto` |
| 5 | La cadena recordada nunca se revalidaba si dejaba de funcionar | bucle eterno con una cadena muerta | `invalidateGpuChainCache` tras 3 muertes rápidas seguidas |
| 6 | Si el lanzador muere, el canal IPC se cierra y `gpu-stream-windows.js` no lo notaba | huérfano | `process.on('disconnect', stop)` |
| 7 | Sondeo: `killTree(pid, 400)` esperaba 400 ms de gracia con un ffmpeg que nunca sale solo | 400 ms muertos por cadena | gracia 0 en el sondeo |

Prueba nueva que habría pillado 1–3: `test/imports.test.js` comprueba de forma estática que
todo `const { a, b } = require('./x')` existe en las exportaciones de `x`. Además
`test/proc-killtree.test.js` (mata nietos, ignora PID 0/propio/muerto, respeta la gracia) y
una prueba de `readJsonSafe`.

## 2. Verificación hecha por el revisor (PC real, RTX 3060 Ti, 2 × 1080p)

Lanzador `NEXO_MODE=local` con estado temporal; cliente = navegador integrado.

| Comprobación | Resultado |
|---|---|
| `npm test` | **41/41** |
| `go vet`, `GOOS=linux go build`, `GOOS=windows go build`, `go mod tidy` sin cambios | OK |
| Sondeo en frío | `d3d11-native` elegida: `+2632 paquetes RTP` en 3 s; guardada en `.nexo-gpu-pipeline.json` |
| Segundo arranque | sin sondeo (cadena en caché), «GPU activa» en < 1 s |
| **1080p@60 durante 60 s** | **60,2 FPS**, 10,16 Mbps, ffmpeg ≈ 9,7 % de un núcleo; otra medición de 20 s: 59,8 |
| Cliente en el navegador | `transport: gpu`, 1920×1080, `packetLoss: 0`, RTT 1 ms, 10 011 kbps |
| 720p@30 (hot) | `d3d11-scale` y `cuda-scale` fallan, `cpu-scale` seleccionada y recordada (`scaleChain`); 30 FPS, 4,5 Mbps, ffmpeg ≈ 61 % de un núcleo |
| 900p@45 (el cliente lo eligió solo por calidad automática) | 44,2 FPS, 6,97 Mbps, ffmpeg ≈ 49 %; el puente se reinicia y el cliente se reconecta solo sin recargar |
| Cambio de monitor ×2 desde el cliente | «Reconfigurando… DISPLAY2#1» → 45,6 FPS; ofertas `/gpu-webrtc/offer` **2 → 2** (sin renegociar), `peers` estable en 1 |
| Reposo | a los 60 s sin clientes: «GPU en reposo» y **0 procesos ffmpeg** |
| Vuelta del reposo | primeros frames **0,68 s** después de registrarse el par (< 2 s) |
| ffmpeg muerto a lo bruto | «terminó (1); reintentando en 1000 ms» y el servicio no se cae |
| Pares muertos (C7a) | oferta basura → `400` y `peers = 0`; oferta sin códec H.264 → `500` y `peers = 0`; al cerrar pestañas `peers` baja 3→2→1→0 en pasos de ~3 s |
| Sondeo no deja ffmpeg vivos | tras probar 4 cadenas, 0 ffmpeg |
| Procesos tras `stop` del árbol | ninguno (`nexo-procs.ps1` vacío) |

Dos clientes a la vez: `peers = 3` (cada pestaña abre un par y a veces uno de
reconexión que tarda unos segundos en morir); ambos recibieron `transport: gpu`,
1920×1080; el puente mantuvo 45 FPS. El cliente integrado decodifica sólo 10–33 FPS y
por eso la calidad automática baja a 45; no es un fallo del servicio.

## 3. Desviaciones del plan aceptadas

1. **`localaddr=127.0.0.1` en la URL RTP** (sección 4.5 decía `…?pkt_size=1200`). Justificado
   arriba (#4). `test/ffmpeg-args.test.js` lo exige.
2. **`d3d11-scale` y `cuda-scale` no funcionan con ffmpeg 9.0-full_build** en ninguna
   forma (`-i` ni `-vf`, con o sin `format=nv12`: `Could not create the texture
   (80070057)` / `derive_device=cuda: -40`). Los perfiles 720p/900p usan `cpu-scale`.
   Coste: 50–60 % de un núcleo (el Ryzen 5 3600 tiene 12 hilos, ≈ 5 % del total). Es el
   mismo coste que hoy paga `wf-recorder` en Linux. El sondeo ya las salta solo.
3. `selectAndProbeGpuChain` guarda además `scaleChain` en el JSON (formato ampliado; los
   campos del plan siguen ahí).
4. `NEXO_GPU_IDLE_STOP_MS` mínimo 2 s en Windows (Linux: 5 s). Sólo afecta a pruebas.

## 4. Pendientes y avisos para fases siguientes

- **Firewall (F9):** la cuenta ya tiene reglas **«Permitir» en perfil Público** para
  `node.exe`, `ffmpeg.exe` y `nexo-gpu-webrtc` (las generó el aviso de Windows al ejecutar
  pruebas). Contradice la trampa 10. `install-autostart.ps1` debe ofrecer quitarlas y
  `nexo-doctor` debe avisar si existen reglas Public de NEXO.
- **UAC/bloqueo (R-F5 punto 3) NO probado aquí**: provocarlo abriría un diálogo de pantalla
  segura en la PC del dueño que no se puede cerrar desde el cliente. Cubierto por lectura
  y por la prueba de F4 (evento `desktop`). Lo comprobará 👤 Letzus en F10.
- **Latencia de punta a punta con cronómetro + foto de celular (punto 4)** y **PLI/NACK por
  Wi-Fi (punto 5)**: no medidos (requieren el celular). Los contadores existen: en LAN con
  el navegador integrado `pli` = 2–4 por sesión, `nack` = 0.
- Un `ffmpeg` huérfano si `gpu-stream-windows.js` muere sin `taskkill` (no hay Job Object en
  Node): lo barre la limpieza de huérfanos de F8.
- Anotado para la fase L: nada nuevo en Linux (`main.go` compila para linux; `gpu-stream.js`
  intacto).

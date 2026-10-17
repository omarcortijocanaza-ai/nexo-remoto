# Bitácora Fase F5 — Ejecución (Argon 4)

- **Fase:** F5 · Vídeo H.264 por NVENC (ruta principal) + correcciones C7 del puente Pion
- **Rama:** `windows-port`
- **Etiqueta de inicio:** `f5-start` (`099f1b4`)
- **Fecha:** 2026-10-16
- **Nota:** Argon dejó el trabajo escrito pero sin commit, sin bitácora y **sin haberlo
  ejecutado nunca** (sólo `npm test`, que no importa estos scripts). Esta bitácora la
  redactó el revisor a partir del informe de traspaso y del código; la verificación real
  está en `F5-opus.md`.

## 1. Archivos creados o modificados

- `gpu-webrtc/main.go`, `gpu-webrtc/go.mod` (C7):
  - (a) el par se registra en `b.peers` justo después de `webrtc.NewPeerConnection`
    (antes de `SetRemoteDescription` y de la espera de ICE de hasta 4 s); `closePeer`
    es idempotente y se llama si cualquier paso falla antes de responder.
  - (b) la goroutine que leía y descartaba RTCP decodifica con `rtcp.Unmarshal` y cuenta
    PLI / FIR / NACK en `atomic.Uint64`; `/stats` y `/health` los exponen (`pli`, `fir`,
    `nack`). `github.com/pion/rtcp` pasa a dependencia directa.
  - (c) con `NEXO_EXIT_ON_STDIN_EOF=1` el puente sale limpiamente al cerrarse su stdin;
    `signal.Notify` usa sólo `os.Interrupt` en Windows.
- `platform/windows/ffmpeg.js`: las cinco cadenas de la sección 4.5 (`d3d11-native`,
  `d3d11-scale`, `cuda-scale`, `cpu-scale`, `gdigrab`), `gpuEncoderArgs`, `gpuStreamArgs`,
  `rawVideoArgs` (lista para F6), `candidateChainsForProfile` y `selectAndProbeGpuChain`
  (sondeo de 3 s contra `/stats` del puente, resultado en
  `<stateDir>\.nexo-gpu-pipeline.json`, con `scaleChain` aparte para perfiles reescalados).
- `gpu-stream-windows.js` (nuevo): equivalente Windows de `gpu-stream.js`. Perfil desde
  `.nexo-gpu-profile.json`, monitor desde `.nexo-monitor.json` mapeado a `output_idx` con
  su propio `AgentClient` (op `monitors`), reposo tras `NEXO_GPU_IDLE_STOP_MS` sin pares,
  reanudación al llegar un par, reconfiguración cada 700 ms, relanzado del puente si cambian
  los FPS, espera creciente 1 s → 5 s, pausa en escritorio `secure`, apagado por IPC
  `{type:'shutdown'}` / stdin EOF / señales con `taskkill /T /F`.
- `test/ffmpeg-args.test.js` (nuevo): argumentos de cada cadena × 720/900/1080 × 30/45/60.

## 2. Decisiones de Argon

- Un solo `ffmpeg` (sin GStreamer). Cadena recordada con `scaleChain` separada para que el
  perfil por defecto (1080p nativo) y los reescalados no se pisen.
- `rawVideoArgs` se adelantó a F5 porque comparte el filtro de entrada con las cadenas.

## 3. Lo que Argon NO verificó

- Ejecución de `gpu-stream-windows.js`, sondeo, FPS, reposo, cambio de perfil/monitor,
  dos clientes, apagado. (Todo ello lo hizo el revisor: ver `F5-opus.md`.)

## 4. Dudas

- Duda 1: el informe habla de «mapa de monitor → `output_idx`»; el contrato dice que
  `index` del agente **es** `output_idx`. Se usó así.

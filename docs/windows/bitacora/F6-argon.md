# Bitácora Fase F6 — Ejecución

- **Fase:** F6 · Audio del sistema y respaldo WebRTC/CPU en Windows
- **Rama:** `windows-port` · **Inicio:** `f6-start` (`0527639`)
- **Quién:** esta fase la ejecutó directamente Claude (revisor), por encargo de Letzus de
  terminar F5–F10 de una vez; Argon 4 no llegó a ella.

## 1. Archivos

- `platform/windows/index.js`
  - `spawnSystemAudio()` → `nexo-agent.exe audio-loopback --rate 48000 --channels 2`,
    `stdio ['pipe','pipe','pipe']` (stdin abierto a propósito: si Node muere el agente sale).
  - `spawnRawVideo({ monitor, width, height, fps })` → `superviseRawVideo` con la cadena
    «Vídeo CPU» (`rawVideoArgs`), dimensiones redondeadas a par, `frameBytes = w·h·3/2`.
  - `defaultAudioTarget()` → `nexo-agent.exe audio-devices`, nombre del dispositivo
    `default` de salida (o `''`; sólo informativo).
- `platform/windows/ffmpeg.js`: `FrameAligner` (sólo deja pasar cuadros enteros) y
  `superviseRawVideo` (ver §2). `rawVideoArgs` ya la había añadido F5.
- `platform/windows/agent-client.js`: `agentCommand(subArgs)` (ruta del agente + admite
  un `.js` falso para pruebas). Lo reutilizará F7.
- `test/raw-video-supervisor.test.js` (nuevo): argumentos del vídeo CPU, reagrupador,
  reagrupado por ejecución, pausa en escritorio seguro, espera creciente y no relanzar
  tras `kill()`, `agentCommand`.

## 2. Decisión no prevista por el plan: supervisor del vídeo CPU

El plan pedía devolver `{ child, stream: child.stdout }`. Pero `webrtc-host.js` reintenta
**cada 350 ms** si el hijo muere, y con `ddagrab` eso ocurre a menudo en Windows (UAC,
bloqueo, cambio de resolución → `DXGI_ERROR_ACCESS_LOST`): bucle de reinicios e
inundación del registro, que la trampa 6 prohíbe. Además, si un ffmpeg muere a mitad de
cuadro y el siguiente escribe sobre el mismo flujo, `webrtc-host.js` queda desfasado para
siempre. Por eso `spawnRawVideo` devuelve un hijo *lógico*:

- espera creciente 1 s → 5 s (se reinicia a 1 s si el proceso vivió > 10 s);
- en escritorio `secure` no lanza nada, mata el ffmpeg vivo y retoma con el evento `normal`;
- un `FrameAligner` por ejecución: los cuadros parciales se descartan al morir ffmpeg;
- un registro cada 30 s como máximo;
- `kill()` mata el árbol (`taskkill /T`) y no relanza.

`webrtc-host.js` **no se tocó**: el supervisor sólo ofrece lo que usa (`stderr`,
`on('error'|'close')`, `kill()`).

## 3. Dudas

- `latencyMs` y `target` del contrato se ignoran en Windows (el agente fija 10 ms de
  bloque y sigue al dispositivo por defecto).

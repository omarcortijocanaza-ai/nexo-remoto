# Bitácora Fase F6 — Revisión

- **Veredicto:** **APROBADO CON NOTAS**
- **Entorno:** PC real (RTX 3060 Ti, 2 × 1080p, salida por defecto = auriculares Bluetooth
  «soundcore Liberty 4 NC»), lanzador `NEXO_MODE=local` con estado temporal, cliente =
  navegador integrado. El dueño estaba jugando mientras tanto (se capturó su partida).
- `npm test`: **47/47** (3 ejecuciones seguidas). Se endurecieron las pruebas del
  supervisor: la primera versión fallaba bajo carga por esperas fijas.

## 1. Verificación

| Comprobación | Resultado |
|---|---|
| `NEXO_GPU=0`: vídeo por WebRTC CPU | `transport: rtc`, 1920×1080, `captureFps` 58–59, ~2,3 Mbps; el cliente integrado decodifica ≈ 22 FPS, 0 descartados. La cabecera no dice GPU |
| Audio por WebRTC (CPU) con un tono de 440 Hz en el host | `totalAudioEnergy` 0,0018 → 0,052 en 6 s; 0 paquetes perdidos |
| **Deriva del audio en 45 s** | **47 999 muestras/s** (nominal 48 000), 0 enmascaradas, 0 aceleradas/ralentizadas, buffer de jitter 40 ms |
| GPU + audio a la vez | `transport: gpu`; energía de audio 0,003 → 0,22 con un tono; sólo **un** `ffmpeg` vivo (el del servicio GPU, hijo de `gpu-stream-windows.js`); el de vídeo CPU no existe |
| Ruta JPEG + audio (WebSocket `/audio-live`, el mismo que usa el cliente en respaldo) | 185 892 B/s (esperado 192 000; incluye el arranque), primer paquete a 197 ms; con tono RMS 3 678 |
| Cerrar el cliente | `audio-loopback` muere a los ≈ 11 s (ICE desconectado + 1,2 s de gracia) |
| **Matar `server.js` a lo bruto** con audio abierto | `nexo-agent serve` y `audio-loopback` del servidor mueren solos (stdin EOF); 0 huérfanos |
| `defaultAudioTarget()` | devuelve el nombre del dispositivo por defecto |
| Pruebas unitarias del supervisor | reagrupado por ejecución, secure, espera creciente, `kill()` |

## 2. NO probado (y por qué)

- **Sincronía A/V con vídeo de claqueta, cambio de salida por defecto parlantes ↔
  auriculares con el cliente oyendo, silencio de 5 min y 10 min de audio** (R-F6 puntos
  1–3 y verificación de 10 min): cambiar la salida por defecto es modificar la
  configuración de sonido del dueño mientras juega, y el equipo nunca estuvo en silencio
  (RMS ≈ 6 500 por el juego), así que tampoco se pudo aislar el relleno de silencio. El
  agente ya lo cubre en F3 (`audio_loopback.go`: silencio a ritmo real, sigue al
  dispositivo por defecto). 👤 Letzus: 10 min de audio desde el celular y cambiar salida.
- **Reglas de firewall para forzar el respaldo JPEG:** no se tocan (configuración del
  sistema). Se probó el mismo endpoint `/audio-live` directamente.
- Un `audio-loopback` sin ningún dispositivo de salida: no hay forma de simularlo aquí; el
  servidor lo reintenta cada 250 ms (`startAudioCapture`, común con Linux).

## 3. Pendientes

- Para la fase F10: ver con el celular el vídeo CPU (WebRTC) a 720p, que es el que usará
  quien no tenga NVENC.

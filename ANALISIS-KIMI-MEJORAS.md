# Análisis de Kimi sobre el proyecto NEXO (teclado-remoto) y posibles mejoras/parches

> Auditoría técnica realizada el 2026-08-19 sobre el código en `~/Downloads/teclado-remoto`.
> Este documento es **solo análisis**: no se ha modificado ningún archivo del proyecto.
> Está pensado para ser evaluado antes de decidir qué parches aplicar.

---

## 1. Opinión general de la implementación

NEXO no es un "teclado remoto" simple: es un **sistema de escritorio remoto completo** (video + audio + input) para un host Linux con Hyprland/Wayland, con cliente web para móvil/PC. Mi valoración global:

**Es un proyecto sorprendentemente maduro para ser "casero".** Tiene decisiones de ingeniería serias que muchos proyectos comerciales pequeños no tienen:

- **Pipeline de streaming por GPU bien diseñado**: NVENC con `zerolatency`, GOP corto, SPS/PPS repetidos en cada IDR, y una sola codificación compartida entre N clientes gracias al puente Go/Pion que renumera secuencias RTP (`gpu-webrtc/main.go:79-99`). Elegante y eficiente.
- **Tres rutas de video con degradación elegante**: GPU/NVENC → CPU/VP8 (wrtc) → JPEG/WebSocket. Si WebRTC falla, el usuario sigue viendo algo.
- **Canales de input diferenciados**: canal `control` fiable/ordenado para teclas y clics, canal `motion` sin retransmisiones para movimiento de ratón (`index.html`). Es exactamente lo correcto.
- **Seguridad de aplicación bien pensada**: scrypt para contraseñas, cookies de dispositivo revocables almacenadas como hash, comparación con `timingSafeEqual`, rate limiting, códigos de emparejamiento de un solo uso, permisos 0600/0700 en estado, CSP, límites de tamaño en uploads.
- **Documentación ejemplar y honesta** (README + 9 documentos vigentes, con tabla de vigencia), y comentarios en el código que explican el _porqué_ de cada workaround.

**Las debilidades principales** son cuatro: HTTP plano en LAN, el token impreso en logs, el fallback JPEG extremadamente costoso (un proceso `grim` por frame), y la serialización global del input con sleeps e IPCs redundantes. Todas son corregibles con parches acotados.

---

## 2. Análisis de latencia / tiempo de respuesta

### Lo que ya está bien

- Jitter buffer del cliente a 0 (`index.html`), NVENC en modo ultralow-latency, GOP = fps/2.
- `socket.setNoDelay(true)` (`server.js:1435`), descarte de movimientos de ratón obsoletos (`pendingPointerMove`, `server.js:773`).
- `sync=true` en el udpsink de GStreamer para evitar ráfagas (`gpu-stream.js:123`).

### Cuellos de botella concretos (ordenados por impacto)

1. **Fallback JPEG muy costoso** (`server.js:612-630`): se lanza un proceso `grim` nuevo **por cada frame**, más un `setTimeout(25)` fijo entre frames. Con el RTT de un túnel, el video de respaldo cae a fps de un dígito. Es la ruta que verán las redes que bloquean UDP — justo los usuarios que más necesitan fluidez.

2. **Input serializado globalmente** (`server.js:35,301`): toda la entrada pasa por una única cola de promesas. Cada clic hace **3-5 llamadas IPC a Hyprland** (`server.js:674-767`) y, si hay rofi abierto, un `pkill` + **sleep de 35 ms** (`server.js:726-727`). Un clic con foco puede costar 30-80 ms, y los movimientos de ratón que llegan detrás esperan.

3. **Scroll mueve el puntero primero** (`server.js:812-829`): `pumpScroll` ejecuta un `pointerAction('move')` (IPC completo) antes de lanzar `wlrctl pointer scroll` como proceso nuevo por ráfaga.

4. **Agrupación de tecleo de 30 ms** (`server.js:501,505-513`): retrasa intencionadamente cada ráfaga de texto. Además, en la vía Chromium cada carácter "no seguro" implica `wl-copy` + verificación con hasta 3×15 ms + Ctrl+V (`server.js:483-490`).

5. **Un proceso nuevo por evento**: `wtype`, `xdotool`, `wlrctl` se lanzan con spawn por evento (`server.js:293`, `entrada-x11.js:22-29`): ~5-15 ms por spawn. En X11 además `--delay 12` por tecla (`entrada-x11.js:37`).

6. **`activeWindowIsChromium()` inspecciona `/proc`** (`server.js:369-405`) antes de cada entrega de texto — lecturas de disco en el camino crítico.

7. **Heartbeat WS de 30 s** (`server.js:42-51`): puede tardar hasta 60 s en detectar un socket muerto.

### Parches propuestos (latencia)

| #   | Parche                                                                                                  | Archivo:línea                            | Impacto estimado                   |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| L1  | Eliminar o hacer no bloqueante el `sleep(35)` tras `pkill rofi`                                         | `server.js:726-727`                      | -35 ms por clic afectado           |
| L2  | Mantener procesos persistentes `wtype`/`wlrctl`/`xdotool` (escribir a stdin) en vez de spawn por evento | `server.js:293,824`, `entrada-x11.js:22` | -5 a -15 ms por evento             |
| L3  | Cachear `activeWindowIsChromium()` durante 2-3 s                                                        | `server.js:369-405`                      | -2 a -10 ms por tecla              |
| L4  | Enviar el primer carácter de inmediato y agrupar solo el resto (o bajar `NEXO_AGRUPAR_MS`)              | `server.js:501`                          | -30 ms al empezar a escribir       |
| L5  | En scroll, saltar el `pointerAction('move')` si la posición no cambió                                   | `server.js:819`                          | -1 IPC por ráfaga                  |
| L6  | Heartbeat WS a 10-15 s                                                                                  | `server.js:42`                           | Detección de caída 2-4× más rápida |

---

## 3. Análisis de calidad de video

### Estado actual

- Ruta GPU: H.264 High, perfiles 720p/900p/1080p × 30/45/60 fps, CBR 4.5/7/10 Mbps (`gpu-stream.js:174-201`).
- Ruta CPU: VP8 vía `@roamhq/wrtc`, frames I420 crudos (`webrtc-host.js:197-249`).
- El puente Pion renumera secuencias/timestamps para sobrevivir cambios de monitor/perfil sin renegociar — muy buena solución.

### Huecos detectados

1. **No hay respuesta a pérdida de paquetes**: el receptor RTCP del puente se drena pero **no se traduce a IDR** (`gpu-webrtc/main.go:139-146`). Con pérdida real (WiFi, túnel congestionado), la imagen se corrompe hasta el siguiente IDR (~0.5 s). Competidores como Parsec/AnyDesk responden a PLI/FIR forzando keyframe inmediato. **Este es probablemente el parche de mayor impacto percibido.**
2. **Sin bitrate adaptativo real**: la "calidad automática" solo cambia de perfil, no ajusta `-b` en caliente. NVENC lo soporta sin reiniciar el encoder.
3. **VBV muy pequeño** (`bufsize ≈ bitrate/30`, `gpu-stream.js:156`): bueno para latencia, pero degrada texto en cambios bruscos de contenido. Compensación razonable, pero podría ser dinámico.
4. **Escalado `fast_bilinear`** (`gpu-stream.js:152,184`): velocidad sobre nitidez; en texto se nota. `bilinear` cuesta poco más.
5. **Solo STUN, sin TURN** (`webrtc-host.js:73`): en redes que bloquean UDP (redes corporativas, CGNAT estricto) WebRTC falla y se cae al costoso fallback JPEG. Un TURN opcional aumentaría mucho la tasa de éxito.

### Parches propuestos (video)

| #   | Parche                                                                                                     | Archivo:línea                                          |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| V1  | Responder a RTCP PLI/FIR forzando IDR en NVENC (hoy se drena)                                              | `gpu-webrtc/main.go:139-146` + señal a `gpu-stream.js` |
| V2  | Bitrate adaptativo en caliente según estadísticas del peer (loss/RTT)                                      | `gpu-stream.js`, puente Go                             |
| V3  | Fallback JPEG: captura persistente (`wf-recorder` MJPEG) en vez de `grim` por frame; quitar sleep de 25 ms | `server.js:617,627`                                    |
| V4  | `scaler=bilinear` en lugar de `fast_bilinear` (medir coste GPU)                                            | `gpu-stream.js:152,184`                                |
| V5  | Soporte TURN opcional (coturn propio o servicio)                                                           | `webrtc-host.js:73`, config                            |

---

## 4. Seguridad

### Fortalezas (ya cubiertas)

Token de un solo uso canjeado por cookie revocable con 302 para sacarlo de la URL (`server.js:1087-1098`); scrypt con salt; bloqueo 15 min tras 5 fallos; códigos de emparejamiento sin ambigüedad; `timingSafeEqual`; límites de tamaño; `safeFileName` anti path traversal; CSP; DTLS-SRTP en WebRTC; puente GPU solo en localhost. Sin secretos hardcodeados en el código.

### Debilidades (prioridad alta)

1. **LAN en HTTP plano** — `launcher.js:70`: en modo `local`/`both` el servidor escucha `0.0.0.0:8765` sin TLS. Token, códigos de emparejamiento, contraseña, cookies y el video JPEG viajan **en claro por la red local**. Cualquiera en la LAN (cafetería, oficina, WiFi compartido) puede capturar la cookie y controlar el PC.
2. **El token se imprime en el log** — `server.js:1471` (`TOKEN=...` a stdout, persistido en `nexo-runtime.log`, que además no rota y ya pesa 1,2 MB).
3. **WebSocket implementado a mano** (`server.js:632-646,1441-1446`): sin validación de máscara, fragmentación ni límites de frame. Funciona con sus clientes, pero es superficie de ataque innecesaria. La librería `ws` lo resuelve.
4. **Binarios precompilados sin verificación**: `bin/cloudflared`, `bin/nexo-gpu-webrtc`, y `windows-helper/dist/nexo-super-bridge.exe` (que se descarga desde el propio servidor, `server.js:1241-1255`) sin hashes ni firmas.
5. Proxy genérico `/gpu-webrtc/*` (`server.js:1308-1321`) — mitigado porque el puente solo expone rutas seguras en localhost, pero convendría lista blanca.

### Parches propuestos (seguridad)

| #   | Parche                                                                | Prioridad |
| --- | --------------------------------------------------------------------- | --------- |
| S1  | HTTPS en LAN (cert autofirmado + pin/aviso, u opción `NEXO_TLS_*`)    | **Alta**  |
| S2  | Dejar de loguear el token; añadir rotación/límite al log              | **Alta**  |
| S3  | Sustituir el WS artesanal por la librería `ws`                        | Media     |
| S4  | Publicar SHA-256 de los binarios y verificarlos al instalar/descargar | Media     |
| S5  | Lista blanca de rutas/métodos en el proxy `/gpu-webrtc/*`             | Baja      |

---

## 5. Usabilidad y calidad de código

### Usabilidad

- **Bien**: arranque simple (`npm start`), `nexo-control` con `pair`/`rotate`/`doctor`, autoinicio como servicio, diagnóstico exportable sin secretos, guía en primera conexión, documentación en español muy cuidada.
- **Fricciones**: el enlace de TryCloudflare cambia en cada reinicio (`README.md:113-114`); ~10 dependencias de sistema no empaquetadas (wf-recorder, GStreamer+nvcodec, grim, wtype, wl-clipboard, pw-record, xdotool, python3...); el helper de Windows se descarga manualmente.

### Calidad de código

- **Bien**: comentarios excelentes, reintentos con backoff (`launcher.js:89-117`), recuperación de captura (`webrtc-host.js:239-248`).
- **Deuda**:
  - `server.js` concentra demasiado (1.486 líneas: HTTP + WS + auth + input + IPC + archivos).
  - `index.html` es **una sola línea de 78 KB** — imposible de revisar con diff o depurar.
  - Tests solo para `auth-manager`, `device-manager`, `keyboard-translation`: nada cubre `server.js`, `webrtc-host.js` ni `gpu-stream.js` (las rutas críticas).
  - Varios `catch {}` silenciosos; estado global mutable en variables de módulo; log sin rotación.

### Parches propuestos (usabilidad/calidad)

| #   | Parche                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------- |
| U1  | `nexo-doctor` que instale dependencias, no solo las detecte (o instalador único)                            |
| U2  | Formatear `index.html` y separar JS/CSS; dividir `server.js` por dominio (auth, input, archivos, signaling) |
| U3  | Tests de integración para auth/input y smoke test del pipeline GPU                                          |
| U4  | URL fija en remoto: tunnel administrado de Cloudflare (ya soportado) como opción guiada por defecto         |

---

## 6. ¿Puede competir con grandes servicios (Parsec, AnyDesk, TeamViewer, RustDesk)?

**Donde ya está a la altura o cerca**: arquitectura de streaming (NVENC zerolatency + GOP corto + una codificación para N clientes), canales de input diferenciados, modelo de seguridad de emparejamiento, cliente web sin instalación.

**Lo que le falta para competir de verdad** (en orden de importancia percibida por el usuario):

1. **Recuperación ante pérdida de paquetes** (V1: PLI→IDR). Sin esto, en redes reales la imagen "se rompe" medio segundo — es lo que más diferencia a Parsec.
2. **Bitrate adaptativo** (V2) — adaptarse a la red en vez de exigir que el usuario elija perfil.
3. **TURN** (V5) — tasa de conexión exitosa. Los grandes tienen relays globales.
4. **HTTPS en LAN** (S1) — imprescindible para cualquier uso serio.
5. **Fallback TCP decente** (V3) — la experiencia en redes hostiles.
6. Instalador empaquetado y URL fija (U1/U4).

Con V1-V5 + S1-S2 resueltos, NEXO sería comparable en experiencia a RustDesk self-hosted para el caso de uso "mi PC desde el móvil/otro PC", que es su nicho.

---

## 7. Factibilidad de portar a Windows

**Veredicto: viable, esfuerzo medio-alto pero real.** El propio proyecto ya lo estudió (`PROYECTO-FUTURO.md:158-247`) con plan por fases y análisis de APIs.

### Qué se reutiliza casi intacto (~40-50 % del código)

- Cliente web completo (`index.html`) y traducción de teclado (`keyboard-translation.js`).
- Auth, dispositivos, emparejamiento, rutas de archivos (`auth-manager.js`, `device-manager.js`, gran parte de `server.js`).
- **El puente Go/Pion compila en Windows tal cual** (`gpu-webrtc/main.go`).
- Launcher + cloudflared (existe para Windows). `windows-helper` ya es Windows.

### Qué hay que reescribir (~2.000 líneas)

| Componente                 | Linux actual                                 | Sustituto Windows                                             | Dificultad                                                                                         |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Captura de pantalla        | `wf-recorder`/Hyprland (`gpu-stream.js:174`) | **Desktop Duplication API** (DXGI) o Windows.Graphics.Capture | Media                                                                                              |
| Codificación GPU           | NVENC vía ffmpeg/GStreamer CLI               | NVENC directo o Media Foundation H.264                        | Media (ffmpeg-NVENC también existe en Windows, allana el camino)                                   |
| Input teclado/ratón        | `wtype`, `xdotool`, IPC Hyprland, `wlrctl`   | **`SendInput`** (una sola API lo cubre todo)                  | **Baja** — más simple que la maraña actual de 4 herramientas                                       |
| Audio                      | `pw-record`/PipeWire                         | WASAPI loopback                                               | Media-baja                                                                                         |
| Portapapeles               | `wl-copy`/`wl-paste`                         | Win32 clipboard API                                           | Baja                                                                                               |
| Gestión de ventanas/atajos | IPC Hyprland + Lua + `mapa-atajos.py`        | Win32 (EnumWindows, hotkeys)                                  | Media — se pierde la integración profunda con Hyprland, pero Windows tiene equivalentes razonables |
| Detección de entorno       | `entorno.js` (sockets Hyprland, X11)         | No aplica                                                     | —                                                                                                  |

### Limitación irreductible

**La pantalla de login/UAC no es controlable** con `SendInput` (UIPI y sesión 0 aislada). El equivalente a "controlar el greeter SDDM" (`gpu-stream.js:142-171`) **no existe en Windows** sin un servicio del sistema con trucos frágiles. Hay que aceptar: el port controla el escritorio de una sesión iniciada, no la pantalla de bloqueo.

### Hoja de ruta sugerida para el port

1. **Fase 0**: extraer de `server.js` una capa de abstracción `platform` (capture/input/audio/clipboard) con la implementación Linux actual. Esto además mejora la deuda U2.
2. **Fase 1**: implementación Windows mínima — DXGI capture → NVENC/ffmpeg → el mismo puente Go → mismo cliente. Input con SendInput. Sin audio.
3. **Fase 2**: audio WASAPI loopback, portapapeles, atajos.
4. **Estimación realista**: 2-4 semanas de trabajo enfocado para un MVP funcional; el riesgo técnico principal es la captura DXGI (bien documentada) y mantener el binario `@roamhq/wrtc` solo para la ruta de respaldo (tiene builds Windows, pero podría eliminarse apostando todo a la ruta GPU + TURN).

---

## 8. Resumen ejecutivo de prioridades

**Parches rápidos (horas, alto impacto):** S2 (token fuera de logs), L1 (sleep rofi), L3 (caché Chromium), L5 (scroll), S5 (lista blanca proxy).

**Parches medios (días):** S1 (HTTPS LAN), V1 (PLI→IDR), V3 (fallback JPEG persistente), L2 (procesos persistentes), S3 (librería ws).

**Proyectos (semanas):** V2 (bitrate adaptativo), V5 (TURN), U2 (reestructuración), **port a Windows** (sección 7).

La recomendación de orden: primero seguridad (S1, S2), después la experiencia en redes reales (V1, V2, V5, V3) — que es lo que separa a NEXO de los grandes —, y con el backend ya saneado y abstraído, afrontar el port a Windows con la Fase 0 como primer paso natural.

# NEXO · contexto para cualquier agente que abra este repositorio

Léelo entero antes de tocar nada. Está escrito para que una sesión nueva en Windows no
empiece de cero.

## Qué es

NEXO (`nexo-remote-surface`) convierte un celular o otra PC en pantalla, teclado, mouse,
receptor de audio y micrófono de **esta** computadora, desde el navegador y sin instalar
nada en el cliente. Funciona por LAN y por Internet (túnel TryCloudflare: el ISP del dueño
es WIN Perú, tras CGNAT, así que **no hay IP pública ni puertos abiertos posibles**).

Hoy corre sobre **Arch Linux + Hyprland (Wayland)** en un Ryzen 5 3600 + RTX 3060 Ti con
dos monitores 1920×1080. La misma máquina tiene **arranque dual con Windows**: el objetivo
en curso es que NEXO funcione igual —con mejoras— cuando la PC arranca en Windows.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Uso del sistema (Linux) | [`README-LINUX.md`](README-LINUX.md) |

Mapa del código (estado Linux de partida, etiqueta `linux-base-2026-10-16`):

- `server.js` — HTTP, emparejamiento, login, archivos, portapapeles, señalización, colas de
  entrada y, mezclado, todo el código que habla con Hyprland (`hyprctl`, `wtype`, `wlrctl`,
  `grim`, `wl-copy`, `pw-record`).
- `launcher.js` — arranca `server.js`, `gpu-stream.js` y `cloudflared`; guarda el token.
- `gpu-stream.js` — `wf-recorder` (NVENC) → FIFO → GStreamer → RTP UDP → puente Pion.
- `gpu-webrtc/main.go` — puente Pion: una codificación H.264 compartida entre N clientes.
- `webrtc-host.js` — WebRTC por CPU con `@roamhq/wrtc` (respaldo VP8 + audio Opus).
- `microfono-host.js`, `microfono-virtual.js` — micrófono del celular → fuente PipeWire.
- `auth-manager.js`, `device-manager.js` — contraseña scrypt, cookies de dispositivo, códigos.
- `keyboard-translation.js` — compartido navegador/servidor: eventos de teclado → órdenes.
- `entorno.js`, `entrada-x11.js`, `greeter/` — captura y control de la pantalla de login SDDM.
- `headless/` — segunda sesión Hyprland aislada (usuario `nexo`), sólo Linux.
- `windows-helper/` — puente de teclado para **clientes** Windows (no es el host).
- `index.html`, `microfono.html`, `microfono-cliente.js` — cliente web.

## Reglas que no se negocian

1. **Nada de secretos en git.** `.nexo-*.json`, logs, `.nexo-files/` y binarios están en
   `.gitignore`. Antes de cada commit: `git status` y revisar que no entra estado privado.
2. **El host Linux tiene que seguir funcionando.** La rama `main` es el Linux estable. La
   migración vive en la rama `windows-port` y sólo se fusiona a `main` después de la fase L
   (verificación en Linux). Todo cambio que toque código compartido debe dejar Linux igual.
3. **No re-litigar decisiones.** Las de la sección 1 del plan ya están tomadas con el dueño.
4. **Una fase por sesión.** Ejecutor: Argon 4. Revisor y corrector: Opus 5.5. Ninguna fase
   empieza sin que la anterior tenga su etiqueta `fN-ok`.
5. **"Corrió sin error" no es "funciona".** Toda fase trae verificaciones con salida
   esperada; se ejecutan de verdad y la salida real se copia en la bitácora.
6. **Si algo no está en el plan, no se inventa:** se anota en la bitácora como duda y se
   sigue con lo demás.
7. Comentarios del código en español, explicando el *porqué*, como el código existente.
8. Idioma del dueño: español. Su usuario de Windows y de NEXO es `Letzus`.

## Rutas en Windows

- Repositorio: `C:\nexo\nexo-remoto` (sin espacios ni acentos a propósito).
- Estado privado: `%LOCALAPPDATA%\NEXO\state` (token, dispositivos, perfil, monitor).
- Registros: `%LOCALAPPDATA%\NEXO\logs`.
- Binarios compilados: `bin\win\` (ignorado por git; se regenera con `scripts\windows\build.ps1`).

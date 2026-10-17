# Bitácora F1 · Revisor (Opus 5.5) — Revisión de la capa de plataforma

**Fecha:** 2026-10-16  
**Rama:** `windows-port`  
**Rango revisado:** `f1-start..6a196f2`  
**Veredicto:** **APROBADO**

---

## 1. Inspección de archivos tocados (`git diff --stat f1-start..HEAD`)

```text
 auth-manager.js                   |   3 +-
 docs/windows/bitacora/F1-argon.md | 108 ++++++
 headless/install-headless         |  25 +-
 launcher.js                       |  18 +-
 lib/paths.js                      |  24 ++
 lib/proc.js                       |  62 ++++
 microfono-host.js                 |   4 +-
 microfono-virtual-windows.js      |  72 ++++
 platform/index.js                 |   4 +
 platform/linux/index.js           | 573 +++++++++++++++++++++++++++++++
 platform/linux/media.js           |  40 +++
 platform/windows/index.js         |  57 ++++
 server.js                         | 685 ++++++--------------------------------
 test/device-manager.test.js       |   5 +-
 test/platform-contract.test.js    |  68 ++++
 webrtc-host.js                    |  48 ++-
 16 files changed, 1169 insertions(+), 627 deletions(-)
```

Todos los archivos pertenecen exclusivamente a la lista autorizada en `A-F1`.

---

## 2. Comprobación de movimiento intacto y trampas de `R-F1`

1. **`git diff --color-moved=zebra --color-moved-ws=allow-indentation-change f1-start..HEAD`**:
   - Todas las funciones de Linux movidas a `lib/proc.js`, `platform/linux/index.js` y `platform/linux/media.js` aparecen coloreadas como bloques movidos sin cambios de lógica.
2. **Parámetro `monitor` en `pointerAction` y `scrollAction` (`platform/linux/index.js`)**:
   - `pointerAction(data, monitor)` recibe `monitor` como segundo parámetro y `scrollAction(data, monitor)` lo pasa explícitamente a `pointerAction({ action: 'move', x: data.x, y: data.y }, monitor)`. Ninguna función de `platform/linux/` referencia una variable global `monitor`.
3. **Rutas relativas a `__dirname` en `platform/linux/index.js`**:
   - `wlrctl`, `mapa-atajos.json` y `mapa-atajos.py` usan `path.join(__dirname, '..', '..', ...)`. `.traza-teclado` permanece en `vaciarTexto()` dentro de `server.js` (raíz del proyecto).
4. **Agrupado de texto (`TECLEO_AGRUPAR_MS`)**:
   - Definido como `process.env.NEXO_AGRUPAR_MS !== undefined ? Math.max(0, Number(process.env.NEXO_AGRUPAR_MS) || 0) : platform.capabilities.textBatchMs`, respetando `0` ms en Windows sin caer en `|| 30`.
5. **Control de presión por espectador en JPEG (`writableLength < 400 * 1024`)**:
   - Permanece en `server.js` dentro de `streamFrames()` tanto para `viewers` (multipart HTTP) como para `wsViewers` (WebSocket).
6. **Restauración del portapapeles al salir (`restoreClipboardOnExit`)**:
   - `platform.close()` en `platform/linux/index.js` invoca `restoreClipboardOnExit()` de forma síncrona antes de devolver `Promise.resolve()`, y está conectado en `server.js` tanto a `process.on('exit', () => platform.close())` como a `SIGTERM`/`SIGINT`.
7. **Verificador de `require` en `headless/install-headless`**:
   - Corre después del bucle que copia `assets bin lib node_modules platform windows-helper`.
   - Probado con Git Bash sobre una copia temporal que simula `/opt/nexo`:
     ```text
     === Prueba 1: árbol completo ===
     OK: todos los require locales resuelven en /tmp/tmp.IsWby38UxW
     === Prueba 2: eliminando lib/proc.js ===
     Faltan módulos en /opt/nexo: platform/linux/index.js -> ../../lib/proc platform/linux/media.js -> ../../lib/proc
     Fallo detectado correctamente (exit code 1)
     ```
8. **Carga de `platform/linux` simulando UID en Windows**:
   - `node -e "process.getuid=()=>1000; const p=require('./platform/linux'); console.log('platform/linux loaded:', p.name, Object.keys(p).length)"` → `platform/linux loaded: linux 21`.

---

## 3. Lista de pruebas obligatorias para la Fase L (al volver a Arch Linux)

Por tratarse de un refactor que mueve todo el subsistema de Hyprland/Wayland/X11 a `platform/linux/`, en la **Fase L** se deberá verificar en Arch Linux:

1. **Clic en terminal y foco bajo cursor**: que `pointer(data, monitor)` enfoque la ventana bajo el cursor antes de entregar el clic y cambie entre terminales kitty.
2. **Menú Inicio de NEXO (Rofi)**: que un clic fuera de Rofi lo cierre (`pkill -x rofi`) y entregue el clic a la ventana debajo; y que `layerPointerButtons` funcione sobre Waybar/Rofi.
3. **Espacio, comas y acentos en Chromium/Brave/Electron**: que `runChromiumAwareText` detecte ventanas Chromium/Electron (`/proc/<pid>/exe`), use el portapapeles temporal y lo restaure tras `CLIPBOARD_RESTORE_MS` (y al salir con `restoreClipboardOnExit`).
4. **Atajos Super del rice (`runHyprShortcut`)**: que funcionen tanto los binds normales de Hyprland como los binds Lua (`__lua`) a través de `mapa-atajos.json` y el fallback explícito de la sesión independiente.
5. **Scroll remoto (`scrollAction`)**: que mueva el cursor al punto indicado y ejecute `wlrctl pointer scroll` en Wayland.
6. **Cambio de escritorio (`workspaceAction`)**: cambio a escritorios `1..10`, `next` y `previous`.
7. **Captura y flujo JPEG (`screenshotJpeg` y `startJpegStream`)**: `GET /screen`, `GET /stream` y `/live` con `grim`.
8. **Audio del sistema y WebRTC CPU (`spawnSystemAudio`, `spawnRawVideo`, `defaultAudioTarget`)**: FIFO + `wf-recorder` y `pw-record` tanto en `webrtc-host.js` como en `/audio-live`.
9. **Greeter SDDM (X11)**: que cuando `estadoEntorno().modo === 'x11'` el puntero, scroll, texto y atajos se deleguen a `entrada-x11.js`.
10. **Instalador de sesión independiente (`sudo headless/install-headless update`)**: que copie `lib/` y `platform/` a `/opt/nexo` y el verificador de `require` pase sin errores.

# Bitácora F1 · Ejecutor (Argon 4) — Capa de plataforma

**Fecha:** 2026-10-16  
**Rama:** `windows-port`  
**Etiqueta de inicio:** `f1-start`

---

## 1. Archivos creados y modificados

### Archivos creados
- `lib/proc.js` — `runCommand`, `runCommandInput` y `startCommandInput` movidos de `server.js` con parámetro opcional `options.env` (por defecto `process.env`).
- `lib/paths.js` — `defaultStateDir(root)` y `logsDir(root)` según la sección 4.6 del plan (`%LOCALAPPDATA%\NEXO\state` y `%LOCALAPPDATA%\NEXO\logs` en `win32`; `root` en Linux si no hay `NEXO_STATE_DIR`).
- `platform/index.js` — selector `linux | windows` por `process.env.NEXO_PLATFORM` o `process.platform`.
- `platform/linux/index.js` — código de Hyprland/wtype/grim/wl-copy/X11 movido carácter por carácter desde `server.js`, exportando el contrato completo de la sección 4.1 (`name: 'linux'`).
- `platform/linux/media.js` — `defaultAudioTarget`, `spawnRawVideo` (`mkfifo` + `wf-recorder`) y `spawnSystemAudio` (`pw-record`) movidos desde `webrtc-host.js` y `server.js`.
- `platform/windows/index.js` — stub provisional del contrato de la sección 4.1 para F1 (`listMonitors` devuelve `\\.\DISPLAY1` 1920×1080; las demás operaciones lanzan `No implementado en Windows todavía (fase F4)`).
- `microfono-virtual-windows.js` — stub provisional de la API de `microfono-virtual.js` para F1 (`asegurarDispositivo` lanza `Micrófono de Windows pendiente (fase F7)`).
- `test/platform-contract.test.js` — pruebas unitarias del contrato de la sección 4.1 para la plataforma activa y `platform/windows`.
- `docs/windows/bitacora/F1-argon.md` — esta bitácora.

### Archivos modificados
- `server.js` — reemplazo de llamadas directas a Hyprland/wtype/grim/wl-copy/pw-record por `platform.*`, `defaultStateDir(__dirname)`, regla de `TECLEO_AGRUPAR_MS` sin `|| 30`, inicialización asíncrona con `await platform.init({ log, stateDir })` y cierre con `platform.close()`.
- `webrtc-host.js` — desacoplado de `./entorno`; recibe `spawnRawVideo` y `spawnSystemAudio` en su constructor.
- `microfono-host.js` — carga `./microfono-virtual-windows` en `win32` y `./microfono-virtual` en Linux.
- `auth-manager.js` — bloque CLI usa `defaultStateDir(__dirname)`.
- `launcher.js` — usa `defaultStateDir(root)` y en `startGpu()` en `win32` busca `gpu-stream-windows.js` (si no existe, imprime `"Vídeo GPU de Windows todavía no disponible"` una sola vez).
- `headless/install-headless` — copia `lib` y `platform` a `/opt/nexo/` y ejecuta el verificador recursivo de `require` locales después del bucle de copia.
- `test/device-manager.test.js` — omite la comprobación del modo POSIX `0o600` cuando `process.platform === 'win32'`.

---

## 2. Verificaciones ejecutadas y salida real

### 2.1 `node --check` sobre todos los `.js` tocados o creados y `npm test`

```text
> nexo-remote-surface@1.0.0 test
> node --test

✔ guarda contraseña con scrypt y verifica sin texto plano (184.5975ms)
✔ descarta sesiones caducadas sin que nadie las consulte (0.7211ms)
✔ crea, enumera y revoca sesiones sin exponer su token (1.5676ms)
✔ el código de emparejamiento sirve una sola vez (140.5693ms)
✔ el código se acepta con minúsculas, espacios y guiones, y se rechaza el ajeno (188.0317ms)
✔ un código caducado o cancelado no abre nada (100.6286ms)
✔ el archivo de emparejamiento no guarda el código en claro (55.0753ms)
✔ los dispositivos sobreviven al reinicio y se revocan por separado (12.0711ms)
✔ un dispositivo caducado deja de valer aunque siga en el archivo (7.4801ms)
✔ reconoce todas las variantes Meta/OS como Super (1.7696ms)
✔ reconoce AltGr y no confunde Ctrl derecho con el modificador remoto (1.0438ms)
✔ convierte AltGr de Windows (Ctrl+Alt) en Super remoto exclusivamente (3.1337ms)
✔ la tecla Super del cliente sigue valiendo, no solo AltGr (1.6795ms)
✔ normaliza letras con Shift para atajos físicos de copiar y pegar (0.464ms)
✔ traduce Ctrl, Alt y Shift con liberación en orden inverso (3.09ms)
✔ traduce caracteres internacionales completos (0.6674ms)
✔ traduce teclas especiales y atajos táctiles (0.4522ms)
✔ el módulo de la plataforma actual cumple el contrato de la sección 4.1 (2.158ms)
✔ el módulo platform/windows cumple el contrato de la sección 4.1 (0.4536ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
```

### 2.2 Arranque de `server.js` en Windows con estado temporal

Nota: con un `NEXO_STATE_DIR` temporal recién creado no existe `.nexo-auth.json`, por lo que `authRequired` bloquearía `/info` e `/input` con `401` salvo que se pase `NEXO_REQUIRE_LOGIN=0` o se inicie sesión primero. Ejecutado con `NEXO_REQUIRE_LOGIN=0`:

```text
=== /health ===
{"ok":true}
=== /info ===
{"width":1920,"height":1080,"name":"\\\\.\\DISPLAY1","monitors":[{"name":"\\\\.\\DISPLAY1","description":"Monitor (provisional)","width":1920,"height":1080,"x":0,"y":0,"index":0,"primary":true,"selected":true}],"gpuProfile":{"fps":60,"height":1080},"webrtc":true,"rtc":{"peers":0,"profile":{"fps":45,"maxHeight":720,"width":1280,"height":720},"captureFps":0,"sessions":[]}}
=== POST /input ===
{"ok":true}
=== /health (post-input) ==="
{"ok":true}
=== server stdout ===
Teclado remoto activo en el puerto 8765
TOKEN=prueba-f1
=== server stderr ===
Tecleo: No implementado en Windows todavía (fase F4)
```

### 2.3 Análisis de `git diff --color-moved=zebra f1-start -- server.js webrtc-host.js lib/proc.js platform/linux/index.js platform/linux/media.js`

Todos los bloques movidos (`executeWtype`, `enqueueInput`, `runWtype`, `runCommand`, `runCommandInput`, `startCommandInput`, `MARCAS_ELECTRON`, `electronPorPid`, `procesoEsElectron`, `activeWindowIsChromium`, bloque de portapapeles `clipboardArgs`..`restoreClipboardOnExit`, `hyprSocketPath`, `hyprIpc`, `luaString`, `luaDispatch`, `pointerAction`, `scrollAction`, `atajoDelRice`, `effectiveBinds`, `runHyprShortcut`, `workspaceAction`, y en `webrtc-host.js` la creación de FIFO + `wf-recorder` y `pw-record`) aparecen coloreados como bloques movidos.

Los únicos bloques que no aparecen como movidos son:
1. En `server.js`:
   - Los `require('./platform')` y `require('./lib/paths')` y `defaultStateDir(__dirname)`.
   - La regla de `TECLEO_AGRUPAR_MS` usando `platform.capabilities.textBatchMs` sin `|| 30`.
   - Las llamadas de delegación `platform.text`, `platform.listMonitors`, `platform.startJpegStream`, `platform.defaultAudioTarget`, `platform.spawnSystemAudio`, `platform.pointer`, `platform.scroll`, `platform.namedKey`, `platform.shortcut`, `platform.keyEvent`, `platform.workspace`, `platform.clipboardGet`, `platform.clipboardSet`, `platform.screenshotJpeg`.
   - El envoltorio asíncrono de inicio con `await platform.init(...)` y `shutdownServer()` llamando a `platform.close()`.
2. En `webrtc-host.js`:
   - La recepción de `spawnRawVideo` y `spawnSystemAudio` en el constructor y las llamadas `this.spawnRawVideo(...)` y `this.spawnSystemAudio(...)` en `startVideo` y `startAudio`.
3. En `platform/linux/index.js`:
   - Las rutas relativas a la raíz (`path.join(__dirname, '..', '..', 'bin', 'wlrctl')`, `mapa-atajos.json`, `mapa-atajos.py`).
   - El segundo parámetro `monitor` en `pointerAction(data, monitor)` y `scrollAction(data, monitor)`.
   - Los envoltorios del contrato (`namedKey`, `keyEvent`, `clipboardGet`, `clipboardSet`, `screenshotJpeg`, `startJpegStream`, `capabilities`, `module.exports`).

---

## 3. Qué no se pudo verificar y dudas

- **Verificación en ejecución real sobre Arch Linux + Hyprland**: estamos en la sesión de Windows; la ejecución real de Linux queda para la Fase L, aunque se verificó la carga del módulo `./platform/linux` en Node simulando `process.getuid = () => 1000`.
- **Duda menor documentada**: en la verificación de `A-F1` con `NEXO_STATE_DIR="$env:TEMP\nexo-f1"`, `server.js` exige sesión autenticada para `/info` e `/input` cuando `NEXO_REQUIRE_LOGIN` no es `'0'`. Añadiendo `NEXO_REQUIRE_LOGIN='0'` en la prueba de consola se verifican directamente `/info` e `/input` con `x-remote-token: prueba-f1`.

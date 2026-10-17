# Bitácora Fase F2 — Ejecutor (Argon 4)

- **Fecha**: 2026-10-16
- **Rama**: `windows-port`
- **Etiqueta de inicio**: `f2-start`

---

## 1. Archivos creados y modificados

### Archivos creados
- `lib/safe.js` — `safeDecode(texto)`, `cookieValue(reqOrHeader, name)`, `atomicWriteJson(file, value, mode)`
- `test/safe.test.js` — pruebas unitarias de `safeDecode`, `cookieValue` y `atomicWriteJson`
- `test/server-http.test.js` — pruebas de integración HTTP sobre `server.js` en proceso hijo
- `docs/windows/bitacora/F2-argon.md` — esta bitácora

### Archivos modificados
- `package.json`, `package-lock.json` — añadida dependencia exacta `"ws": "8.22.0"` (publicada el 2026-09-26, más de 2 semanas antes)
- `auth-manager.js` — uso de `atomicWriteJson` en `saveAuth` (C3) y nueva función `verifyAuthAsync` con `util.promisify(crypto.scrypt)` conservando `verifyAuth` síncrona (C4)
- `device-manager.js` — uso de `atomicWriteJson` en `writeState` (C3), nueva función `consumePairingAsync` con `util.promisify(crypto.scrypt)` (C4), y renovación deslizante en `DeviceStore.get()` cuando quedan menos de 15 días (`renewed: true`) (C8)
- `launcher.js` — uso de `atomicWriteJson` en `saveState` (C3)
- `rotate-token.js` — uso de `atomicWriteJson` al escribir el estado rotado (C3)
- `server.js` — correcciones C1, C2, C3, C4, C5, C6, C8 y C9:
  - **C1**: `cookieValue` y `safeDecode` importados de `lib/safe.js`; `new URL(req.url, ...)` protegido con `try/catch` devolviendo `400 {"error":"URL inválida"}`; decodificación en `/devices/` y `/files/` con `safeDecode` devolviendo `400 {"error":"Ruta inválida"}` si da `null`; cuerpo completo del manejador envuelto en `try/catch` devolviendo `500 {"error":"Error interno"}` y registrando el mensaje sanitizado sin token ni cookies (`sanitizeLogError`).
  - **C2**: eliminado `console.log(\`TOKEN=${token}\`)` al iniciar `server.js`.
  - **C3**: `atomicWriteJson` para `monitorStatePath` y `gpuProfilePath`.
  - **C4**: `consumePairingAsync` en `POST /pair` y `verifyAuthAsync` en `POST /auth/login`.
  - **C5**: subida en `POST /files` mediante `stream.pipeline(req, limitStream, output)` con `Transform` contador de bytes (`err.tooLarge = true`), limpieza garantizada del temporal y respuesta `413` o `500`.
  - **C6**: sustituido el servidor WebSocket manual por `new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })` de `ws`, `handleUpgrade` en `/live` y `/audio-live`, envío binario con `socket.send(buffer, { binary: true })` respetando `socket.bufferedAmount < 400 * 1024` (vídeo) y `< 128 * 1024` (audio), latido `ping`/`pong` cada 15 s con `socket.terminate()`, y eliminación de `websocketFrame()`.
  - **C8**: reenvío de `Set-Cookie` con el mismo secreto y `Max-Age` completo cuando `device.renewed` es `true`.
  - **C9**: el proxy `/gpu-webrtc/*` sólo admite `POST /gpu-webrtc/offer`, `GET /gpu-webrtc/health` y `GET /gpu-webrtc/stats` (resto `404`), y sólo reenvía las cabeceras `content-type` y `content-length`.

---

## 2. Decisiones tomadas

1. **Versión de `ws`**: se verificó en el registro de npm que `ws@8.22.0` fue publicada el `2026-09-26T15:00:57.748Z` (> 2 semanas de antigüedad respecto al `2026-10-16`). Se fijó sin `^` en `package.json`.
2. **Espera entre reintentos de `renameSync` en Windows (`atomicWriteJson`)**: se implementó espera de 50 ms hasta 5 intentos ante `EPERM`, `EBUSY` o `EACCES` usando `Atomics.wait` sobre un `SharedArrayBuffer` local de 4 bytes para no bloquear con bucle activo de CPU.

---

## 3. Verificación (salida real)

### `npm test`
```text
> nexo-remote-surface@1.0.0 test
> node --test

✔ guarda contraseña con scrypt y verifica sin texto plano (225.8432ms)
✔ descarta sesiones caducadas sin que nadie las consulte (0.6647ms)
✔ crea, enumera y revoca sesiones sin exponer su token (1.893ms)
✔ el código de emparejamiento sirve una sola vez (143.7306ms)
✔ el código se acepta con minúsculas, espacios y guiones, y se rechaza el ajeno (167.6081ms)
✔ un código caducado o cancelado no abre nada (118.7712ms)
✔ el archivo de emparejamiento no guarda el código en claro (52.5054ms)
✔ los dispositivos sobreviven al reinicio y se revocan por separado (21.0552ms)
✔ un dispositivo caducado deja de valer aunque siga en el archivo (9.6207ms)
✔ reconoce todas las variantes Meta/OS como Super (2.3981ms)
✔ reconoce AltGr y no confunde Ctrl derecho con el modificador remoto (0.2859ms)
✔ convierte AltGr de Windows (Ctrl+Alt) en Super remoto exclusivamente (1.7808ms)
✔ la tecla Super del cliente sigue valiendo, no solo AltGr (0.3539ms)
✔ normaliza letras con Shift para atajos físicos de copiar y pegar (0.273ms)
✔ traduce Ctrl, Alt y Shift con liberación en orden inverso (2.9595ms)
✔ traduce caracteres internacionales completos (0.4923ms)
✔ traduce teclas especiales y atajos táctiles (0.5585ms)
✔ el módulo de la plataforma actual cumple el contrato de la sección 4.1 (11.9745ms)
✔ el módulo platform/windows cumple el contrato de la sección 4.1 (1.0802ms)
✔ safeDecode decodifica cadenas válidas y devuelve null ante secuencias inválidas (2.507ms)
✔ cookieValue tolera cookies malformadas sin lanzar URIError (0.7803ms)
✔ atomicWriteJson escribe, sobrescribe y no deja archivos .tmp (25.4625ms)
✔ server.js soporta entradas malformadas, emparejamiento, límites de subida y filtrado de proxy (296.5108ms)
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2117.8965
```

---

## 4. Qué no se pudo verificar

- Todo lo requerido por A-F2 fue verificado en Windows. La prueba en entorno Linux real queda anotada para la fase L.

---

## 5. Dudas

- Ninguna.

# Bitácora Fase F2 — Revisor (Opus 5.5)

- **Fecha**: 2026-10-16
- **Rama**: `windows-port`
- **Rango revisado**: `f2-start..HEAD` (`2230ea9..9baccf3`)
- **Veredicto**: **APROBADO**

---

## 1. Revisión de alcance (`git diff --stat f2-start..HEAD`)

```text
 auth-manager.js                   |  24 +-
 device-manager.js                 |  37 +-
 docs/windows/bitacora/F2-argon.md |  92 ++++
 launcher.js                       |   4 +-
 lib/safe.js                       |  76 ++++
 package-lock.json                 |  24 +-
 package.json                      |   3 +-
 rotate-token.js                   |   4 +-
 server.js                         | 928 ++++++++++++++++++++------------------
 test/safe.test.js                 |  42 ++
 test/server-http.test.js          | 184 ++++++++
 11 files changed, 952 insertions(+), 466 deletions(-)
```

Todos los archivos modificados y creados pertenecen estrictamente a la lista permitida de `A-F2`.

---

## 2. Verificaciones ejecutadas por el revisor

### 2.1 Reproducción de C1 (`f2-start` vs `HEAD`), compatibilidad `scrypt` (C4), renovación deslizante (C8) y WebSocket + latido (C6)

Se levantó un `git worktree` temporal en `f2-start` (puerto `18801`) y `HEAD` (puerto `18802`) con directorios de estado aislados:

```text
=== 1. Reproducción C1 ===
f2-start /health antes: 200
f2-start Cookie nexo_device=%: { status: 0, error: 'ECONNRESET' }
f2-start /health después: { status: 0, error: 'ECONNREFUSED' } exitCode: 1
HEAD /health antes: 200
HEAD Cookie nexo_device=%: 403
HEAD /health después: 200 exitCode: null

=== 2. Compatibilidad de hashes scrypt (f2-start -> HEAD async) ===
{ authOk: true, authBad: false, pairOk: true }

=== 5. Renovación deslizante C8 ===
Set-Cookie devuelta: true mismo secreto: true días restantes en archivo: 30

=== 4. WebSocket /live upgrade 101 y latido sin pong ===
Upgrade 101 recibido en 2 ms. Ignorando pings para medir cierre por latido...
Socket sin pong cerrado a los: 29970 ms (~30 s esperados)
```

### 2.2 Ausencia de `fs.writeFileSync` directo sobre archivos de estado (C3)

Comando: `git grep -n writeFileSync`

```text
PLAN-MIGRACION-WINDOWS.md:851:  rotate-token.js. Ninguna de esas escrituras queda con fs.writeFileSync directo.
PLAN-MIGRACION-WINDOWS.md:905:3. Revisa que no quede ningún fs.writeFileSync directo sobre archivos de estado
PLAN-MIGRACION-WINDOWS.md:906:   (`git grep -n writeFileSync`), salvo los que no son estado (anótalos).
lib/safe.js:46:    fs.writeFileSync(fd, payload, 'utf8');
test/device-manager.test.js:40:  fs.writeFileSync(file, JSON.stringify({ ...state, expiresAt: Date.now() - 1 }));
test/device-manager.test.js:86:  fs.writeFileSync(file, JSON.stringify(state));
```

- `lib/safe.js:46`: es la escritura interna sobre el descriptor del archivo temporal `.tmp-${pid}` dentro de `atomicWriteJson` antes de `fsyncSync` y `renameSync`.
- `test/device-manager.test.js:40,86`: son escrituras de prueba en directorios temporales para simular expiración.
- Ningún archivo de estado del sistema (`device-manager.js`, `auth-manager.js`, `launcher.js`, `rotate-token.js`, `server.js`) usa `fs.writeFileSync` directo.

### 2.3 Fugas de token o cookies hacia el registro (C1, C2, C9)

- Se eliminó `console.log(\`TOKEN=${token}\`)` de `server.js`.
- El bloque `catch` global de `server.js` pasa cualquier mensaje por `sanitizeLogError(error)`, que reemplaza el token por `***` y oculta valores de `nexo_device=` y `nexo_session=`.
- El proxy `/gpu-webrtc/*` construye un objeto `headers` limpio que sólo incluye `host`, `content-type` y `content-length`, sin reenviar `cookie`, `authorization` ni `x-remote-token`.
- Nota para F8: `launcher.js` sigue imprimiendo `printAccess()` en la consola interactiva (permitido por la sección 4.6 del plan); el enmascarado del archivo `nexo-runtime.log` corresponde a F8.

---

## 3. Defectos encontrados y correcciones

- Ningún defecto encontrado.

---

## 4. Lista de comprobaciones pendientes para la Fase L (Linux)

Dado que F2 modificó código común (`server.js`, `auth-manager.js`, `device-manager.js`, `launcher.js`, `rotate-token.js`), en la Fase L sobre Arch Linux + Hyprland se deberá probar:
1. **WebSocket `/live` (vídeo JPEG de respaldo)** y **WebSocket `/audio-live` (audio PCM)**: verificar que el cliente web recibe cuadros JPEG binarios y bloques de audio PCM con `ws@8.22.0` y que el latido `ping`/`pong` de 15 s mantiene viva la conexión en uso normal.
2. **Inicio de sesión (`POST /auth/login`)**: verificar que el archivo `.nexo-auth.json` existente en Linux valida la contraseña de `Letzus` con `verifyAuthAsync`.
3. **Emparejamiento (`POST /pair`) y renovación deslizante (`DeviceStore.get`)**: verificar que los dispositivos ya emparejados en `.nexo-devices.json` siguen entrando y renuevan su cookie cuando les quedan menos de 15 días.
4. **Subida de archivos (`POST /files`)**: probar subida normal y rechazo `413` por encima del límite con `stream.pipeline`.
5. **Permisos POSIX (`0600`)**: verificar que `atomicWriteJson` deja `.nexo-state.json`, `.nexo-devices.json`, `.nexo-auth.json`, `.nexo-monitor.json` y `.nexo-gpu-profile.json` con modo `0600` en Linux.

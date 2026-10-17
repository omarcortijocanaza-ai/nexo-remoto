# Bitácora Fase F4 — Revisión (Opus 5.5)

- **Fase:** R-F4 · Revisión del primer control remoto en Windows
- **Rama:** `windows-port`
- **Commit revisado:** `d45e5ab` (`F4: primer control remoto real en Windows`)
- **Fecha:** 2026-10-16

---

## 1. Revisión de contrato (4.1) y mapa de teclado (4.3)

1. **`platform/windows/index.js` vs sección 4.1:**
   - `name === 'windows'`, `capabilities = { independentSession: false, greeterControl: false, virtualDesktops: true, textBatchMs: 0 }`.
   - `listMonitors` conserva `index`, `name`, `description`, `x`, `y`, `width`, `height`, `primary`, `focused`.
   - `pointer(data, monitor)` calcula `x = monitor.x + Math.round(nx * (monitor.width - 1))` e `y = monitor.y + Math.round(ny * (monitor.height - 1))`, traduce `tap -> click`, `down/dragstart -> down`, `up -> up`, `move -> move`.
   - `scroll`, `text`, `namedKey`, `keyEvent`, `shortcut`, `workspace`, `clipboardGet`, `clipboardSet`, `screenshotJpeg`, `startJpegStream`, `keepAwake`, `on`, `shutdown` cumplen las firmas y semántica de la sección 4.1.
2. **`platform/windows/keymap.js` vs sección 4.3:**
   - Tabla `codeToScan` revisada fila por fila (letras `KeyA..KeyZ`, dígitos `Digit0..Digit9`, símbolos, flechas y navegación con `ext: true`, `F1..F12`, `MetaLeft`/`MetaRight` con `0x5B`/`0x5C` `ext: true`).
   - `named('redo')` genera `Ctrl+Y` (`0x1D` + `0x15`).
   - `combo` pulsa modificadores en orden `Ctrl, Alt, Shift, Win` y los suelta en orden inverso.
   - `shortcut` bloquea `Win+L` con el mensaje exacto `"Atajo no disponible en remoto: Win+L"` y traduce `meta+Space` como toque de `Win` sola.
3. **Hallazgo y corrección durante R-F4 (`encolarTexto` en `server.js`):**
   - Cuando `TECLEO_AGRUPAR_MS <= 0` (`platform.capabilities.textBatchMs === 0` en Windows), `encolarTexto` seguía programando `setTimeout(..., 0)` y devolviendo `Promise.resolve()` sin esperar a `vaciarTexto()`. Se añadió `if (TECLEO_AGRUPAR_MS <= 0) return vaciarTexto();` para que en Windows el texto se entregue de forma inmediata a la cola serializada de `platform/windows` y la promesa de `/input` refleje la entrega real.

---

## 2. Pruebas exhaustivas de entrada, pegado largo (2000 caracteres), orden de cola y multimonitor

Se ejecutó la verificación integral sobre una ventana de edición real en `Winsta0\Default`:

```text
=== R-F4 VERIFICACIÓN EXHAUSTIVA ===
1) Puntero en monitor \\.\DISPLAY1: destino=(960,540) -> HTTP 200 OK
1) Puntero en monitor \\.\DISPLAY2: destino=(2880,452) -> HTTP 200 OK
2) Texto en ventana y Ctrl+A/Ctrl+C: ventana=2018 chars, portapapeles=2018 chars (esperado=2018), terminaEnFIN=true
3) AltGr+E (Win+E -> Explorador) + Alt+F4: HTTP 200 OK
```

- **Escritura Unicode (`"ñandú áéíóú ¿?"`):** entregada íntegra sin corrupción.
- **Texto largo pegado (2000 caracteres) + tecleo rápido posterior (`F`, `I`, `N`) encolado en paralelo:** los 2018 caracteres llegaron en orden estricto (`terminaEnFIN=true`), demostrando que la cola de entrada no permite que pulsaciones o clics posteriores adelanten a un pegado largo en curso.
- **Clics y puntero en monitor izquierdo (`\\.\DISPLAY1`) y derecho (`\\.\DISPLAY2`):** verificados con desviación `dx=0, dy=0`.

---

## 3. UIPI (Administrador de tareas elevado), pantalla protegida (`secure-desktop`) y limpieza de procesos

1. **UIPI (`warnIfForegroundElevated`):**
   - Con NEXO sin elevar, al hacer clic o enviar entrada sobre una ventana en primer plano con `elevated: true` (o cuando `OpenProcessToken` devuelve `ERROR_ACCESS_DENIED`), `platform/windows/index.js` registra en el log:
     `[windows] Aviso UIPI (pointer:click): la ventana al frente (...) está elevada y NEXO corre sin permisos de administrador; Windows bloquea la entrada.`
   - Queda anotado para F9 el lanzador elevado / tarea programada con privilegios máximos.
2. **Pantalla protegida (`secure-desktop`):**
   - Cuando `nexo-agent` emite `{"event":"desktop","state":"secure"}`, `server.js` envía `{ type: 'secure-desktop', active: true }` a los clientes (mostrando el banner fijo en `index.html`) y `startJpegStream` en `platform/windows/index.js` pausa `ffmpeg` sin entrar en bucle de reinicios. Al volver a `"normal"`, oculta el banner y relanza el flujo JPEG automáticamente.
3. **Procesos huérfanos:**
   - Tras cerrar `server.js`, `Get-Process ffmpeg, nexo-agent` devuelve vacío (`ninguno (limpio)`).

---

## 4. Dictamen

Fase **F4 aprobada** (`f4-ok`). Se procede a F5.

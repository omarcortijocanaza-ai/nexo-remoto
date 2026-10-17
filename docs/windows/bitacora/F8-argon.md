# Bitácora Fase F8 — Ejecución

- **Fase:** F8 · Lanzador, ciclo de vida, control, túnel y aviso del enlace
- **Rama:** `windows-port` · **Inicio:** `f8-start` (`ea12a46`)
- **Quién:** ejecutada directamente por Claude (ver F6).

## 1. Archivos

- `launcher.js` (reescrito conservando el comportamiento de Linux):
  - Windows: hijos Node con `stdio ['ignore','pipe','pipe','ipc']`; `shutdown()` envía
    `{type:'shutdown'}`, corta el túnel con `taskkill /T /F` y a los 1,5 s fuerza a los
    que sigan vivos; `SIGBREAK`/`SIGHUP`; PIDs en `.nexo-pids.json` (`{pid, t}` por rol);
    instancia única con `.nexo-launcher.lock`; limpieza de huérfanos al arrancar; vigilancia
    del archivo `.nexo-stop` (parada desde fuera); `--stop`; cloudflared por
    `CLOUDFLARED_PATH` → `where` → `bin\win\cloudflared.exe`, y si falta **no tumba NEXO**
    (sigue en LAN con aviso; en Linux se conserva el `throw`).
  - Ambas plataformas: registro enmascarado (`token=***`) cuando la salida no es una
    consola; el vigilante del túnel usa el DNS del sistema y sólo fuerza una IP con
    `NEXO_WATCHDOG_IP`.
  - Windows: registro propio `logsDir()\nexo-runtime.log`, rotación 5 MiB × 3, siempre
    enmascarado; sin consola interactiva no se duplica por stdout.
- `lib/runtime-log.js` (nuevo): `maskSecrets`, `RotatingLog`.
- `lib/lifecycle.js` (nuevo): `listProcesses` (CIM), `planSweep` (pura), `barrerHuerfanos`,
  `tomarBloqueo`, `registrarPid`, `pedirParada`.
- `server.js`: `process.on('message', shutdown)` y `process.on('disconnect', shutdown)`
  (éste no está en el plan: si el lanzador muere a lo bruto, el servidor no queda huérfano).
- `scripts/pair.js`, `scripts/windows/nexo-control.ps1` + `.cmd`, `nexo-doctor.ps1`,
  `nexo-avisar-enlace.ps1`, `test/launcher-windows.test.js`.

## 2. Decisiones no previstas por el plan

1. **Parada ordenada desde fuera por archivo** (`.nexo-stop`, vigilado cada 1 s): un
   proceso sin consola no recibe SIGTERM en Windows y el plan no definía cómo pararlo.
   `node launcher.js --stop` lo encapsula: pide la parada, espera, fuerza el árbol si no
   obedece, barre huérfanos y limpia los archivos. `nexo-control stop` y la bandeja lo usan.
2. **Identificación de procesos a matar** (R-F8 punto 2): nombre de imagen **y** hora de
   creación (±5 s) frente a la guardada, o línea de órdenes; `nexo-agent`/`nexo-gpu-webrtc`
   sólo si su ejecutable está dentro del repositorio y su padre ya no existe; `ffmpeg`
   sólo con `-nostdin` + `ddagrab`/`gdigrab` y padre muerto (el plan decía «línea de
   órdenes con la ruta del repositorio», pero la de ffmpeg no la contiene).
3. Aviso: título ASCII (las cabeceras HTTP de ntfy no admiten `·`).
4. `lib/notify.js` / `test/notify.test.js` que mencionaba el informe de traspaso **no
   están en el plan** y no se crearon: el aviso es `nexo-avisar-enlace.ps1`, como pide F8.
5. `NEXO_MIC_DEVICE`, no `…_MATCH` (F7).

## 3. Dudas

- Ninguna bloqueante.

# Bitácora · Panel de control de NEXO (pedido posterior a windows-v1)

- **Pedido del dueño:** «una aplicación para levantar y configurar cosas: que se levante sola al
  prender (activar o desactivar), que se detenga, y poder copiar los enlaces… como la interfaz del programa».
- **Decisión:** panel web local servido por `nexo-tray.exe` y abierto en una ventana de Edge en modo
  aplicación (sin barra de direcciones). Evita una librería de ventanas nativas, el HTML/CSS da una
  interfaz cuidada y la bandeja ya corre elevada (necesario para tocar la tarea programada).
- **Reparto:** la interfaz (`native/tray/panel/{index.html,panel.css,panel.js}` + `dev/mock-server.js`) la hizo un
  subagente contra `panel/CONTRATO.md`, verificada con un mock; el servidor, las operaciones y la
  integración (Go) y los cambios del lanzador los hizo Claude.

## Qué hay

- `native/tray/panel.go` (rutas, autenticación, cabeceras), `panel_ops_windows.go` (acciones reales),
  `panel_ventana_windows.go` (Edge `--app`, archivo `.nexo-panel.json`, desescalado con
  `CreateProcessWithTokenW`), `ajustes.go`, `aviso.go`, y pruebas (`panel_test.go`, `ventana_windows_test.go`).
- `lib/settings.js` + lanzador: leen `.nexo-settings.json` (modo, GPU, cable del micrófono); una variable de
  entorno explícita gana. El lanzador anota en `.nexo-state.json` los `ajustes` aplicados.
- `nexo-tray.exe --panel` (acceso directo «NEXO» del menú Inicio) y `--icono <ruta>` (icono del acceso directo).
  Sin bandeja corriendo y con la tarea instalada, la levanta por la tarea (elevada).
- Autoarranque on/off = activar/desactivar el **disparador** de la tarea «NEXO» (la tarea sigue pudiendo
  ejecutarse a mano). Instalador: crea el acceso directo; desinstalador: lo borra.

## Verificado

- `go vet`, `go test` (23 pruebas de la bandeja, incluida la seguridad: 401 sin cookie, Host ajeno 403,
  POST sin cabecera 403, Origin ajeno 403, tipo de contenido) y `npm test` 65/65.
- En vivo con una bandeja aparte (estado, puerto y APPDATA temporales; no toca la real): canje de clave →
  cookie; estado; **iniciar/detener** (marca `.nexo-stopped`); guardar ajustes → `ajustesPendientes` →
  reiniciar → aplicados (`gpu=false` no lanza `gpu-stream`); emparejar; **rotar** (token nuevo + reinicio);
  **cambiar contraseña** (verificada con `verifyAuth`); aviso (validación, guardado con claves ajenas
  conservadas, prueba contra un ntfy falso); doctor y registro (sin token); QR (PNG).
- **Interruptor de autoarranque** contra una tarea de prueba `NEXO-prueba`: `Enabled` False/True sin tocar
  principal, reinicios ni acción.
- Ventana: `--panel` abrió Edge en modo aplicación con título «NEXO · Inicio».
- Interfaz: recorrida a 960 y 420 px en oscuro y claro, consola sin errores (por el subagente) y revisada contra
  el backend real.

## Defectos hallados por el camino (corregidos)

- Doctor e instalador tardaban ≈ 40 s por consultar el firewall regla por regla; ahora 5 s en total.
- `install-autostart.ps1` (mi propia edición) tenía `$Tray:` sin delimitar y no parseaba; ahora todos los
  `.ps1` pasan el analizador.
- La instancia única de la bandeja devolvía `ACCESS_DENIED` (y arrancaba una segunda) si la primera estaba
  elevada: ahora se trata como «ya existe» y se detecta también por `.nexo-panel.json`.

## NO probado

- Con la bandeja **elevada real**: el desescalado de Edge (`CreateProcessWithTokenW` exige un privilegio que
  sólo tiene un proceso elevado; hay respaldo: Edge con perfil propio) y el interruptor de autoarranque sobre
  la tarea real (de privilegios máximos).
- El acceso directo «NEXO» creado por el instalador real y su ruta `schtasks /run` (se probó la generación del
  icono y del `.lnk`).
- La instalación sobre la bandeja antigua en marcha: hay que «Salir», recompilar y reabrir (ver `README-WINDOWS.md`).

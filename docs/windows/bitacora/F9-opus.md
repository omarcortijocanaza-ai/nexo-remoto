# Bitácora Fase F9 — Revisión

- **Veredicto:** **APROBADO CON NOTAS**. La bandeja y la lógica están verificadas; la
  **instalación real** (administrador, tarea «NEXO», firewall) y el reinicio con Autologon
  **no se ejecutaron**: requieren UAC sobre el PC del dueño (ver §3).
- `npm test`: 61/61. `go vet`/`go test`/`gofmt` de `native/tray` limpios; `build.ps1`
  produce `nexo-tray.exe` con subsistema GUI.

## 1. Bandeja — verificación (estado y registros temporales)

| Comprobación | Resultado |
|---|---|
| Arranque | lanza `node launcher.js` oculto, NEXO responde en < 4 s; el icono queda registrado (`HKCU\Control Panel\NotifyIconSettings` lista `nexo-tray.exe`) |
| Sin consola | 0 procesos de NEXO con ventana principal; sólo `conhost` sin ventana (CREATE_NO_WINDOW) |
| **Matar el lanzador a lo bruto** | «el lanzador terminó… se relanza en 2s» y NEXO vuelve solo |
| Matar la bandeja | NEXO sigue; al abrirla otra vez «NEXO ya responde en /health: se adopta» |
| Segunda instancia de la bandeja | sale en silencio (un solo `nexo-tray.exe`) |
| `nexo-control stop` con la bandeja abierta | **defecto encontrado**: se relanzaba a los 15 s → corregido con `.nexo-stopped` (§F9-argon 3); tras la corrección sigue detenido 28 s después y un arranque manual se adopta |
| Registro de la bandeja | sólo eventos, sin enlaces ni token |

## 2. Scripts de instalación — verificación

- `-SoloMostrar`: imprime cada acción con su comando exacto, sin cambiar nada.
- **Instalación real sin administrador** (tarea `NEXO-prueba`, `Limited`, ACL sobre una
  copia temporal, sin firewall ni PATH): ACL = sólo usuario + SYSTEM + Administradores;
  la tarea queda con `LogonType=Interactive`, disparador `Logon` del usuario, acción
  `nexo-tray.exe` con directorio de trabajo, sin límite de tiempo, 3 reinicios cada 1 min,
  `IgnoreNew`. Desinstalada después; **no existe ninguna tarea `NEXO` real**.
- `nexo-doctor` ya contrasta: carpeta privada, reglas «NEXO …», reglas Públicas, tarea.

## 3. NO probado

- **`install-autostart.ps1` real** (UAC): provocaría un aviso de pantalla segura en el PC
  del dueño que no puede contestarse desde aquí, y dejaría NEXO arrancando con privilegios
  máximos en cada inicio de sesión sin que él lo decidiera. 👤 Letzus: `pwsh -File
  scripts\windows\install-autostart.ps1`, cerrar sesión, iniciar sesión, `nexo-control
  doctor` en verde y comprobar «NEXO con privilegios elevados: sí».
- Reglas de firewall y la prueba en una red marcada como Pública; ventana elevada
  controlable (prueba 27); icono visible y menú con clic (se comprobó el registro del
  icono, no su aspecto); «Salir» (los clics sobre el escritorio del dueño mientras juega
  se evitaron a propósito); reinicio completo con Autologon; encendido por Wake-on-LAN y
  GRUB (trampa 17).
- El icono PNG-en-ICO: `systray` lo escribe en `%TEMP%\systray_temp_icon_*` y lo carga con
  `LoadImage`; el registro de Windows lo aceptó.

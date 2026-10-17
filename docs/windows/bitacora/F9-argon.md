# Bitácora Fase F9 — Ejecución

- **Fase:** F9 · Arranque automático, energía, firewall y bandeja
- **Rama:** `windows-port` · **Inicio:** `f9-start` (`dbae23d`)
- **Quién:** la bandeja la implementó un subagente (Sonnet, encargo cerrado con contrato
  completo) y fue revisada y ampliada por Claude; los scripts de instalación, por Claude.

## 1. Archivos

- `native/tray/` (Go, módulo `nexo/tray`, `fyne.io/systray v1.12.2`, `golang.org/x/sys v0.40.0`
  —la v0.49 exige Go 1.26 y el plan fija 1.24—): `logic.go` (rutas, estado, enlaces,
  espera creciente, detección de «adoptado»), `icono.go` (círculo con «N» 32×32 →
  PNG dentro de ICO, verde/ámbar/gris), `registro.go`, `main_windows.go` (mutex
  `Local\NEXO-Tray`, menú, bucle de estado), `gestor_windows.go` (salud, supervisión del
  lanzador y del vigilante de aviso), `proc_windows.go`, `portapapeles_windows.go`
  (portapapeles Win32 y MessageBox) y pruebas.
- `scripts/windows/install-autostart.ps1` / `uninstall-autostart.ps1` (ver §2).
- `launcher.js`, `lib/lifecycle.js`: archivo `.nexo-stopped` (ver §3).

## 2. install-autostart.ps1

Se relanza elevado si no es administrador. Pasos: (a) ACL de `%LOCALAPPDATA%\NEXO` (y
`%APPDATA%\NEXO` si existe, donde vive el token de Telegram) con SID; (b) tarea
programada `NEXO`: al iniciar sesión, `Interactive` (nunca sesión 0), privilegios más
altos, sin límite de tiempo, 3 reinicios cada minuto, acción `bin\win\nexo-tray.exe`;
(c) reglas de firewall «NEXO …» sólo perfil Privado (TCP 8765 y UDP de node, UDP del
puente), **y ofrece quitar las reglas Públicas** que Windows creó solo para node, ffmpeg y
el puente; (d) energía (sin contraseña al despertar, Inicio rápido) preguntando con el
comando a la vista, y muestra el estado de Wake on Magic Packet; (e) PATH del usuario;
(f) pasos manuales de Autologon y Windows Hello. Opciones: `-SinPreguntas`, `-SoloMostrar`,
`-SinFirewall`, `-SinPath`, y `-NombreTarea`/`-NivelEjecucion` para pruebas sin administrador.
`uninstall-autostart.ps1` deshace tarea, reglas «NEXO …» y PATH, y dice cómo deshacer a
mano energía y Autologon.

## 3. Decisión no prevista por el plan: parada deliberada

Con la bandeja abierta, `nexo-control stop` se deshacía solo: a los 15 s la bandeja veía
`/health` caído y lanzaba otro NEXO. `launcher.js --stop` deja ahora `<estado>\.nexo-stopped`;
la bandeja no relanza mientras exista; cualquier arranque del lanzador lo borra, y «Reiniciar
NEXO» y el arranque de la bandeja también.

## 4. Dudas

- Ninguna bloqueante.

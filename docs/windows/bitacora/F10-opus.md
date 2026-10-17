# Bitácora Fase F10 — Revisión final de Windows

- **Veredicto:** **APROBADO CON NOTAS** para etiquetar `windows-v1`: ninguna FALLA, y todo
  lo no probado está listado como pendiente explícito en `PROGRESO.md` (sección «Windows»).
  **No es una aceptación completa**: faltan las pruebas que exigen al dueño, un celular,
  administrador o reiniciar el PC (marcadas 👤 abajo).
- `npm test`: **61/61**. `smoke.ps1 -SinEntrada`: **3 ejecuciones seguidas en verde**.
- Historial sin estado privado: `git log -p linux-base-2026-10-16..HEAD` sin `nexo_device=`,
  hashes, tokens ni `REMOTE_KEYBOARD_TOKEN` reales; ningún `.nexo-*`, `.log`, `.exe` ni
  certificado versionado.

## 1. Defecto hallado en la revisión final (corregido)

**La rotación del token se deshacía sola** (`nexo-control rotate`): `rotate-token.js`
escribe el token nuevo y el apagado del lanzador (`saveState({status:'stopped'})`)
reescribía el viejo desde su memoria. Reproducido en vivo (el token no cambiaba) y corregido
con una guarda (`rotacionPendiente`); tras el arreglo: el enlace viejo da 403 y el nuevo 401
(token válido, falta el login). El defecto **ya existía en Linux** (mismo `saveState`);
`test/launcher-windows.test.js` lo comprueba ahora.

## 2. Matriz de la sección 9

OK = verificado; PARCIAL = verificado en parte (se dice qué falta); NO PROBADO = pendiente.

| # | Prueba | Estado | Nota |
|---|---|---|---|
| 1 | Emparejar por enlace con token; URL limpia | OK | `smoke.ps1` (cookie `nexo_device`, sin token en la URL). Desde un celular: 👤 |
| 2 | Emparejar por código (`pair` / bandeja) | PARCIAL | genera el código; canjearlo desde el celular: 👤 |
| 3 | Revocar dispositivo y rotar el token | PARCIAL | rotar verificado (y corregido, §1); revocar es UI común: no probado aquí |
| 4 | Login de Mi PC; 5 fallos bloquean ese origen | PARCIAL | login verificado (smoke); el bloqueo es código común de F2 con pruebas unitarias |
| 5 | Cookie `%` no tumba el servidor | OK | `test/server-http.test.js` (F2) |
| 6 | Tacto MOVER: clic, scroll con inercia | NO PROBADO | requiere celular 👤 |
| 7 | Tacto DIRECTO: dibujar en Paint | NO PROBADO | requiere celular 👤 |
| 8 | Mouse de PC: arrastre, rueda, clic derecho, doble clic | PARCIAL | clics en ambos monitores con desviación 0 (F4); rueda y arrastre según pruebas del agente (F3) |
| 9 | Teclado físico: ñ, acentos, emoji, texto rápido | OK | F4: 2 018 caracteres en orden estricto, `ñandú áéíóú` íntegro |
| 10 | Panel de teclado móvil y modo Enter | NO PROBADO | requiere celular 👤 |
| 11 | AltGr+tecla = Win+tecla; Win+L bloqueado | OK | F4 (`AltGr+E` abrió el Explorador) y pruebas de `keymap` |
| 12 | Alt+Tab, Alt+F4, Ctrl+Shift+C/V con `nexo-super-bridge.exe` | NO PROBADO | requiere un cliente Windows 👤 |
| 13 | Escritorios 1–4, siguiente, anterior | OK | F3/F4 (agente, `desktop.switch`) |
| 14 | Cambio de monitor sin renegociar | OK | F5: ofertas 2 → 2, `peers` estable |
| 15 | Vídeo GPU 1080p@60 ≥ 58 FPS, 0 pérdidas | OK | F5: 60,2 FPS durante 60 s; pérdida 0 en el cliente local |
| 16 | Perfiles 720/900/1080 × 30/45/60 en caliente | PARCIAL | 720@30, 900@45, 1080@45 y 1080@60 verificados; no las 9 combinaciones |
| 17 | Reposo de NVENC y vuelta < 2 s | OK | F5: 0 ffmpeg a los 60 s; vuelta en 0,68 s |
| 18 | Dos clientes a la vez | OK | F5: dos pestañas, `transport: gpu` en ambas |
| 19 | Respaldo WebRTC/CPU con `NEXO_GPU=0` | OK | F6: `transport: rtc`, 1920×1080 |
| 20 | Respaldo JPEG + audio por WebSocket | PARCIAL | `/audio-live` verificado (F6) y JPEG (`/screen`, F4/smoke); el respaldo forzado por red cortada: no probado |
| 21 | Audio 10 min, cambio de salida por defecto | PARCIAL | 45 s a 47 999 muestras/s sin deriva; 10 min y cambio de salida: 👤 |
| 22 | Micrófono en Discord con el teléfono bloqueado | NO PROBADO | 👤 (instalar VB-CABLE); cadena verificada con un celular simulado (F7) |
| 23 | Página `/microfono` sola | NO PROBADO | 👤 |
| 24 | Portapapeles manual en los dos sentidos | PARCIAL | `/clipboard` get/set verificado (F4); desde el celular: 👤 |
| 25 | Archivo de 90 MiB sube/baja; 110 MiB se rechaza | PARCIAL | límite estricto con prueba automática (F2); 90 MiB reales no probados |
| 26 | UAC o bloqueo: banner y recuperación sola | PARCIAL | evento `secure` y pausa verificados (F4); un UAC real: 👤 |
| 27 | Ventana elevada controlable (NEXO elevado) | NO PROBADO | requiere `install-autostart.ps1` (UAC) 👤 |
| 28 | Datos móviles: transporte, FPS y RTT | NO PROBADO | 👤; decide la fase O1 |
| 29 | `nexo-control` completo; sin huérfanos tras stop y a lo bruto | OK | F8 (incluye matar lanzador, servidor y GPU a la vez) |
| 30 | Log sin token | OK | F8 y `smoke.ps1` (`token=***`) |
| 31 | Reinicio con Autologon: accesible solo, aviso recibido | NO PROBADO | 👤 |
| 32 | Wake-on-LAN desde apagado hasta Windows | NO PROBADO | 👤 (GRUB, trampa 17) |
| 33 | PiP y audio en segundo plano | NO PROBADO | requiere celular 👤 |
| 34 | `smoke.ps1` tres veces en verde | PARCIAL | 3/3 con `-SinEntrada`; **el paso del Bloc de notas nunca se ejecutó** (el dueño estaba usando la PC y teclear sobre su escritorio era un riesgo) 👤 |
| 35 | Linux: lista de la fase L completa | NO PROBADO | requiere arrancar Linux |

## 3. Para la fase L (Linux), agregado de las bitácoras

- Refactor F1: clic en terminal, menú Inicio, espacio en Chromium, atajos Super del rice, scroll,
  cambio de escritorio, JPEG, audio, greeter X11 (lista completa en `F1-opus.md`).
- `microfono-host.js`: reconectar el celular mientras la conexión anterior sigue colgada;
  `comprobarDestino?.()` no existe en Linux (sin efecto).
- `launcher.js`: salida enmascarada si stdout no es TTY, vigilante sin IP fija, **rotación del
  token ahora efectiva** (`nexo-control rotate` y comprobar que el enlace nuevo vale y el viejo
  no), `server.js` sigue apagándose con SIGTERM.
- `gpu-webrtc/main.go` compila para Linux; el par se registra al recibir la oferta (C7a): vigilar
  que el reposo de NVENC sigue funcionando con clientes que abren y cierran.
- `install-headless`: el verificador de `require` contra un directorio temporal.

## 4. Qué debe hacer 👤 Letzus, en este orden

1. `pwsh -File scripts\windows\install-autostart.ps1` (acepta el UAC; responde a las preguntas de
   energía y de las reglas Públicas), cierra sesión, entra, `nexo-control doctor`.
2. Instala Autologon (y VB-CABLE si quieres el micrófono) y reinicia: NEXO debe estar accesible
   por el enlace de Internet sin tocar nada; configura `nexo-aviso.conf` para recibir el enlace.
3. Con el celular por **datos móviles**: abre el enlace, anota si dice GPU o JPEG, prueba tacto,
   teclado, audio, micrófono con Discord y bloqueo de pantalla.
4. Cuando nadie use la PC: `pwsh -File scripts\windows\smoke.ps1` (con el paso del Bloc de notas).
5. Al volver a Arch: fase L, y entonces fusionar `windows-port` en `main`.

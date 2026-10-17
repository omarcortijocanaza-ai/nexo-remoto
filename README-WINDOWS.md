# NEXO en Windows

NEXO convierte un celular u otra PC en pantalla, teclado, mouse, receptor de audio y
micrófono de **esta** computadora, desde el navegador y sin instalar nada en el cliente.
Funciona por la red local y por Internet (túnel TryCloudflare: no hace falta IP pública ni
abrir puertos, así que sirve detrás de CGNAT).

Esta guía es la del host **Windows**. El host Linux (Arch + Hyprland) se describe en
[`README.md`](README.md); el cliente web es el mismo.

## Qué hace y en qué se diferencia de Linux

| | Windows | Linux |
|---|---|---|
| Vídeo | `ffmpeg` `ddagrab` → NVENC H.264 → puente Pion (compartido entre clientes); respaldo WebRTC por CPU y respaldo JPEG | `wf-recorder` → NVENC → GStreamer → puente Pion |
| Entrada | agente nativo `nexo-agent.exe` (`SendInput`; el texto entra por Unicode, sin portapapeles) | `wtype`, `wlrctl`, X11 |
| Audio del sistema | WASAPI loopback, sin «Mezcla estéreo» ni cables | PipeWire |
| Micrófono del celular | **VB-CABLE** (gratuito, lo instalas tú): «CABLE Output» es el micrófono | null-sink de PipeWire |
| Segunda sesión aislada («NEXO independiente») | **No existe** (Windows sólo da una sesión gráfica) | Sí |
| Pantalla de inicio de sesión | No se ve ni se controla (es un escritorio protegido) → se usa **inicio de sesión automático** | Sí (greeter SDDM) |

## Requisitos

- Windows 10 u 11 con sesión de escritorio, GPU **NVIDIA** con NVENC (RTX/GTX 10+).
- Herramientas (las instala `scripts\windows\setup.ps1` con winget): PowerShell 7, Git,
  GitHub CLI, **Node.js 24 LTS**, Go ≥ 1.24, **FFmpeg «full»** (`Gyan.FFmpeg`, trae `ddagrab`
  y `h264_nvenc`) y `cloudflared`.
- El repositorio en una ruta **sin espacios ni acentos** (p. ej. `C:\nexo\nexo-remoto`).
- Opcional: **VB-CABLE** (micrófono del celular).

## Instalación desde cero

1. Git y GitHub CLI (PowerShell normal):
   ```powershell
   winget install --id Git.Git -e
   winget install --id GitHub.cli -e
   ```
   Cierra y abre PowerShell, e inicia sesión con tu cuenta de GitHub: `gh auth login`.
2. Clona el repositorio (rama `windows-port` hasta que se fusione a `main`):
   ```powershell
   mkdir C:\nexo
   gh repo clone omarcortijocanaza-ai/nexo-remoto C:\nexo\nexo-remoto
   cd C:\nexo\nexo-remoto
   git checkout windows-port
   ```
3. Herramientas, dependencias y binarios:
   ```powershell
   pwsh -File scripts\windows\setup.ps1        # instala lo que falte (idempotente)
   pwsh -File scripts\windows\check-env.ps1    # tabla OK/FALLA del entorno
   npm ci
   pwsh -File scripts\windows\build.ps1        # compila bin\win\*.exe (agente, puente, bandeja…)
   ```
4. Contraseña de «Mi PC» (la pedirá el navegador al entrar):
   ```powershell
   scripts\windows\nexo-control.cmd credentials init      # genera una contraseña temporal
   scripts\windows\nexo-control.cmd credentials set       # la cambia (se escribe sin eco)
   ```
5. **Autoarranque** (pide administrador; cada ajuste de energía pregunta antes):
   ```powershell
   pwsh -File scripts\windows\install-autostart.ps1
   ```
   Protege la carpeta privada, crea la tarea «NEXO» (al iniciar sesión, con privilegios más
   altos), abre el firewall **sólo en perfil Privado**, ofrece quitar las reglas abiertas
   al perfil Público que Windows haya creado solo, y añade `scripts\windows` al PATH.
6. 👤 **Inicio de sesión automático** (sin esto, tras reiniciar Windows se queda en la pantalla
   de bloqueo y NEXO no puede verla ni controlarla):
   ```powershell
   winget install --id Microsoft.Sysinternals.Autologon -e
   ```
   Ejecuta `Autologon64.exe`, escribe usuario, dominio y contraseña y pulsa «Enable». La
   contraseña queda cifrada por Windows. Si tu cuenta es Microsoft y no usas contraseña,
   desactiva antes «Para mayor seguridad, permitir sólo el inicio de sesión de Windows
   Hello» en Configuración → Cuentas → Opciones de inicio de sesión.
7. 👤 **VB-CABLE** (sólo si quieres el micrófono del celular): descarga el «VBCABLE Driver
   Pack» de <https://vb-audio.com/Cable/>, ejecuta `VBCABLE_Setup_x64.exe` **como
   administrador** y reinicia. En Configuración → Sistema → Sonido deben aparecer «CABLE
   Input» (salida) y «CABLE Output» (entrada); tu salida por defecto sigue siendo tus parlantes.
8. Comprueba: `nexo-control doctor` (abre una consola nueva para que el PATH se actualice).

## Uso diario

NEXO arranca solo al iniciar sesión y deja un **icono en la bandeja** (si no lo ves,
está tras la flecha ^). Menú del icono:

- **Copiar enlace de Internet / Copiar enlace local**: llevan el token; pégalos en el celular.
- **Generar código de emparejamiento**: código `XXXX-XXXX` de un solo uso.
- **Abrir registros**, **Reiniciar NEXO**, **Salir** (detiene todo de forma ordenada).

La dirección de Internet **cambia en cada arranque**. Para recibirla en el celular al
encender la PC, configura el aviso (ntfy o Telegram) en `%APPDATA%\NEXO\nexo-aviso.conf`:

```ini
NEXO_AVISO=ntfy
NTFY_SERVIDOR=https://ntfy.sh
NTFY_TEMA=un-tema-largo-y-secreto
# o: NEXO_AVISO=telegram, TELEGRAM_TOKEN=…, TELEGRAM_CHAT=…
```

Pruébalo con `pwsh -File scripts\windows\nexo-avisar-enlace.ps1 prueba` (no manda el enlace).
La bandeja lanza el vigilante sola si ese archivo existe.

Desde una consola, `nexo-control` hace lo mismo que en Linux:

| Comando | Qué hace |
|---|---|
| `nexo-control start` / `status` / `link` | arrancar, ver estado, mostrar los enlaces |
| `nexo-control stop` / `restart` | detener (la bandeja **no** lo relanza) / reiniciar |
| `nexo-control pair [min]` | código de emparejamiento de un solo uso |
| `nexo-control rotate [-y]` | cambia el token: los enlaces compartidos antes dejan de valer |
| `nexo-control credentials status\|init\|set` | contraseña de «Mi PC» |
| `nexo-control log` | sigue el registro (`%LOCALAPPDATA%\NEXO\logs\nexo-runtime.log`) |
| `nexo-control doctor` | diagnóstico completo |

## Emparejar un dispositivo

1. **Por enlace**: abre el enlace con `?token=…` en el celular. El navegador lo canjea por
   una cookie y la dirección queda limpia. Después entras con usuario y contraseña de «Mi PC».
2. **Por código**: abre la dirección de NEXO *sin token* y escribe el código de
   `nexo-control pair` o del menú de la bandeja.
3. Los dispositivos emparejados se ven y se revocan desde el botón ⓘ.

## Micrófono del celular en Discord, OBS, etc.

Con VB-CABLE instalado, abre NEXO en el celular, toca 🎤 y habla (sigue funcionando con la
pantalla bloqueada). En Discord: Configuración de voz → **Dispositivo de entrada = CABLE
Output**. La página `/microfono` sirve sólo para el micrófono, sin vídeo.

NEXO **nunca** usa tus parlantes como destino: si no encuentra «CABLE Input», el celular
recibe el aviso «VB-CABLE no está instalado…» y el resto de NEXO sigue funcionando. Para
usar otro cable virtual: `NEXO_MIC_DEVICE="parte del nombre"` (p. ej. `Voicemeeter Input`).

## Variables de entorno útiles

| Variable | Efecto |
|---|---|
| `NEXO_MODE` | `local`, `remote` o `both` (por defecto; la bandeja lo usa) |
| `NEXO_GPU=0` | desactiva el vídeo GPU y usa WebRTC por CPU |
| `NEXO_GPU_IDLE_STOP_MS` | espera sin clientes antes de parar NVENC (60 000) |
| `NEXO_STATE_DIR` / `NEXO_LOGS_DIR` | carpeta de estado / de registros |
| `REMOTE_KEYBOARD_PORT`, `NEXO_GPU_WEBRTC_PORT`, `NEXO_GPU_RTP_PORT` | puertos (8765, 9090, 5004) |
| `NEXO_FFMPEG`, `NEXO_AGENT_PATH`, `CLOUDFLARED_PATH` | rutas a los ejecutables |
| `NEXO_MIC_DEVICE` | nombre (o parte) de la salida del cable virtual («CABLE Input») |
| `NEXO_BLOCKED_SHORTCUTS` | atajos extra bloqueados en remoto, p. ej. `meta+l,ctrl+alt+delete` |
| `NEXO_WHEEL_FACTOR` | multiplicador de la rueda del mouse |
| `NEXO_RECREATE_TUNNEL=1` | vigila el túnel y lo recrea si deja de responder |

## Límites conocidos

- **Pantallas protegidas** (bloqueo `Win+L`, UAC, `Ctrl+Alt+Supr`): Windows las dibuja en un
  escritorio al que una aplicación de usuario no accede. NEXO avisa con un banner, pausa
  la captura y la reanuda sola al volver. `Win+L` se bloquea en remoto a propósito.
- **Ventanas de administrador**: sólo se pueden controlar si NEXO corre elevado, que es lo
  que hace la tarea «NEXO». Arrancado a mano sin privilegios, Windows las ignora.
- **Juegos en pantalla completa exclusiva** y cambios de resolución pueden cortar la
  captura unos segundos; vuelve sola.
- **Perfiles 720p y 900p** usan el escalado por CPU (≈ 50–60 % de un núcleo): los filtros
  de escalado en GPU de `ffmpeg` no funcionan con la versión probada. 1080p en monitores
  1080p va directo por GPU (≈ 10 % de un núcleo).
- **Sin segunda sesión** («NEXO independiente») ni pantalla de inicio de sesión.
- **Wake-on-LAN y arranque dual**: GRUB debe arrancar Windows por defecto (o usa
  `grub-reboot` desde Linux). Desactiva el Inicio rápido (el instalador lo ofrece).
- Los `.exe` compilados aquí no están firmados: SmartScreen puede avisar la primera vez.
  No desactives Defender.

## Solución de problemas

Empieza siempre por `nexo-control doctor`: marca **FALLA** (algo roto) y **AVISO** (a revisar).

- **No arranca / «EADDRINUSE»**: `nexo-control stop` limpia también procesos huérfanos. Si
  el puerto cae en un rango reservado por Hyper-V/WSL (`netsh int ipv4 show excludedportrange
  protocol=tcp`), el doctor lo dice; cambia `REMOTE_KEYBOARD_PORT` o `NEXO_GPU_RTP_PORT`.
- **El celular ve negro o «sin vídeo»**: `nexo-control log`; con `NEXO_GPU=0` se prueba la ruta
  por CPU. Si hay un diálogo de UAC o bloqueo abierto, es normal.
- **Por la red local no entra pero por Internet sí**: el equipo está en una red de perfil
  **Público** (NEXO no abre el firewall ahí). Cambia la red a Privada o usa el enlace de Internet.
- **Windows pregunta por el firewall de `node`, `ffmpeg` o `nexo-gpu-webrtc`**: elige sólo
  redes privadas, o ejecuta `install-autostart.ps1` para dejar reglas explícitas.
- **Un clic o una tecla no llega a una ventana**: puede ser una ventana de administrador
  con NEXO sin elevar (el aviso sale en el registro). Instala el autoarranque.
- **El enlace de Internet no abre desde esta misma PC con `curl`**: `curl` de Windows prueba
  IPv6 primero; usa el navegador o `curl -4`.
- **El micrófono no suena en Discord**: comprueba «CABLE Output» como entrada y que
  `nexo-control doctor` marque VB-CABLE como OK.

## Dónde viven los datos

- Estado privado (token, dispositivos, perfil, monitor): `%LOCALAPPDATA%\NEXO\state`.
- Registros: `%LOCALAPPDATA%\NEXO\logs` (`nexo-runtime.log` rota a 5 MiB × 3 y **nunca lleva
  el token**: sale como `token=***`).
- Configuración del aviso: `%APPDATA%\NEXO\nexo-aviso.conf`.
- `install-autostart.ps1` deja esas carpetas legibles sólo por tu usuario, SYSTEM y
  Administradores.

## Pruebas

```powershell
npm test                                   # pruebas unitarias y de integración
pwsh -File scripts\windows\smoke.ps1       # humo de punta a punta en una instancia aparte
pwsh -File scripts\windows\smoke.ps1 -SinEntrada   # sin abrir el Bloc de notas (no toca el escritorio)
```

`smoke.ps1` arranca NEXO con estado temporal en otro puerto, empareja por token, comprueba
`/info`, `/diagnostics` y una captura JPEG, escribe texto en el Bloc de notas y lo lee por
portapapeles, y verifica que al parar no queda ningún proceso. Sin `-SinEntrada` abre una
ventana y teclea: no lo ejecutes mientras alguien usa la PC.

## Desinstalación

```powershell
pwsh -File scripts\windows\uninstall-autostart.ps1
```

Quita la tarea, las reglas «NEXO …» y la entrada del PATH. No toca la carpeta de estado
(`%LOCALAPPDATA%\NEXO`, con los dispositivos emparejados), el inicio de sesión automático
(ejecuta `Autologon64.exe` y pulsa «Disable») ni los ajustes de energía (el script imprime
los comandos para deshacerlos).

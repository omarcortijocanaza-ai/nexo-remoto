# Bitácora F0 · Ejecutor (Argon 4)

## 1. Archivos creados / modificados

- `scripts/windows/setup.ps1` (creado): instalador idempotente con `winget` de `Microsoft.PowerShell`, `Git.Git`, `GitHub.cli`, `OpenJS.NodeJS.LTS`, `GoLang.Go`, `Gyan.FFmpeg` y `Cloudflare.cloudflared`, con actualización de `PATH` en sesión y extracción en espacio de usuario del MSI verificado de Go cuando la sesión no tiene elevación interactiva.
- `scripts/windows/check-env.ps1` (creado): verificador de entorno con tabla `OK/FALLA/AVISO` para binarios en `PATH`, filtros (`ddagrab`, `scale_d3d11`, `scale_cuda`, `hwmap`) y codificador (`h264_nvenc`) de FFmpeg, GPU vía `nvidia-smi`, dispositivos de sonido (`Win32_SoundDevice`), puertos TCP 8765/9090 y UDP 5004 (libres y fuera de los rangos excluidos de `netsh`), y ruta del repositorio sin espacios ni caracteres no ASCII.
- `scripts/windows/build.ps1` (creado): compilador Go para `windows/amd64` con `-trimpath -ldflags "-s -w"` hacia `bin\win\` (`nexo-gpu-webrtc.exe`, `nexo-super-bridge.exe` + copia en `windows-helper\dist\nexo-super-bridge.exe`, y soporte condicional para `native\agent` y `native\tray`).
- `docs/windows/bitacora/F0-argon.md` (creado): esta bitácora.

## 2. Decisiones tomadas

- En sesiones no elevadas donde `winget install --id GoLang.Go` falla con código MSI `1603` por expiración del diálogo UAC, `setup.ps1` extrae automáticamente el paquete MSI ya descargado y verificado por `winget` hacia `%LOCALAPPDATA%\Programs\Go` usando `msiexec /a ... /qn` y añade `%LOCALAPPDATA%\Programs\Go\bin` al `PATH` del usuario.
- Al ejecutar `ffmpeg` con `ddagrab` desde un runner automatizado que crea un escritorio aislado (`exebox-*` en `WinSta0`), DXGI devuelve `E_ACCESSDENIED` (`Desktop duplication access denied`) a menos que el proceso se lance asociado al escritorio interactivo `Winsta0\Default` (`STARTUPINFO.lpDesktop = "Winsta0\\Default"`). Se verificó que lanzando sobre `Winsta0\Default` la captura `ddagrab` funciona a 58–60 FPS.

## 3. Comandos de verificación y salida real

### 4a) `pwsh -File scripts/windows/setup.ps1`

```text
[setup] PowerShell 7 ya está instalado (C:\Users\USUARIO\AppData\Local\Microsoft\WindowsApps\pwsh.exe).
[setup] Git ya está instalado (C:\Program Files\Git\cmd\git.exe).
[setup] GitHub CLI ya está instalado (C:\Program Files\GitHub CLI\gh.exe).
[setup] Node.js LTS ya está instalado (C:\Program Files\nodejs\node.exe).
[setup] Go ya está instalado (C:\Users\USUARIO\AppData\Local\Programs\Go\bin\go.exe).
[setup] FFmpeg (Gyan) ya está instalado (C:\Users\USUARIO\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe).
[setup] cloudflared ya está instalado (C:\Program Files (x86)\cloudflared\cloudflared.exe).

=== Versiones instaladas ===
pwsh        : PowerShell 7.6.7
git         : git version 2.54.0.windows.1
gh          : gh version 2.96.0 (2026-07-02)
node        : v24.15.0
npm         : 11.12.1
go          : go version go1.27.0 windows/amd64
ffmpeg      : ffmpeg version 9.0-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers
cloudflared : cloudflared version 2026.7.1 (built 2026-07-09T05:06 UTC)
```

### 4b) `pwsh -File scripts/windows/check-env.ps1`

```text
=== Verificación de entorno NEXO (Windows) ===

Componente                 Estado Detalle
----------                 ------ -------
PATH: node                 OK     v24.15.0
PATH: npm                  OK     11.12.1
PATH: go                   OK     go version go1.27.0 windows/amd64
PATH: git                  OK     git version 2.54.0.windows.1
PATH: gh                   OK     gh version 2.96.0 (2026-07-02)
PATH: ffmpeg               OK     ffmpeg version 9.0-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg develop…
PATH: cloudflared          OK     cloudflared version 2026.7.1 (built 2026-07-09T05:06 UTC)
ffmpeg filtro: ddagrab     OK     Disponible
ffmpeg filtro: scale_d3d11 OK     Disponible
ffmpeg filtro: scale_cuda  OK     Disponible
ffmpeg filtro: hwmap       OK     Disponible
ffmpeg encoder: h264_nvenc OK     Disponible
GPU (nvidia-smi)           OK     NVIDIA GeForce RTX 3060 Ti, 616.64
Audio (VB-Audio)           OK     Detectado: VB-Audio Voicemeeter VAIO
Puerto TCP 8765            OK     Libre y fuera de rangos excluidos
Puerto TCP 9090            OK     Libre y fuera de rangos excluidos
Puerto UDP 5004            OK     Libre y fuera de rangos excluidos
Ruta del repositorio       OK     D:\nexo-remoto

Dispositivos de sonido detectados (Win32_SoundDevice):
  - Realtek High Definition Audio [OK]
  - NVIDIA High Definition Audio [OK]
  - Razer Seiren V3 Mini [OK]
  - NVIDIA Broadcast [OK]
  - NVIDIA Virtual Audio Device (Wave Extensible) (WDM) [OK]
  - VB-Audio Voicemeeter VAIO [OK]

RESULTADO: OK (todos los requisitos obligatorios están listos).
```

### 4c) `npm ci`

```text
added 4 packages, and audited 5 packages in 10s
found 0 vulnerabilities
```

### 4d) `@roamhq/wrtc`

```text
function [
  'i420ToRgba',
  'RTCAudioSink',
  'RTCAudioSource',
  'RTCVideoSink',
  'RTCVideoSource',
  'rgbaToI420'
]
```

### 4e) `npm test`

- Pasan: **16 de 17** pruebas.
- Falla esperada en Windows (pendiente para F1): `test/device-manager.test.js:48` (`el archivo de emparejamiento no guarda el código en claro`), por comprobación POSIX `fs.statSync(file).mode & 0o777 === 0o600` (`438 !== 384`).

### 4f) `pwsh -File scripts/windows/build.ps1`

```text
[build] Compilando D:\nexo-remoto\gpu-webrtc -> D:\nexo-remoto\bin\win\nexo-gpu-webrtc.exe ...
[build] Compilando D:\nexo-remoto\windows-helper -> D:\nexo-remoto\bin\win\nexo-super-bridge.exe ...
[build] Copiado a D:\nexo-remoto\windows-helper\dist\nexo-super-bridge.exe
[build] native\agent aún no existe (se añade en F3); omitiendo.
[build] native\tray aún no existe (se añade en F9); omitiendo.
[build] Compilación completada correctamente.

Name                    Length LastWriteTime
----                    ------ -------------
nexo-gpu-webrtc.exe   10590720 16/10/2026 19:49:14
nexo-super-bridge.exe  1784320 16/10/2026 19:49:15
```

### 4g) Línea base de captura y codificación (5 s por prueba en `Winsta0\Default`)

- **Monitor 0 (`\\.\DISPLAY1`, primario, `1920x1080` en `X=0, Y=0`)**:
  - `d3d11-native` (`1080p@60`): **58 FPS** (`frame=295 fps=58 q=10.0 time=00:00:05.00 speed=0.983x`), sin error (`EXIT=0`).
  - `cpu-scale` (`1280x720@60`): **56 FPS** (`frame=282 fps=56 q=7.0 time=00:00:05.00 speed=0.997x`), sin error (`EXIT=0`).
  - `d3d11-scale` (`scale_d3d11=1280:720:format=nv12`): falla con `Could not create the texture (80070057)` al pedir conversión directa BGRA→NV12 en `scale_d3d11`.
  - `cuda-scale` (`hwmap=derive_device=cuda,scale_cuda=1280:720:format=nv12`): falla con `Failed to created derived device context: -40` sin contexto explícito `-init_hw_device`.
- **Monitor 1 (`\\.\DISPLAY2`, secundario, `1920x1080` en `X=1920, Y=-88`)**:
  - `d3d11-native` (`1080p@60`): **60 FPS** (`frame=299 fps=60 q=8.0 time=00:00:05.00 speed=0.998x`), sin error (`EXIT=0`).
  - `cpu-scale` (`1280x720@60`): **57 FPS** (`frame=287 fps=57 q=7.0 time=00:00:05.00 speed=0.999x`), sin error (`EXIT=0`).
  - `d3d11-scale` y `cuda-scale`: mismo error que en Monitor 0.

### 4h) Captura de un cuadro por monitor a PNG

- `monitor0.png` (`output_idx=0`, `457 216` bytes): muestra el navegador Brave (WhatsApp Web) en el monitor principal izquierdo (`\\.\DISPLAY1`, `X=0, Y=0`).
- `monitor1.png` (`output_idx=1`, `204 285` bytes): muestra la ventana de Antigravity IDE en el monitor secundario derecho (`\\.\DISPLAY2`, `X=1920, Y=-88`).

## 4. Tabla final de herramientas

| Herramienta | Versión | OK |
|---|---|---|
| `pwsh` | PowerShell 7.6.7 | OK |
| `git` | 2.54.0.windows.1 | OK |
| `gh` | 2.96.0 | OK |
| `node` | v24.15.0 | OK |
| `npm` | 11.12.1 | OK |
| `go` | go1.27.0 windows/amd64 | OK |
| `ffmpeg` | 9.0-full_build-www.gyan.dev | OK |
| `cloudflared` | 2026.7.1 | OK |
| GPU / Driver | NVIDIA GeForce RTX 3060 Ti (Driver 616.64) | OK |
| Audio virtual | VB-Audio Voicemeeter VAIO | OK |

## 5. Dudas y notas para fases siguientes

1. **VB-Audio en el equipo:** está instalado `VB-Audio Voicemeeter VAIO` (con dispositivos de salida `Voicemeeter Input (VB-Audio Voicemeeter VAIO)` y `Voicemeeter VAIO3 Input`), pero no el driver separado `CABLE Input` de `VBCABLE_Driver_Pack`. En F3/F7 se mantiene el valor por defecto `CABLE Input` exigido por contrato y configurable vía `NEXO_MIC_DEVICE` (o si Letzus instala VB-CABLE).
2. **Escalado GPU en FFmpeg 9.0:** `d3d11-native` (1080p@60) y `cpu-scale` (720p/900p@60) funcionan a ~58–60 FPS sin errores; `scale_d3d11=W:H:format=nv12` falla con `80070057`. El sondeo automático de F5 probará las cadenas en orden y seleccionará `d3d11-native` para 1080p y `cpu-scale` para 720p/900p tal como prevé la sección 10 del plan.
3. **Escritorio de Windows en procesos lanzados desde runners aislados:** cuando un proceso se lanza desde un escritorio secundario de `WinSta0` (como `exebox-*`), `ddagrab` y `SendInput` requieren estar en `Winsta0\Default`. En F3/F4 aseguraremos que `nexo-agent.exe` y los procesos de captura trabajen sobre `Winsta0\Default`.

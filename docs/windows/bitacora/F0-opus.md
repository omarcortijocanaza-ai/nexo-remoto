# Bitácora F0 · Revisor (Opus 5.5)

## Veredicto: APROBADO

## 1. Verificaciones del revisor

1. **Idempotencia de `setup.ps1`:** ejecutado dos veces seguidas en `pwsh -NoProfile`; detecta todas las herramientas ya instaladas y no reinstala nada (`EXIT=0`).
2. **Detección real de fallas en `check-env.ps1`:** probado recortando `FFmpeg` de `$env:PATH`; muestra `FALLA` en `PATH: ffmpeg`, `ffmpeg filtro: ddagrab` y `ffmpeg encoder: h264_nvenc`, y termina con código `1` (`EXIT_NO_FFMPEG=1`).
3. **Puertos excluidos (`netsh` en español):** comprobado contra la salida real en español (`Puerto de inicio / Puerto final`, rango `50000–50059`); la expresión regular `^\s*(\d+)\s+(\d+)\b` extrae los intervalos sin depender del idioma.
4. **Fallo controlado de `build.ps1`:** probado con un `go.mod` inválido en un árbol temporal (`$env:NEXO_REPO_ROOT`); aborta inmediatamente con mensaje claro y código de salida `1` (`EXIT_BROKEN_BUILD=1`). En el repositorio real genera `bin\win\nexo-gpu-webrtc.exe` (10,59 MB) y `bin\win\nexo-super-bridge.exe` (1,78 MB, más copia en `windows-helper\dist\nexo-super-bridge.exe`).
5. **Cifras de línea base:** 58–60 FPS sostenidos con `ddagrab` + `h264_nvenc` a 1080p@60 y 56–57 FPS con `cpu-scale` a 720p@60 en la RTX 3060 Ti.

## 2. Defectos encontrados y corregidos

- En la primera versión de `check-env.ps1`, encadenar `& $cmd.Source ... | Select-Object -First 1` antes de evaluar `$LASTEXITCODE` provocaba un falso negativo en la primera fila (`node`). Se corrigió capturando la salida completa del proceso antes de inspeccionar `$LASTEXITCODE` tanto en el bucle de herramientas como en `nvidia-smi`.

## 3. Tabla definitiva de cadenas FFmpeg (sección 4.5) y monitores

### Cadenas de captura/codificación con FFmpeg 9.0-full_build (`Gyan.FFmpeg`)

| Cadena | Estado en este equipo | Medición (RTX 3060 Ti) | Uso en F5 |
|---|---|---|---|
| `d3d11-native` | **Funcional** | 58 FPS (mon 0) / 60 FPS (mon 1) a 1920×1080@60 | Ruta principal para el perfil por defecto (1080p en monitores 1080p) |
| `d3d11-scale` | Falla al inicializar textura (`80070057`) con `format=nv12` directo desde BGRA | — | El sondeo de F5 la probará y pasará automáticamente a la siguiente |
| `cuda-scale` | Falla en `hwmap=derive_device=cuda` dentro de `lavfi` (`-40`) | — | El sondeo de F5 la probará y pasará automáticamente a la siguiente |
| `cpu-scale` | **Funcional** | 56 FPS (mon 0) / 57 FPS (mon 1) a 1280×720@60 | Ruta para perfiles reescalados (720p y 900p) |
| `gdigrab` | **Funcional** (con formato explícito) | Respaldo GDI | Último recurso |

### Orden y geometría real de monitores

| `output_idx` (`ddagrab`) | Nombre Win32 | Posición física | Coordenadas escritorio virtual | Resolución | Primario |
|---|---|---|---|---|---|
| `0` | `\\.\DISPLAY1` | Izquierdo (principal) | `X=0, Y=0` | `1920×1080` | Sí |
| `1` | `\\.\DISPLAY2` | Derecho (secundario) | `X=1920, Y=-88` | `1920×1080` | No |

> **Nota crítica para F3 (`SendInput` y escritorio virtual):** el monitor secundario tiene `Y = -88`, por lo que el escritorio virtual tiene origen `(vx = 0, vy = -88)` y dimensiones `3840 × 1168`. La normalización `0..65535` de `MOUSEEVENTF_VIRTUALDESK` en `nexo-agent.exe` debe restar `(vx, vy)` tal como especifica la sección 4.2.

## 4. Desviaciones aceptadas y pendientes para fases siguientes

- El repositorio reside en `D:\nexo-remoto` (cumple la regla de no tener espacios ni acentos).
- El sistema cuenta con `VB-Audio Voicemeeter VAIO` activo; para F7 se respetará el valor por defecto `CABLE Input` del contrato (configurable mediante `NEXO_MIC_DEVICE`).
- En ejecuciones lanzadas desde entornos aislados que crean un escritorio secundario en `WinSta0` (`exebox-*`), `ddagrab` y `SendInput` requieren ejecutarse en `Winsta0\Default`. En F3 y F4 nos aseguraremos de asociar el agente y los subprocesos de captura a `Winsta0\Default`.

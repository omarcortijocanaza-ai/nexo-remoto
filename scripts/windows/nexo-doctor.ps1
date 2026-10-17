# Diagnóstico de NEXO en Windows. Equivalente del `nexo-doctor` de Linux.
# Comprueba herramientas, binarios, servidor, procesos, privilegios, permisos de
# la carpeta de estado, firewall, tarea programada, VB-CABLE y la cadena de vídeo
# GPU recordada. NUNCA imprime el token. Código de salida 0 sin FALLAS, 1 con ellas
# (los AVISO no cuentan: son cosas a revisar, no averías).
#
# Uso: nexo-control doctor    (o: pwsh -File scripts\windows\nexo-doctor.ps1)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DirNexo = if ($env:NEXO_STATE_DIR) { Split-Path -Parent $env:NEXO_STATE_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO' }
$DirEstado = if ($env:NEXO_STATE_DIR) { $env:NEXO_STATE_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO\state' }
$ArchivoEstado = Join-Path $DirEstado '.nexo-state.json'

$script:fallas = 0
$script:avisos = 0
function Add-Check {
    param([string] $Componente, [ValidateSet('OK', 'FALLA', 'AVISO')] [string] $Estado, [string] $Detalle = '')
    if ($Estado -eq 'FALLA') { $script:fallas++ } elseif ($Estado -eq 'AVISO') { $script:avisos++ }
    $color = switch ($Estado) { 'OK' { 'Green' } 'FALLA' { 'Red' } default { 'Yellow' } }
    Write-Host ('{0,-6} ' -f $Estado) -ForegroundColor $color -NoNewline
    Write-Host ('{0,-34} {1}' -f $Componente, $Detalle)
}
function Test-Seccion([string] $Titulo, [scriptblock] $Bloque) {
    Write-Host "`n── $Titulo" -ForegroundColor Cyan
    try { & $Bloque } catch { Add-Check $Titulo 'FALLA' "la comprobación falló: $($_.Exception.Message)" }
}

function Get-Estado { try { Get-Content -LiteralPath $ArchivoEstado -Raw -Encoding utf8 -ErrorAction Stop | ConvertFrom-Json } catch { $null } }
$estado = Get-Estado
$puerto = if ($env:REMOTE_KEYBOARD_PORT) { [int]$env:REMOTE_KEYBOARD_PORT } elseif ($estado -and $estado.port) { [int]$estado.port } else { 8765 }

# ¿Está elevado el proceso con este PID? (TokenElevation; sin elevar no se puede
# abrir un proceso elevado: eso mismo ya indica que lo está.)
Add-Type -Namespace Nexo -Name Elevacion -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint acceso, bool heredar, int pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
[DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr proceso, uint acceso, out IntPtr token);
[DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr token, int clase, out int valor, int largo, out int devuelto);
public static string Elevado(int pid) {
    IntPtr p = OpenProcess(0x1000, false, pid);
    if (p == IntPtr.Zero) return "desconocido";
    IntPtr t;
    try {
        // Acceso denegado al token de un proceso del mismo usuario = está elevado y quien pregunta no.
        if (!OpenProcessToken(p, 0x8, out t)) return Marshal.GetLastWin32Error() == 5 ? "si" : "desconocido";
        try { int v; int n; return GetTokenInformation(t, 20, out v, 4, out n) ? (v != 0 ? "si" : "no") : "desconocido"; }
        finally { CloseHandle(t); }
    } finally { CloseHandle(p); }
}
'@ -ErrorAction SilentlyContinue

Write-Host "NEXO · doctor ($DirEstado)" -ForegroundColor White

Test-Seccion 'Herramientas' {
    $nodo = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodo) { Add-Check 'node' 'FALLA' 'no está en el PATH (scripts\windows\setup.ps1)' }
    else {
        $version = (& $nodo.Source --version)
        Add-Check 'node' $(if ($version -match '^v24\.') { 'OK' } else { 'AVISO' }) "$version$(if ($version -notmatch '^v24\.') { ' (se esperaba v24.x)' })"
    }
    $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $ffmpeg) { Add-Check 'ffmpeg' 'FALLA' 'no está en el PATH (winget install Gyan.FFmpeg)' }
    else {
        $filtros = (& $ffmpeg.Source -hide_banner -filters 2>&1) -join "`n"
        $codificadores = (& $ffmpeg.Source -hide_banner -encoders 2>&1) -join "`n"
        Add-Check 'ffmpeg · ddagrab' $(if ($filtros -match '\bddagrab\b') { 'OK' } else { 'FALLA' }) 'captura de escritorio por DXGI'
        Add-Check 'ffmpeg · h264_nvenc' $(if ($codificadores -match 'h264_nvenc') { 'OK' } else { 'FALLA' }) 'codificador de la RTX'
    }
    $tunel = Get-Command cloudflared -ErrorAction SilentlyContinue
    Add-Check 'cloudflared' $(if ($tunel) { 'OK' } else { 'AVISO' }) $(if ($tunel) { $tunel.Source } else { 'sin él no hay acceso por Internet (winget install Cloudflare.cloudflared)' })
    $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($nvidia) { $gpu = (& $nvidia.Source --query-gpu=name,driver_version --format=csv,noheader 2>$null) -join ''; Add-Check 'GPU NVIDIA' 'OK' $gpu }
    else { Add-Check 'GPU NVIDIA' 'AVISO' 'nvidia-smi no responde: sin NVENC el vídeo cae al respaldo por CPU' }
    Add-Check 'ruta del repositorio' $(if ($Raiz -match '\s|[^\x00-\x7F]') { 'AVISO' } else { 'OK' }) $(if ($Raiz -match '\s|[^\x00-\x7F]') { "$Raiz (espacios o acentos pueden romper herramientas)" } else { $Raiz })
}

Test-Seccion 'Binarios compilados (scripts\windows\build.ps1)' {
    foreach ($par in @(@('nexo-agent.exe', 'FALLA'), @('nexo-gpu-webrtc.exe', 'FALLA'), @('nexo-tray.exe', 'AVISO'), @('nexo-super-bridge.exe', 'AVISO'))) {
        $ruta = Join-Path $Raiz "bin\win\$($par[0])"
        Add-Check $par[0] $(if (Test-Path -LiteralPath $ruta) { 'OK' } else { $par[1] }) $(if (Test-Path -LiteralPath $ruta) { "$([math]::Round((Get-Item -LiteralPath $ruta).Length / 1MB, 1)) MB" } else { 'falta: ejecuta scripts\windows\build.ps1' })
    }
    Add-Check 'SmartScreen' 'OK' 'los .exe compilados aquí no están firmados: Windows puede avisar la primera vez; es normal, no desactives Defender'
}

Test-Seccion 'Servidor' {
    $vivo = $false
    try { $vivo = (Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/health" -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200 } catch {}
    Add-Check 'servidor HTTP' $(if ($vivo) { 'OK' } else { 'FALLA' }) "puerto $puerto$(if (-not $vivo) { ' (nexo-control start)' })"
    if ($estado) {
        Add-Check 'archivo de estado' 'OK' "modo $($estado.mode), estado $($estado.status)"
        Add-Check 'enlace de Internet' $(if ($estado.remoteUrl) { 'OK' } elseif ($estado.mode -eq 'local') { 'OK' } else { 'AVISO' }) $(if ($estado.remoteUrl) { 'publicado (no se muestra aquí)' } elseif ($estado.mode -eq 'local') { 'modo local: sin túnel' } else { 'el túnel aún no lo ha publicado' })
    } else { Add-Check 'archivo de estado' 'AVISO' "no existe $ArchivoEstado (NEXO no ha arrancado todavía)" }
    $credenciales = Join-Path $DirEstado '.nexo-auth.json'
    Add-Check 'credenciales de Mi PC' $(if (Test-Path -LiteralPath $credenciales) { 'OK' } else { 'AVISO' }) $(if (Test-Path -LiteralPath $credenciales) { 'configuradas' } else { 'sin contraseña: nexo-control credentials init' })
}

Test-Seccion 'Procesos y privilegios' {
    $procesos = Get-CimInstance Win32_Process
    # NEXO corre elevado (tarea con privilegios máximos) y a una consola normal Windows
    # le oculta su línea de órdenes: se identifica por los PID que anota el lanzador
    # en .nexo-pids.json, comprobando que la imagen sea la esperada.
    $registrados = @{}
    try {
        $datos = Get-Content -LiteralPath (Join-Path $DirEstado '.nexo-pids.json') -Raw -Encoding utf8 -ErrorAction Stop | ConvertFrom-Json
        foreach ($rol in 'launcher', 'server', 'gpu', 'tunnel') { if ($datos.$rol.pid) { $registrados[$rol] = [int]$datos.$rol.pid } }
    } catch {}
    $buscar = {
        param($rol, $imagen, $patron)
        $proceso = $procesos | Where-Object { $_.ProcessId -eq $registrados[$rol] -and $_.Name -eq $imagen } | Select-Object -First 1
        if (-not $proceso) { $proceso = $procesos | Where-Object { $_.Name -eq $imagen -and [string]$_.CommandLine -match $patron } | Select-Object -First 1 }
        return $proceso
    }
    $lanzador = & $buscar 'launcher' 'node.exe' 'launcher\.js'
    Add-Check 'lanzador' $(if ($lanzador) { 'OK' } else { 'AVISO' }) $(if ($lanzador) { "PID $($lanzador.ProcessId)" } else { 'no hay lanzador activo' })
    Add-Check 'servidor (node)' $(if (& $buscar 'server' 'node.exe' 'server\.js') { 'OK' } else { 'AVISO' }) ''
    Add-Check 'agente nativo' $(if ($procesos | Where-Object { $_.Name -eq 'nexo-agent.exe' }) { 'OK' } else { 'AVISO' }) ''
    $enModoLocal = $estado -and $estado.mode -eq 'local'
    Add-Check 'túnel (cloudflared)' $(if (& $buscar 'tunnel' 'cloudflared.exe' 'cloudflared') { 'OK' } elseif ($enModoLocal) { 'OK' } else { 'AVISO' }) $(if ($enModoLocal) { 'modo local: no se usa' } else { '' })
    Add-Check 'bandeja' $(if ($procesos | Where-Object { $_.Name -eq 'nexo-tray.exe' }) { 'OK' } else { 'AVISO' }) 'nexo-tray.exe'
    if ($lanzador) {
        $elevado = [Nexo.Elevacion]::Elevado([int]$lanzador.ProcessId)
        # Sin privilegios, UIPI impide controlar ventanas de administrador (Administrador de tareas, instaladores).
        Add-Check 'NEXO con privilegios elevados' $(if ($elevado -eq 'si') { 'OK' } else { 'AVISO' }) $(if ($elevado -eq 'si') { 'sí: puede controlar ventanas de administrador' } elseif ($elevado -eq 'no') { 'no: Windows bloqueará la entrada sobre ventanas de administrador (instala el autoarranque)' } else { 'no se pudo comprobar' })
    }
}

Test-Seccion 'Permisos de la carpeta privada' {
    if (-not (Test-Path -LiteralPath $DirNexo)) { Add-Check $DirNexo 'AVISO' 'no existe todavía'; return }
    $permitidos = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    $extras = foreach ($regla in (Get-Acl -LiteralPath $DirNexo).Access) {
        if ($regla.AccessControlType -ne 'Allow') { continue }
        try { $sid = $regla.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = [string]$regla.IdentityReference }
        if ($sid -notin $permitidos) { [string]$regla.IdentityReference }
    }
    if ($extras) { Add-Check $DirNexo 'FALLA' "otros pueden leer el token: $(($extras | Select-Object -Unique) -join ', ') (ejecuta install-autostart.ps1)" }
    else { Add-Check $DirNexo 'OK' 'sólo tu usuario, SYSTEM y Administradores' }
}

Test-Seccion 'Firewall' {
    $reglas = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue | ForEach-Object {
        $app = $_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        if ($app.Program -and $app.Program -match 'nexo-gpu-webrtc|nexo-remoto|\\nodejs\\node\.exe|ffmpeg\.exe') { [pscustomobject]@{ Nombre = $_.DisplayName; Perfil = [string]$_.Profile; Programa = $app.Program } }
    }
    # -clike: Windows crea reglas «nexo-gpu-webrtc» al preguntar (perfil Público incluido); sólo cuentan las «NEXO …» del instalador.
    $propias = @($reglas | Where-Object { $_.Nombre -clike 'NEXO *' -and $_.Perfil -notmatch 'Public|Any' })
    $publicas = @($reglas | Where-Object { $_.Perfil -match 'Public|Any' -or $_.Perfil -eq '0' })
    Add-Check 'reglas «NEXO …» (perfil Privado)' $(if ($propias.Count) { 'OK' } else { 'AVISO' }) $(if ($propias.Count) { "$($propias.Count) regla(s)" } else { 'ninguna: ejecuta install-autostart.ps1 o Windows preguntará al primer uso' })
    if ($publicas.Count) { Add-Check 'reglas abiertas al perfil Público' 'AVISO' "$($publicas.Count): $(($publicas | ForEach-Object { $_.Nombre } | Select-Object -Unique) -join ', ') (en una red pública NEXO sería alcanzable)" }
    else { Add-Check 'sin reglas en perfil Público' 'OK' '' }
}

Test-Seccion 'Autoarranque' {
    $tarea = Get-ScheduledTask -TaskName 'NEXO' -ErrorAction SilentlyContinue
    if (-not $tarea) { Add-Check 'tarea programada NEXO' 'AVISO' 'no instalada (scripts\windows\install-autostart.ps1)'; return }
    $alto = $tarea.Principal.RunLevel -eq 'Highest'
    $alIniciar = [bool]($tarea.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon' })
    Add-Check 'tarea programada NEXO' $(if ($alto -and $alIniciar) { 'OK' } else { 'AVISO' }) "estado $($tarea.State); privilegios más altos: $(if ($alto) { 'sí' } else { 'NO' }); al iniciar sesión: $(if ($alIniciar) { 'sí' } else { 'NO' })"
}

Test-Seccion 'Audio y vídeo' {
    $agente = Join-Path $Raiz 'bin\win\nexo-agent.exe'
    if (Test-Path -LiteralPath $agente) {
        try {
            $info = (& $agente audio-devices) -join '' | ConvertFrom-Json
            $coincide = if ($env:NEXO_MIC_DEVICE) { $env:NEXO_MIC_DEVICE } else { 'CABLE Input' }
            $hay = $info.outputs | Where-Object { $_.name -like "*$coincide*" }
            Add-Check "VB-CABLE ($coincide)" $(if ($hay) { 'OK' } else { 'AVISO' }) $(if ($hay) { 'el micrófono del celular tiene destino' } else { 'no instalado: el micrófono del celular no funcionará (README-WINDOWS.md)' })
            Add-Check 'salida de audio por defecto' 'OK' (($info.outputs | Where-Object { $_.default } | ForEach-Object { $_.name }) -join '')
        } catch { Add-Check 'dispositivos de audio' 'AVISO' "no se pudieron listar: $($_.Exception.Message)" }
    }
    $cadena = Join-Path $DirEstado '.nexo-gpu-pipeline.json'
    if (Test-Path -LiteralPath $cadena) {
        $datos = Get-Content -LiteralPath $cadena -Raw -Encoding utf8 | ConvertFrom-Json
        Add-Check 'cadena de vídeo GPU recordada' 'OK' "$($datos.chain)$(if ($datos.scaleChain) { " (reescalado: $($datos.scaleChain))" })"
    } else { Add-Check 'cadena de vídeo GPU recordada' 'AVISO' 'aún sin sondear (se sondea al primer cliente)' }
}

Test-Seccion 'Puertos reservados por Windows (Hyper-V / WSL)' {
    $excluidos = foreach ($protocolo in 'tcp', 'udp') {
        foreach ($linea in (netsh int ipv4 show excludedportrange protocol=$protocolo)) {
            if ($linea -match '^\s*(\d+)\s+(\d+)\b') { [pscustomobject]@{ Proto = $protocolo; Desde = [int]$Matches[1]; Hasta = [int]$Matches[2] } }
        }
    }
    foreach ($par in @(@(8765, 'tcp'), @(9090, 'tcp'), @(5004, 'udp'))) {
        $dentro = $excluidos | Where-Object { $_.Proto -eq $par[1] -and $par[0] -ge $_.Desde -and $par[0] -le $_.Hasta } | Select-Object -First 1
        Add-Check "puerto $($par[0])/$($par[1])" $(if ($dentro) { 'FALLA' } else { 'OK' }) $(if ($dentro) { "dentro del rango reservado $($dentro.Desde)-$($dentro.Hasta): cambia NEXO_GPU_RTP_PORT / REMOTE_KEYBOARD_PORT" } else { 'fuera de rangos reservados' })
    }
}

Write-Host ''
if ($script:fallas -eq 0) {
    Write-Host "Resultado: todo correcto$(if ($script:avisos) { " ($($script:avisos) aviso(s) por revisar)" })." -ForegroundColor Green
    exit 0
}
Write-Host "Resultado: $($script:fallas) comprobación(es) requieren atención y $($script:avisos) aviso(s)." -ForegroundColor Red
exit 1

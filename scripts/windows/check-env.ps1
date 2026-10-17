#Requires -Version 5.1
# Comprueba el entorno de ejecución y compilación de NEXO en Windows.
# Devuelve código de salida 0 si todo lo obligatorio está en orden, o 1 si hay alguna falla.

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:hasFailure = $false
$rows = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param(
        [string]$Item,
        [bool]$Ok,
        [string]$Detail,
        [bool]$Mandatory = $true
    )
    $status = if ($Ok) { 'OK' } elseif ($Mandatory) { 'FALLA' } else { 'AVISO' }
    if (-not $Ok -and $Mandatory) {
        $script:hasFailure = $true
    }
    $rows.Add([PSCustomObject]@{
        Componente  = $Item
        Estado      = $status
        Detalle     = $Detail
    })
}

# 1. Herramientas en PATH y versión
$tools = @(
    @{ Name = 'node';        Args = @('--version') },
    @{ Name = 'npm';         Args = @('--version') },
    @{ Name = 'go';          Args = @('version') },
    @{ Name = 'git';         Args = @('--version') },
    @{ Name = 'gh';          Args = @('--version') },
    @{ Name = 'ffmpeg';      Args = @('-version') },
    @{ Name = 'cloudflared'; Args = @('--version') }
)

foreach ($t in $tools) {
    $cmd = Get-Command $t.Name -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        Add-Check -Item "PATH: $($t.Name)" -Ok $false -Detail "No encontrado en PATH"
    } else {
        $global:LASTEXITCODE = 0
        $verOut = @(& $cmd.Source @($t.Args) 2>&1)
        $exitCode = $LASTEXITCODE
        $verStr = if ($verOut.Count -gt 0) { ([string]$verOut[0]).Trim() } else { '' }
        $ok = ($exitCode -eq 0) -and ($verStr.Length -gt 0)
        if ($t.Name -eq 'node' -and $verStr -notmatch '^v24\.') {
            $ok = $false
            $verStr = "$verStr (se esperaba v24.x)"
        }
        Add-Check -Item "PATH: $($t.Name)" -Ok $ok -Detail $verStr
    }
}

# 2. Filtros y codificadores de FFmpeg
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($null -ne $ffmpegCmd) {
    $filtersText = (& $ffmpegCmd.Source -hide_banner -filters 2>&1 | Out-String)
    $hasDdagrab = $filtersText -match '\bddagrab\b'
    Add-Check -Item 'ffmpeg filtro: ddagrab' -Ok $hasDdagrab -Detail ($(if ($hasDdagrab) { 'Disponible' } else { 'Falta ddagrab' }))

    foreach ($optFilter in @('scale_d3d11', 'scale_cuda', 'hwmap')) {
        $present = $filtersText -match "\b$optFilter\b"
        Add-Check -Item "ffmpeg filtro: $optFilter" -Ok $present -Detail ($(if ($present) { 'Disponible' } else { 'No disponible (opcional)' })) -Mandatory $false
    }

    $encodersText = (& $ffmpegCmd.Source -hide_banner -encoders 2>&1 | Out-String)
    $hasNvenc = $encodersText -match '\bh264_nvenc\b'
    Add-Check -Item 'ffmpeg encoder: h264_nvenc' -Ok $hasNvenc -Detail ($(if ($hasNvenc) { 'Disponible' } else { 'Falta h264_nvenc' }))
} else {
    Add-Check -Item 'ffmpeg filtro: ddagrab' -Ok $false -Detail 'ffmpeg no disponible'
    Add-Check -Item 'ffmpeg encoder: h264_nvenc' -Ok $false -Detail 'ffmpeg no disponible'
}

# 3. GPU NVIDIA (nvidia-smi)
$smiCmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($null -ne $smiCmd) {
    $global:LASTEXITCODE = 0
    $gpuLines = @(& $smiCmd.Source --query-gpu=name,driver_version --format=csv,noheader 2>&1)
    $smiExit = $LASTEXITCODE
    $gpuInfo = if ($gpuLines.Count -gt 0) { ([string]$gpuLines[0]).Trim() } else { '' }
    $smiOk = ($smiExit -eq 0) -and ($gpuInfo.Length -gt 0)
    Add-Check -Item 'GPU (nvidia-smi)' -Ok $smiOk -Detail $gpuInfo
} else {
    Add-Check -Item 'GPU (nvidia-smi)' -Ok $false -Detail 'nvidia-smi no encontrado en PATH'
}

# 4. Dispositivos de audio (Win32_SoundDevice)
$soundDevices = @(Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue)
$deviceNames = @($soundDevices | ForEach-Object { $_.Name })
$vbDevice = $deviceNames | Where-Object { $_ -match 'VB-Audio' }
if ($vbDevice) {
    Add-Check -Item 'Audio (VB-Audio)' -Ok $true -Detail ("Detectado: " + ($vbDevice -join ', '))
} else {
    Add-Check -Item 'Audio (VB-Audio)' -Ok $false -Detail ("AVISO: No se detectó dispositivo VB-Audio (VB-CABLE). Detectados: " + ($deviceNames -join ', ')) -Mandatory $false
}

# 5. Puertos libres y fuera de rangos excluidos de netsh
function Get-ExcludedPortRanges {
    param([string]$Protocol)
    $ranges = @()
    $out = & netsh int ipv4 show excludedportrange protocol=$Protocol 2>&1
    foreach ($line in $out) {
        # Coincide independientemente del idioma del sistema ("Puerto de inicio" o "Start Port")
        if ($line -match '^\s*(\d+)\s+(\d+)\b') {
            $ranges += [PSCustomObject]@{
                Start = [int]$Matches[1]
                End   = [int]$Matches[2]
            }
        }
    }
    return $ranges
}

function Test-PortInExcludedRanges {
    param([int]$Port, [array]$Ranges)
    foreach ($r in $Ranges) {
        if ($Port -ge $r.Start -and $Port -le $r.End) {
            return "$($r.Start)-$($r.End)"
        }
    }
    return $null
}

$tcpExcluded = Get-ExcludedPortRanges -Protocol 'tcp'
$udpExcluded = Get-ExcludedPortRanges -Protocol 'udp'

foreach ($tcpPort in @(8765, 9090)) {
    $inUse = Get-NetTCPConnection -LocalPort $tcpPort -State Listen -ErrorAction SilentlyContinue
    $excl = Test-PortInExcludedRanges -Port $tcpPort -Ranges $tcpExcluded
    if ($null -ne $inUse) {
        Add-Check -Item "Puerto TCP $tcpPort" -Ok $false -Detail "Ocupado (PID $($inUse[0].OwningProcess))"
    } elseif ($null -ne $excl) {
        Add-Check -Item "Puerto TCP $tcpPort" -Ok $false -Detail "En rango excluido de Windows ($excl)"
    } else {
        Add-Check -Item "Puerto TCP $tcpPort" -Ok $true -Detail "Libre y fuera de rangos excluidos"
    }
}

$udpPort = 5004
$udpInUse = Get-NetUDPEndpoint -LocalPort $udpPort -ErrorAction SilentlyContinue
$udpExcl = Test-PortInExcludedRanges -Port $udpPort -Ranges $udpExcluded
if ($null -ne $udpInUse) {
    Add-Check -Item "Puerto UDP $udpPort" -Ok $false -Detail "Ocupado (PID $($udpInUse[0].OwningProcess))"
} elseif ($null -ne $udpExcl) {
    Add-Check -Item "Puerto UDP $udpPort" -Ok $false -Detail "En rango excluido de Windows ($udpExcl)"
} else {
    Add-Check -Item "Puerto UDP $udpPort" -Ok $true -Detail "Libre y fuera de rangos excluidos"
}

# 6. Ruta del repositorio sin espacios ni caracteres no ASCII
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hasSpace = $repoRoot -match '\s'
$hasNonAscii = $repoRoot -match '[^\x00-\x7F]'
$pathOk = (-not $hasSpace) -and (-not $hasNonAscii)
Add-Check -Item 'Ruta del repositorio' -Ok $pathOk -Detail $repoRoot

Write-Host ""
Write-Host "=== Verificación de entorno NEXO (Windows) ===" -ForegroundColor Cyan
$rows | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "Dispositivos de sonido detectados (Win32_SoundDevice):" -ForegroundColor Cyan
foreach ($sd in $soundDevices) {
    Write-Host ("  - {0} [{1}]" -f $sd.Name, $sd.Status)
}

if ($script:hasFailure) {
    Write-Host ""
    Write-Host "RESULTADO: FALLA (uno o más requisitos obligatorios no se cumplen)." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "RESULTADO: OK (todos los requisitos obligatorios están listos)." -ForegroundColor Green
    exit 0
}

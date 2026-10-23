#Requires -Version 5.1
# Compila todos los binarios Go de NEXO para windows/amd64 hacia bin\win\.
# Sale con código 1 si cualquier compilación falla.

param(
    # Permite comprobar todos los ejecutables sin reemplazar los que están en uso.
    [string] $OutputDir = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = if ($env:NEXO_REPO_ROOT) {
    (Resolve-Path $env:NEXO_REPO_ROOT).Path
} else {
    (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$salidaHabitual = Join-Path $repoRoot 'bin\win'
$outDir = if ($OutputDir) { [IO.Path]::GetFullPath($OutputDir) } else { $salidaHabitual }
$publicar = [IO.Path]::GetFullPath($outDir) -eq [IO.Path]::GetFullPath($salidaHabitual)
if ($publicar) {
    # Fallar antes de compilar evita una actualización a medias (puente nuevo,
    # bandeja vieja) cuando Windows mantiene bloqueado alguno de los .exe.
    $enUso = @(Get-Process -Name 'nexo-tray', 'nexo-agent', 'nexo-gpu-webrtc', 'nexo-super-bridge' -ErrorAction SilentlyContinue)
    if ($enUso.Count) {
        throw 'NEXO sigue abierto. En el icono de la bandeja elige Salir (Detener no cierra la bandeja), cierra el ayudante de teclado si está abierto y vuelve a ejecutar build.ps1. Para verificar sin reemplazar, usa -OutputDir con una carpeta temporal.'
    }
}
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$env:GOOS = 'windows'
$env:GOARCH = 'amd64'

function Invoke-GoBuild {
    param(
        [string]$ModuleDir,
        [string]$OutputExe,
        [string]$LdFlags = '-s -w'
    )
    if (-not (Test-Path $ModuleDir)) {
        Write-Error "[build] No existe el directorio del módulo: $ModuleDir"
        exit 1
    }
    Write-Host "[build] Compilando $ModuleDir -> $OutputExe ..." -ForegroundColor Cyan
    Push-Location $ModuleDir
    try {
        & go build -trimpath -ldflags $LdFlags -o $OutputExe .
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[build] ERROR: go build falló en $ModuleDir con código $LASTEXITCODE" -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $OutputExe)) {
        Write-Host "[build] ERROR: No se generó el binario esperado: $OutputExe" -ForegroundColor Red
        exit 1
    }
}

# 1. gpu-webrtc -> bin\win\nexo-gpu-webrtc.exe
Invoke-GoBuild -ModuleDir (Join-Path $repoRoot 'gpu-webrtc') -OutputExe (Join-Path $outDir 'nexo-gpu-webrtc.exe')

# 2. windows-helper -> bin\win\nexo-super-bridge.exe y copia a windows-helper\dist\nexo-super-bridge.exe
$bridgeOut = Join-Path $outDir 'nexo-super-bridge.exe'
Invoke-GoBuild -ModuleDir (Join-Path $repoRoot 'windows-helper') -OutputExe $bridgeOut

if ($publicar) {
    $helperDistDir = Join-Path $repoRoot 'windows-helper\dist'
    if (-not (Test-Path $helperDistDir)) {
        New-Item -ItemType Directory -Path $helperDistDir -Force | Out-Null
    }
    $helperDistExe = Join-Path $helperDistDir 'nexo-super-bridge.exe'
    Copy-Item -Path $bridgeOut -Destination $helperDistExe -Force
    Write-Host "[build] Copiado a $helperDistExe" -ForegroundColor Green
}

# 3. native\agent -> bin\win\nexo-agent.exe (sólo si existe; aparece en F3)
$agentDir = Join-Path $repoRoot 'native\agent'
if (Test-Path (Join-Path $agentDir 'go.mod')) {
    Invoke-GoBuild -ModuleDir $agentDir -OutputExe (Join-Path $outDir 'nexo-agent.exe')
} else {
    Write-Host "[build] native\agent aún no existe (se añade en F3); omitiendo." -ForegroundColor DarkGray
}

# 3b. Fuentes e imagenes de las apariencias -> native\tray\panel\fuentes e img (las embebe go:embed)
$syncPanel = Join-Path $repoRoot 'scripts\ui\sync-recursos-panel.js'
if (Test-Path $syncPanel) {
    Write-Host "[build] Sincronizando recursos del panel ..." -ForegroundColor Cyan
    & node $syncPanel
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[build] ERROR: no se pudieron sincronizar los recursos del panel." -ForegroundColor Red
        exit 1
    }
}

# 4. native\tray -> bin\win\nexo-tray.exe con -H windowsgui (sólo si existe; aparece en F9)
$trayDir = Join-Path $repoRoot 'native\tray'
if (Test-Path (Join-Path $trayDir 'go.mod')) {
    Invoke-GoBuild -ModuleDir $trayDir -OutputExe (Join-Path $outDir 'nexo-tray.exe') -LdFlags '-H windowsgui -s -w'
} else {
    Write-Host "[build] native\tray aún no existe (se añade en F9); omitiendo." -ForegroundColor DarkGray
}

Write-Host "[build] Compilación completada correctamente." -ForegroundColor Green
Get-ChildItem $outDir -Filter '*.exe' | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
exit 0

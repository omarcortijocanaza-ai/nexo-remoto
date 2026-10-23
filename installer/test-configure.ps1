#Requires -Version 7.4
# Prueba la configuración en una instalación ficticia, con tarea y firewall simulados.
param([Parameter(Mandatory)][string]$App,[Parameter(Mandatory)][string]$FFmpeg)
$ErrorActionPreference = 'Stop'
$App = (Resolve-Path $App).Path
$FFmpeg = (Resolve-Path $FFmpeg).Path
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$base = Join-Path $repo ('dist/configure-test-' + [guid]::NewGuid())
foreach ($caso in @('gpu','cpu','conservar')) {
    $raiz = Join-Path $base "$caso/NEXO con espacios"
    foreach ($carpeta in @('installer','runtime/ffmpeg','scripts/windows','perfil')) { New-Item -ItemType Directory -Force (Join-Path $raiz $carpeta) | Out-Null }
    foreach ($nombre in @('node','pwsh')) {
        New-Item -ItemType Junction -Path (Join-Path $raiz "runtime/$nombre") -Target (Join-Path $App "runtime/$nombre") | Out-Null
    }
    New-Item -ItemType Junction -Path (Join-Path $raiz 'node_modules') -Target (Join-Path $App 'node_modules') | Out-Null
    Copy-Item (Join-Path $PSScriptRoot 'configure.ps1') (Join-Path $raiz 'installer')
    # Un ejecutable que rechaza los argumentos de FFmpeg simula NVENC no disponible.
    $binario = if ($caso -eq 'cpu') { Join-Path $App 'runtime/node/node.exe' } else { $FFmpeg }
    Copy-Item $binario (Join-Path $raiz 'runtime/ffmpeg/ffmpeg.exe')
    @{binarySha256=(Get-FileHash $binario).Hash} | ConvertTo-Json | Set-Content (Join-Path $raiz 'installer/ffmpeg.json')
    'exit 0' | Set-Content (Join-Path $raiz 'scripts/windows/install-autostart.ps1')
    $estado = Join-Path $raiz 'perfil/NEXO/state/.nexo-settings.json'
    if ($caso -eq 'conservar') {
        New-Item -ItemType Directory -Force (Split-Path $estado) | Out-Null
        '{"modo":"local","gpu":false,"micDispositivo":"Mi cable","httpsLan":true}' | Set-Content $estado
    }
    @'
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = Join-Path $PSScriptRoot 'perfil'
$global:consultas = 0
function Get-ScheduledTask {
    param($TaskName,$ErrorAction)
    $global:consultas++
    if ($global:consultas -eq 1) { return $null }
    [pscustomobject]@{Triggers=@([pscustomobject]@{Enabled=$true})}
}
function Set-ScheduledTask {
    param($TaskName,$Trigger)
    if ($TaskName -ne 'NEXO' -or $Trigger[0].Enabled) { throw 'Disparador no desactivado' }
    'disparador desactivado, tarea disponible manualmente' | Set-Content (Join-Path $PSScriptRoot 'trigger.txt')
}
& (Join-Path $PSScriptRoot 'installer/configure.ps1') -Autostart 0
exit $LASTEXITCODE
'@ | Set-Content (Join-Path $raiz 'runner.ps1')
    & (Join-Path $App 'runtime/pwsh/pwsh.exe') -NoProfile -NonInteractive -File (Join-Path $raiz 'runner.ps1')
    if ($LASTEXITCODE -ne 0) { throw "Falló $caso; consulta $raiz/perfil/NEXO/logs/instalacion.log" }
    if (-not (Test-Path (Join-Path $raiz 'trigger.txt'))) { throw 'No se comprobó desactivar el disparador' }
    $resultado = Get-Content $estado -Raw | ConvertFrom-Json
    if ($resultado.gpu -ne ($caso -eq 'gpu')) { throw "Selección GPU incorrecta: $caso" }
    if ($caso -eq 'conservar' -and ($resultado.modo -ne 'local' -or $resultado.micDispositivo -ne 'Mi cable' -or -not $resultado.httpsLan)) { throw 'Se sobrescribieron ajustes existentes' }
    Write-Host "OK: $caso, ruta con espacios, estado nuevo/conservado y autoarranque desactivable."
}
Write-Host "Fixtures conservadas para inspección: $base"

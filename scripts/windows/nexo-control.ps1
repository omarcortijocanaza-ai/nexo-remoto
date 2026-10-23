# nexo-control para Windows: los mismos subcomandos que el `nexo-control` de Linux.
#   start | show | link | pair [min] | rotate [-y] | status | stop | restart | log | doctor | turn-test
#   credentials {status | init [usuario] | set [usuario]}
# PowerShell 7 (pwsh). Lo llama nexo-control.cmd, que sólo reenvía los argumentos.

[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Accion = 'start',
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Resto = @()
)

$ErrorActionPreference = 'Stop'
# Sin esto la consola OEM de Windows pinta «…» y «·» como signos de interrogación.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DirEstado = if ($env:NEXO_STATE_DIR) { $env:NEXO_STATE_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO\state' }
$DirRegistros = if ($env:NEXO_LOGS_DIR) { $env:NEXO_LOGS_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO\logs' }
$ArchivoEstado = Join-Path $DirEstado '.nexo-state.json'
$ArchivoRegistro = Join-Path $DirRegistros 'nexo-runtime.log'
$ArchivoDispositivos = Join-Path $DirEstado '.nexo-devices.json'

function Get-Node {
    $nodo = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodo) { throw 'No se encontró node en el PATH. Ejecuta scripts\windows\setup.ps1.' }
    return $nodo.Source
}

function Get-Estado {
    try { return Get-Content -LiteralPath $ArchivoEstado -Raw -Encoding utf8 | ConvertFrom-Json } catch { return $null }
}

function Get-Puerto {
    if ($env:REMOTE_KEYBOARD_PORT) { return [int]$env:REMOTE_KEYBOARD_PORT }
    $estado = Get-Estado
    if ($estado -and $estado.port) { return [int]$estado.port }
    return 8765
}

function Test-Activo {
    try {
        $respuesta = Invoke-WebRequest -Uri "http://127.0.0.1:$(Get-Puerto)/health" -TimeoutSec 2 -UseBasicParsing
        return $respuesta.StatusCode -eq 200
    } catch { return $false }
}

function Show-Acceso {
    $estado = Get-Estado
    $local = if ($estado -and $estado.localUrl) { $estado.localUrl } else { 'conectando…' }
    $internet = 'conectando…'
    if ($estado -and $estado.remoteUrl -and $estado.token) { $internet = "$(([string]$estado.remoteUrl).TrimEnd('/'))/?token=$($estado.token)" }
    Write-Host 'NEXO activo'
    Write-Host "LOCAL: $local"
    Write-Host "INTERNET: $internet"
}

function Start-Nexo {
    if (Test-Activo) { Show-Acceso; return }
    New-Item -ItemType Directory -Force -Path $DirRegistros | Out-Null
    if (-not $env:NEXO_MODE) { $env:NEXO_MODE = 'both' }
    # El lanzador escribe su propio registro (con el token enmascarado): lo que
    # salga por la consola se descarta. Start-Process no admite el mismo destino
    # para stdout y stderr, así que stderr va a un archivo que se vacía en cada
    # arranque (sólo recibe fallos del propio Node antes de abrir el registro).
    #
    # Con el autoarranque instalado (tarea «NEXO», privilegios máximos) se arranca SIEMPRE
    # por ella: lanzarlo desde esta consola normal lo dejaría sin elevar y Windows
    # bloquearía la entrada sobre ventanas de administrador. Con NEXO_STATE_DIR definido
    # (pruebas con estado aparte) se lanza directamente.
    $usaTarea = (-not $env:NEXO_STATE_DIR) -and [bool](Get-ScheduledTask -TaskName 'NEXO' -ErrorAction SilentlyContinue)
    if ($usaTarea) {
        if (Get-Process -Name 'nexo-tray' -ErrorAction SilentlyContinue) {
            # Tras un «stop» la bandeja (elevada) espera a que se borre la marca de parada deliberada.
            Remove-Item -LiteralPath (Join-Path $DirEstado '.nexo-stopped') -Force -ErrorAction SilentlyContinue
        } else {
            Start-ScheduledTask -TaskName 'NEXO'
        }
    } else {
        $errores = Join-Path $DirRegistros 'nexo-launcher-stderr.log'
        Set-Content -LiteralPath $errores -Value '' -Encoding utf8
        Start-Process -FilePath (Get-Node) -ArgumentList 'launcher.js' -WorkingDirectory $Raiz -WindowStyle Hidden `
            -RedirectStandardOutput 'NUL' -RedirectStandardError $errores | Out-Null
    }
    for ($i = 0; $i -lt 60; $i++) { if (Test-Activo) { break }; Start-Sleep -Milliseconds 250 }
    if (-not (Test-Activo)) {
        Write-Error "NEXO no pudo iniciar. Revisa $ArchivoRegistro" -ErrorAction Continue
        exit 1
    }
    for ($i = 0; $i -lt 32; $i++) {
        $estado = Get-Estado
        if ($estado -and $estado.remoteUrl) { break }
        if ($env:NEXO_MODE -eq 'local') { break }
        Start-Sleep -Milliseconds 250
    }
    Show-Acceso
}

function Stop-Nexo {
    Push-Location $Raiz
    try { & (Get-Node) launcher.js --stop } finally { Pop-Location }
    for ($i = 0; $i -lt 40; $i++) { if (-not (Test-Activo)) { break }; Start-Sleep -Milliseconds 250 }
}

function Invoke-Pair {
    param([string] $Minutos = '10')
    if ($Minutos -notmatch '^\d+$') { Write-Error 'Uso: nexo-control pair [minutos]'; exit 2 }
    & (Get-Node) (Join-Path $Raiz 'scripts\pair.js') $Minutos
}

function Invoke-Rotate {
    param([string] $Opcion = '')
    if (-not (Test-Path -LiteralPath $ArchivoEstado)) { Write-Error 'No hay estado de NEXO todavía; inícialo una vez antes de rotar.'; exit 1 }
    $dispositivos = (& (Get-Node) (Join-Path $Raiz 'rotate-token.js') --dispositivos $ArchivoDispositivos 2>$null)
    if (-not $dispositivos) { $dispositivos = '0' }
    Write-Host ''
    Write-Host 'Rotar el enlace de NEXO:'
    Write-Host '  · Los enlaces que ya compartiste dejarán de funcionar.'
    Write-Host "  · Los $dispositivos dispositivos emparejados siguen entrando sin hacer nada."
    Write-Host '  · El enlace nuevo sirve igual para emparejar más aparatos.'
    Write-Host '  · La dirección de Internet cambiará, como en cualquier reinicio.'
    Write-Host ''
    if ($Opcion -notin @('-y', '--si')) {
        $respuesta = Read-Host '¿Rotar ahora? [s/N]'
        if ($respuesta -notmatch '^(s|S|si|SI|Si|sí|Sí|SÍ)$') { Write-Host 'Cancelado. Nada ha cambiado.'; exit 1 }
    }
    & (Get-Node) (Join-Path $Raiz 'rotate-token.js') $ArchivoEstado $ArchivoDispositivos
    if ($LASTEXITCODE -ne 0) { exit 1 }
    if (Test-Activo) { Stop-Nexo; Start-Sleep -Seconds 1 }
    Start-Nexo
    Write-Host ''
    Write-Host 'Si algún aparato de la lista no lo reconoces, revócalo desde el botón ⓘ.'
}

function Invoke-Credenciales {
    param([string] $Subaccion = 'status', [string] $Usuario = '')
    $nodo = Get-Node
    $gestor = Join-Path $Raiz 'auth-manager.js'
    switch ($Subaccion) {
        'status' { & $nodo $gestor status; exit $LASTEXITCODE }
        'init' { & $nodo $gestor init $(if ($Usuario) { $Usuario } else { 'Letzus' }); exit $LASTEXITCODE }
        { $_ -in 'set', 'cambiar' } {
            if (-not $Usuario) { $Usuario = 'Letzus' }
            $primera = Read-Host "Nueva contraseña para $Usuario" -AsSecureString
            $segunda = Read-Host 'Repite la contraseña' -AsSecureString
            $a = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($primera)
            $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segunda)
            try {
                $textoA = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($a)
                $textoB = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
                if ($textoA -ne $textoB) { Write-Error 'Las contraseñas no coinciden.'; exit 1 }
                if (-not $textoA) { Write-Error 'La contraseña no puede estar vacía.'; exit 1 }
                # La contraseña viaja por stdin: nunca en la línea de órdenes ni en el historial.
                $info = [Diagnostics.ProcessStartInfo]::new($nodo)
                $info.ArgumentList.Add($gestor); $info.ArgumentList.Add('set'); $info.ArgumentList.Add($Usuario)
                $info.RedirectStandardInput = $true
                $info.UseShellExecute = $false
                $info.WorkingDirectory = $Raiz
                $proceso = [Diagnostics.Process]::Start($info)
                $proceso.StandardInput.Write($textoA)
                $proceso.StandardInput.Close()
                $proceso.WaitForExit()
                if ($proceso.ExitCode -ne 0) { exit $proceso.ExitCode }
            } finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a)
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
            }
            if (Test-Activo) { Stop-Nexo; Start-Sleep -Seconds 2; Start-Nexo }
        }
        default { Write-Error 'Uso: nexo-control credentials {status|init [usuario]|set [usuario]}'; exit 2 }
    }
}

switch ($Accion) {
    { $_ -in 'start', 'show' } { Start-Nexo }
    { $_ -in 'link', 'enlace' } { Show-Acceso }
    { $_ -in 'pair', 'emparejar' } { Invoke-Pair -Minutos $(if ($Resto.Count) { $Resto[0] } else { '10' }) }
    { $_ -in 'rotate', 'rotar' } { Invoke-Rotate -Opcion $(if ($Resto.Count) { $Resto[0] } else { '' }) }
    'status' { if (Test-Activo) { Show-Acceso } else { Write-Host 'NEXO detenido'; exit 1 } }
    'stop' { Stop-Nexo; Write-Host 'NEXO detenido: acceso local y remoto cerrados' }
    'restart' { Stop-Nexo; Start-Sleep -Seconds 2; Start-Nexo }
    'log' { Get-Content -LiteralPath $ArchivoRegistro -Wait -Tail 80 -Encoding utf8 }
    { $_ -in 'doctor', 'diagnostico' } { & (Join-Path $PSScriptRoot 'nexo-doctor.ps1'); exit $LASTEXITCODE }
    { $_ -in 'turn-test', 'turn' } { & (Get-Node) (Join-Path $Raiz 'scripts	urn-test.js'); exit $LASTEXITCODE }
    { $_ -in 'credentials', 'credenciales' } { Invoke-Credenciales -Subaccion $(if ($Resto.Count) { $Resto[0] } else { 'status' }) -Usuario $(if ($Resto.Count -gt 1) { $Resto[1] } else { '' }) }
    default { Write-Error 'Uso: nexo-control {start|show|link|pair|rotate|status|stop|restart|log|doctor|turn-test|credentials}'; exit 2 }
}

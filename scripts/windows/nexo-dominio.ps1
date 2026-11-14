# Dirección fija de NEXO por la VM del dueño (plan «Internet», fase I2).
#   preparar   crea la llave del túnel, guarda la huella de la VM y escribe .nexo-dominio.json (inactivo)
#   probar     abre el túnel 20 s y comprueba https://<dominio>/health (NEXO tiene que estar en marcha)
#   activar    el lanzador abrirá el túnel en cada arranque (reinicia NEXO para aplicarlo)
#   desactivar vuelve a usar sólo TryCloudflare (reinicia NEXO para aplicarlo)
#   estado     muestra la configuración y si la dirección fija responde ahora
# La parte de la VM la hace scripts/vm/nexo-dominio-vm.sh (con la llave de administración del dueño).
# PowerShell 7. No necesita privilegios de administrador.

[CmdletBinding()]
param(
    [Parameter(Position = 0)] [ValidateSet('preparar', 'probar', 'activar', 'desactivar', 'estado')] [string] $Accion = 'estado',
    [string] $Dominio = 'nexo.nexussoftware.pe',
    [string] $VmHost = '136.248.65.57',
    [string] $Usuario = 'nexotunel',
    [int] $PuertoRemoto = 5095
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$DirEstado = if ($env:NEXO_STATE_DIR) { $env:NEXO_STATE_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO\state' }
$Carpeta = Join-Path $DirEstado 'tunel-vm'
$Llave = Join-Path $Carpeta 'id_ed25519'
$Conocidos = Join-Path $Carpeta 'known_hosts'
$Config = Join-Path $DirEstado '.nexo-dominio.json'
$OpenSsh = Join-Path $env:SystemRoot 'System32\OpenSSH'
$Ssh = Join-Path $OpenSsh 'ssh.exe'

function Get-Config {
    try { return Get-Content -LiteralPath $Config -Raw -Encoding utf8 | ConvertFrom-Json } catch { return $null }
}

function Set-Config([bool] $Activo) {
    $actual = Get-Config
    $datos = [ordered]@{
        activo = $Activo
        url    = if ($actual -and $actual.url) { [string]$actual.url } else { "https://$Dominio" }
        ssh    = if ($actual -and $actual.ssh) { $actual.ssh } else { [ordered]@{ host = $VmHost; usuario = $Usuario; puertoRemoto = $PuertoRemoto } }
    }
    # Escritura atómica: el lanzador puede estar leyéndolo.
    $tmp = "$Config.tmp-$PID"
    ($datos | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $tmp -Encoding utf8NoBOM
    Move-Item -LiteralPath $tmp -Destination $Config -Force
}

function Get-ArgumentosSsh($c) {
    # Los mismos que lib/tunel-fijo.js (argumentosSsh).
    return @('-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes',
        '-o', "UserKnownHostsFile=$Conocidos", '-o', 'IdentitiesOnly=yes', '-i', $Llave,
        '-R', "127.0.0.1:$($c.ssh.puertoRemoto):127.0.0.1:8765", "$($c.ssh.usuario)@$($c.ssh.host)")
}

function Test-Salud([string] $Url) {
    try { return (Invoke-WebRequest -Uri "$Url/health" -TimeoutSec 8 -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}

switch ($Accion) {
    'preparar' {
        if (-not (Test-Path -LiteralPath $Ssh)) { throw "No está el cliente OpenSSH de Windows ($Ssh). Instálalo en Configuración → Aplicaciones → Características opcionales." }
        New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
        if (-not (Test-Path -LiteralPath $Llave)) {
            # Sin frase de paso a propósito: NEXO la usa sin nadie delante. Vive en la carpeta de
            # estado (sólo tu usuario, SYSTEM y Administradores) y en la VM sólo sirve para el túnel.
            & (Join-Path $OpenSsh 'ssh-keygen.exe') -q -t ed25519 -N '' -C 'nexo-tunel' -f $Llave
            if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen falló' }
            Write-Host 'Llave del túnel creada.'
        } else { Write-Host 'La llave del túnel ya existía; se conserva.' }
        $c = Get-Config
        $vm = if ($c -and $c.ssh) { [string]$c.ssh.host } else { $VmHost }
        $huellas = & (Join-Path $OpenSsh 'ssh-keyscan.exe') -t ed25519 $vm 2>$null
        if (-not $huellas) { throw "No se pudo leer la huella de $vm (¿está encendida la VM?)" }
        $huellas | Set-Content -LiteralPath $Conocidos -Encoding ascii
        if (-not $c) { Set-Config $false; Write-Host "Configuración escrita (inactiva): $Config" }
        Write-Host ''
        Write-Host 'Huella de la VM (compárala con la que da la propia VM antes de activar):'
        & (Join-Path $OpenSsh 'ssh-keygen.exe') -lf $Conocidos
        Write-Host ''
        Write-Host 'Llave pública del túnel (va en la VM; no es secreta):'
        Get-Content -LiteralPath "$Llave.pub"
    }
    'probar' {
        $c = Get-Config
        if (-not $c) { throw 'Primero: nexo-dominio.ps1 preparar' }
        try { Invoke-WebRequest -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 3 -UseBasicParsing | Out-Null } catch { throw 'NEXO no está en marcha (http://127.0.0.1:8765/health no responde).' }
        $err = Join-Path $Carpeta 'prueba-ssh.txt'
        $p = Start-Process -FilePath $Ssh -ArgumentList (Get-ArgumentosSsh $c) -NoNewWindow -PassThru -RedirectStandardError $err
        try {
            $ok = $false
            for ($i = 0; $i -lt 10 -and -not $ok -and -not $p.HasExited; $i++) { Start-Sleep -Seconds 2; $ok = Test-Salud $c.url }
            if ($ok) { Write-Host "OK: $($c.url) llega a NEXO por el túnel." }
            else {
                Write-Host "NO responde $($c.url)/health." -ForegroundColor Red
                if ($p.HasExited) { Write-Host "ssh terminó (código $($p.ExitCode)): $(Get-Content -LiteralPath $err -Raw)" }
                exit 1
            }
        } finally {
            if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
            Remove-Item -LiteralPath $err -Force -ErrorAction SilentlyContinue
        }
    }
    'activar' {
        if (-not (Test-Path -LiteralPath $Llave) -or -not (Test-Path -LiteralPath $Conocidos)) { throw 'Primero: nexo-dominio.ps1 preparar' }
        Set-Config $true
        Write-Host 'Dirección fija activada. Reinicia NEXO (panel → Reiniciar, o nexo-control restart) para aplicarla.'
    }
    'desactivar' {
        if (Get-Config) { Set-Config $false }
        Write-Host 'Dirección fija desactivada. Reinicia NEXO para aplicarlo; se usará sólo TryCloudflare.'
    }
    'estado' {
        $c = Get-Config
        if (-not $c) { Write-Host 'Sin configurar (nexo-dominio.ps1 preparar).'; break }
        Write-Host "Dirección: $($c.url) · activa: $($c.activo) · VM: $($c.ssh.usuario)@$($c.ssh.host) → 127.0.0.1:$($c.ssh.puertoRemoto)"
        Write-Host "Llave: $(if (Test-Path -LiteralPath $Llave) { 'sí' } else { 'no' }) · huella de la VM: $(if (Test-Path -LiteralPath $Conocidos) { 'sí' } else { 'no' })"
        Write-Host "Responde ahora: $(if (Test-Salud $c.url) { 'sí' } else { 'no' })"
    }
}

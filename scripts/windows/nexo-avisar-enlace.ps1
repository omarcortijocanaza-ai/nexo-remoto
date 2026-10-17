# Avisa al celular con el enlace de NEXO en cuanto el túnel lo publica.
#
# El túnel de TryCloudflare es efímero: la dirección de Internet CAMBIA en cada
# arranque, así que si la PC se reinicia estando fuera de casa no hay forma de
# saber la nueva. Este script espera a que el túnel publique su enlace y lo manda
# al celular; después se queda vigilando y vuelve a avisar si cambia (cloudflared
# reconecta con otra dirección de vez en cuando). Lo lanza la bandeja al iniciar
# sesión. Es el equivalente Windows de linux-extra/nexo-avisar-enlace.sh.
#
# Uso:
#   nexo-avisar-enlace.ps1 [vigilar]   vigila y avisa (lo que corre al arrancar)
#   nexo-avisar-enlace.ps1 ahora       manda el enlace actual y termina
#   nexo-avisar-enlace.ps1 prueba      manda un aviso de prueba, SIN el enlace
#
# Configuración en %APPDATA%\NEXO\nexo-aviso.conf (CLAVE=valor, # comentarios):
#   NEXO_AVISO=ntfy|telegram|ninguno
#   NTFY_SERVIDOR=https://ntfy.sh
#   NTFY_TEMA=<tema secreto>
#   TELEGRAM_TOKEN=<token del bot>
#   TELEGRAM_CHAT=<id del chat>
# Opcionales: NEXO_AVISO_ESPERA (segundos esperando al túnel, 300) y
# NEXO_AVISO_INTERVALO (segundos entre revisiones, 60).

[CmdletBinding()]
param([Parameter(Position = 0)] [ValidateSet('vigilar', 'ahora', 'prueba')] [string] $Modo = 'vigilar')

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$DirEstado = if ($env:NEXO_STATE_DIR) { $env:NEXO_STATE_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO\state' }
$DirRegistros = if ($env:NEXO_LOGS_DIR) { $env:NEXO_LOGS_DIR } else { Join-Path $env:LOCALAPPDATA 'NEXO\logs' }
$Config = if ($env:NEXO_AVISO_CONF) { $env:NEXO_AVISO_CONF } else { Join-Path $env:APPDATA 'NEXO\nexo-aviso.conf' }
$ArchivoEstado = Join-Path $DirEstado '.nexo-state.json'
$Registro = Join-Path $DirRegistros 'nexo-aviso.log'
$Ultimo = Join-Path $DirEstado 'nexo-ultimo-enlace.txt'

$Ajustes = @{
    NEXO_AVISO = 'ninguno'; NTFY_SERVIDOR = 'https://ntfy.sh'; NTFY_TEMA = ''
    TELEGRAM_TOKEN = ''; TELEGRAM_CHAT = ''; NEXO_AVISO_ESPERA = '300'; NEXO_AVISO_INTERVALO = '60'
}
if (Test-Path -LiteralPath $Config) {
    foreach ($linea in Get-Content -LiteralPath $Config -Encoding utf8) {
        if ($linea -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$' -and -not $linea.TrimStart().StartsWith('#')) {
            $Ajustes[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
        }
    }
}

# El registro nunca lleva el token completo ni el del bot.
function Hide-Secretos([string] $Texto) {
    $Texto = $Texto -replace '(?i)(token=)[^\s&"''<>]+', '${1}***'
    if ($Ajustes.TELEGRAM_TOKEN) { $Texto = $Texto.Replace($Ajustes.TELEGRAM_TOKEN, '***') }
    return $Texto
}

function Write-Apunte([string] $Texto) {
    New-Item -ItemType Directory -Force -Path $DirRegistros | Out-Null
    $linea = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (Hide-Secretos $Texto)
    Add-Content -LiteralPath $Registro -Value $linea -Encoding utf8
    # Rotación mínima: este registro crece despacio, pero nunca sin límite.
    if ((Get-Item -LiteralPath $Registro).Length -gt 1MB) { Move-Item -LiteralPath $Registro -Destination "$Registro.1" -Force }
}

function Get-Enlace([string] $Campo) {
    try {
        $estado = Get-Content -LiteralPath $ArchivoEstado -Raw -Encoding utf8 | ConvertFrom-Json
        if (-not $estado.token -or -not $estado.$Campo) { return $null }
        if ($Campo -eq 'localUrl') { return [string]$estado.localUrl }
        return "$(([string]$estado.$Campo).TrimEnd('/'))/?token=$($estado.token)"
    } catch { return $null }
}

function Send-Aviso([string] $Titulo, [string] $Cuerpo) {
    switch ($Ajustes.NEXO_AVISO) {
        'ntfy' {
            if (-not $Ajustes.NTFY_TEMA) { Write-Apunte 'ntfy sin tema configurado'; return $false }
            $url = "$($Ajustes.NTFY_SERVIDOR.TrimEnd('/'))/$($Ajustes.NTFY_TEMA)"
            Invoke-RestMethod -Uri $url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($Cuerpo)) -TimeoutSec 15 `
                -Headers @{ Title = $Titulo; Tags = 'computer'; Priority = 'default' } | Out-Null
            return $true
        }
        'telegram' {
            if (-not $Ajustes.TELEGRAM_TOKEN -or -not $Ajustes.TELEGRAM_CHAT) { Write-Apunte 'telegram sin token o chat'; return $false }
            Invoke-RestMethod -Uri "https://api.telegram.org/bot$($Ajustes.TELEGRAM_TOKEN)/sendMessage" -Method Post -TimeoutSec 15 `
                -Body @{ chat_id = $Ajustes.TELEGRAM_CHAT; text = "$Titulo`n$Cuerpo" } | Out-Null
            return $true
        }
        default { Write-Apunte 'sin método de aviso configurado (NEXO_AVISO=ninguno)'; return $false }
    }
}

function Send-Seguro([string] $Titulo, [string] $Cuerpo) {
    try { return [bool](Send-Aviso $Titulo $Cuerpo) }
    catch { Write-Apunte "fallo de red al avisar: $($_.Exception.Message)"; return $false }
}

function Send-Enlace([string] $Enlace) {
    $cuerpo = $Enlace
    $local = Get-Enlace 'localUrl'
    if ($local) { $cuerpo = "$cuerpo`n`nEn casa: $local" }
    if (Send-Seguro "NEXO listo en $env:COMPUTERNAME" $cuerpo) {
        Set-Content -LiteralPath $Ultimo -Value $Enlace -Encoding utf8
        Write-Apunte "avisado: $Enlace"
        return $true
    }
    Write-Apunte "fallo al avisar: $Enlace"
    return $false
}

switch ($Modo) {
    'prueba' {
        # A propósito NO manda el enlace: sirve para confirmar que el aviso llega al
        # celular antes de publicar nada sensible.
        if (Send-Seguro "NEXO - prueba desde $env:COMPUTERNAME" 'Si ves esto, los avisos funcionan. El enlace real se manda al arrancar la PC.') {
            Write-Host 'Aviso de prueba enviado.'; exit 0
        }
        Write-Host "No se pudo enviar el aviso de prueba. Revisa $Config y $Registro" -ForegroundColor Red
        exit 1
    }
    'ahora' {
        $enlace = Get-Enlace 'remoteUrl'
        if (-not $enlace) { Write-Host 'El túnel todavía no publicó su enlace.' -ForegroundColor Red; exit 1 }
        if (Send-Enlace $enlace) { Write-Host 'Enlace enviado.'; exit 0 }
        exit 1
    }
}

# ── Modo vigilancia (el del arranque) ───────────────────────────────────────
$espera = [int]$Ajustes.NEXO_AVISO_ESPERA
$intervalo = [int]$Ajustes.NEXO_AVISO_INTERVALO
$inicio = Get-Date
$enlace = $null
while (((Get-Date) - $inicio).TotalSeconds -lt $espera) {
    $enlace = Get-Enlace 'remoteUrl'
    if ($enlace) { break }
    Start-Sleep -Seconds 5
}
if (-not $enlace) { Write-Apunte "el túnel no publicó enlace en ${espera}s; se sigue vigilando" }
else { [void](Send-Enlace $enlace) }

# El enlace puede cambiar sin reiniciar: cloudflared reconecta y publica otra
# dirección. Se avisa sólo cuando de verdad cambia, no en cada vuelta.
$anterior = if (Test-Path -LiteralPath $Ultimo) { (Get-Content -LiteralPath $Ultimo -Raw -Encoding utf8).Trim() } else { '' }
while ($true) {
    Start-Sleep -Seconds $intervalo
    $actual = Get-Enlace 'remoteUrl'
    if (-not $actual -or $actual -eq $anterior) { continue }
    if (Send-Enlace $actual) { $anterior = $actual }
}

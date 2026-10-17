#Requires -Version 7.0
# Prueba de humo de NEXO en Windows: arranca una instancia APARTE (estado temporal,
# otro puerto, modo local) y comprueba de punta a punta lo esencial: emparejar por
# token, /info, /diagnostics (platform = windows), una captura JPEG, escribir texto
# en el Bloc de notas por /input y leerlo por portapapeles, y que al parar no queda
# ningún proceso. No toca la instalación real de NEXO ni su estado.
#
# Uso:   pwsh -File scripts\windows\smoke.ps1 [-SinEntrada] [-Puerto 18765] [-Conservar]
#   -SinEntrada  omite el paso del Bloc de notas (abre una ventana y teclea en el
#                escritorio: no lo uses mientras alguien trabaja en la PC)
#   -Conservar   no borra el estado y los registros temporales al terminar
# Código de salida: 0 si todo OK, 1 si algo FALLA.

[CmdletBinding()]
param(
    [switch] $SinEntrada,
    [int] $Puerto = (Get-Random -Minimum 18700 -Maximum 18999),
    [switch] $Conservar
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Base = Join-Path ([IO.Path]::GetTempPath()) ("nexo-smoke-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$DirEstado = Join-Path $Base 'estado'
$DirRegistros = Join-Path $Base 'registros'
$Token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
$Clave = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
$Url = "http://127.0.0.1:$Puerto"
$fallas = 0

function Write-Resultado([string] $Estado, [string] $Paso, [string] $Detalle = '') {
    if ($Estado -eq 'FALLA') { $script:fallas++ }
    $color = switch ($Estado) { 'OK' { 'Green' } 'FALLA' { 'Red' } default { 'Yellow' } }
    Write-Host ('{0,-6} ' -f $Estado) -ForegroundColor $color -NoNewline
    Write-Host ('{0,-34} {1}' -f $Paso, $Detalle)
}
function Test-Paso([string] $Paso, [scriptblock] $Bloque) {
    try {
        $detalle = & $Bloque
        Write-Resultado 'OK' $Paso ([string]$detalle)
    } catch { Write-Resultado 'FALLA' $Paso $_.Exception.Message }
}

# Procesos de NEXO existentes: para distinguir los de esta prueba de los de la instalación real.
function Get-ProcesosNexo {
    Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -match '^(nexo-agent|nexo-gpu-webrtc|cloudflared)\.exe$') -or
        ($_.Name -eq 'node.exe' -and [string]$_.CommandLine -match '(launcher|server|gpu-stream-windows)\.js')
    } | ForEach-Object { $_.ProcessId }
}

$node = (Get-Command node -ErrorAction Stop).Source
$antes = @(Get-ProcesosNexo)
$lanzador = $null
Write-Host "NEXO · prueba de humo (puerto $Puerto, estado temporal en $Base)" -ForegroundColor White

try {
    New-Item -ItemType Directory -Force -Path $DirEstado, $DirRegistros | Out-Null
    $env:NEXO_STATE_DIR = $DirEstado
    $env:NEXO_LOGS_DIR = $DirRegistros
    $env:NEXO_MODE = 'local'
    $env:NEXO_GPU = '0'
    $env:NEXO_MICROFONO = '0'
    $env:REMOTE_KEYBOARD_PORT = "$Puerto"
    $env:REMOTE_KEYBOARD_HOST = '127.0.0.1'
    $env:REMOTE_KEYBOARD_TOKEN = $Token

    Test-Paso 'credenciales de la instancia de prueba' {
        # Por stdin: nunca en la línea de órdenes.
        $info = [Diagnostics.ProcessStartInfo]::new($node)
        $info.ArgumentList.Add((Join-Path $Raiz 'auth-manager.js')); $info.ArgumentList.Add('set'); $info.ArgumentList.Add('smoke')
        $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.UseShellExecute = $false; $info.WorkingDirectory = $Raiz
        $proceso = [Diagnostics.Process]::Start($info)
        $proceso.StandardInput.Write($Clave); $proceso.StandardInput.Close(); [void]$proceso.StandardOutput.ReadToEnd(); $proceso.WaitForExit()
        if ($proceso.ExitCode -ne 0) { throw "auth-manager salió con $($proceso.ExitCode)" }
        'usuario smoke'
    }

    Test-Paso 'arranque del lanzador' {
        $lanzador = Start-Process -FilePath $node -ArgumentList 'launcher.js' -WorkingDirectory $Raiz -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput 'NUL' -RedirectStandardError (Join-Path $DirRegistros 'stderr.txt')
        $limite = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $limite) {
            try { if ((Invoke-WebRequest "$Url/health" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) { return "/health responde (PID $($lanzador.Id))" } } catch {}
            Start-Sleep -Milliseconds 300
        }
        throw '/health no respondió en 25 s'
    }

    $sesion = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    Test-Paso 'emparejar por token (la URL queda limpia)' {
        $respuesta = Invoke-WebRequest "$Url/?token=$Token" -WebSession $sesion -UseBasicParsing -MaximumRedirection 5
        $cookies = $sesion.Cookies.GetCookies([Uri]$Url)
        if (-not ($cookies | Where-Object Name -eq 'nexo_device')) { throw 'no llegó la cookie nexo_device' }
        if ($respuesta.BaseResponse.RequestMessage.RequestUri.Query -match 'token') { throw 'el token sigue en la URL' }
        'cookie de dispositivo recibida, sin token en la URL'
    }

    Test-Paso 'inicio de sesión de Mi PC' {
        $cuerpo = @{ username = 'smoke'; password = $Clave } | ConvertTo-Json
        $respuesta = Invoke-WebRequest "$Url/auth/login" -Method Post -Body $cuerpo -ContentType 'application/json' -WebSession $sesion -UseBasicParsing
        if ($respuesta.StatusCode -ne 200) { throw "HTTP $($respuesta.StatusCode)" }
        'sesión abierta'
    }

    Test-Paso '/info (monitores)' {
        $info = Invoke-RestMethod "$Url/info" -WebSession $sesion
        if (-not $info.monitors -or $info.monitors.Count -lt 1) { throw 'sin monitores' }
        "$($info.monitors.Count) monitor(es): $(($info.monitors | ForEach-Object { "$($_.width)x$($_.height)" }) -join ', ')"
    }

    Test-Paso '/diagnostics (platform = windows)' {
        $diagnostico = Invoke-RestMethod "$Url/diagnostics" -WebSession $sesion
        if ($diagnostico.server.platform -ne 'windows') { throw "platform = $($diagnostico.server.platform)" }
        'platform windows'
    }

    Test-Paso '/screen devuelve un JPEG' {
        $respuesta = Invoke-WebRequest "$Url/screen" -WebSession $sesion -UseBasicParsing
        $bytes = $respuesta.Content
        if ($bytes.Length -lt 1000 -or $bytes[0] -ne 0xFF -or $bytes[1] -ne 0xD8) { throw 'no es un JPEG (FF D8)' }
        "$([math]::Round($bytes.Length / 1KB)) KB, cabecera FF D8"
    }

    if ($SinEntrada) { Write-Resultado 'OMITIDO' 'texto en el Bloc de notas' 'con -SinEntrada' }
    else {
        Test-Paso 'texto por /input → Bloc de notas → portapapeles' {
            Add-Type -Namespace Nexo -Name Humo -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' -ErrorAction SilentlyContinue
            $marca = "NEXO-HUMO-$([Guid]::NewGuid().ToString('N').Substring(0, 8)) ñandú"
            $bloc = Start-Process notepad -PassThru
            try {
                $limite = (Get-Date).AddSeconds(8)
                $enfocado = $false
                while ((Get-Date) -lt $limite -and -not $enfocado) {
                    Start-Sleep -Milliseconds 300
                    $bloc.Refresh()
                    if ($bloc.MainWindowHandle -ne 0) { [void][Nexo.Humo]::SetForegroundWindow($bloc.MainWindowHandle) }
                    $pidEnfocado = 0
                    [void][Nexo.Humo]::GetWindowThreadProcessId([Nexo.Humo]::GetForegroundWindow(), [ref]$pidEnfocado)
                    $enfocado = ((Get-Process -Id $pidEnfocado -ErrorAction SilentlyContinue).ProcessName -match 'notepad|Notepad')
                }
                # Nunca se teclea si el Bloc de notas no está al frente: el texto caería en otra aplicación.
                if (-not $enfocado) { throw 'no se pudo poner el Bloc de notas al frente; no se tecleó nada' }
                $enviar = { param($datos) Invoke-RestMethod "$Url/input" -Method Post -Body ($datos | ConvertTo-Json -Compress) -ContentType 'application/json' -WebSession $sesion | Out-Null }
                & $enviar @{ type = 'text'; value = $marca }
                Start-Sleep -Milliseconds 400
                & $enviar @{ type = 'key'; value = 'selectall' }
                & $enviar @{ type = 'key'; value = 'copy' }
                Start-Sleep -Milliseconds 400
                $leido = (Invoke-RestMethod "$Url/clipboard" -WebSession $sesion).text
                if ($leido -ne $marca) { throw "el portapapeles trae «$leido» y se esperaba «$marca»" }
                'texto con ñ/acento entregado y leído por portapapeles'
            } finally {
                if (-not $bloc.HasExited) { $bloc.Kill() }
            }
        }
    }
} finally {
    # Parada ordenada y comprobación de que no queda nada.
    Push-Location $Raiz
    try { & $node launcher.js --stop *> $null } catch {} finally { Pop-Location }
    Start-Sleep -Milliseconds 800
    $restos = @(Get-ProcesosNexo | Where-Object { $_ -notin $antes })
    if ($restos.Count) { Write-Resultado 'FALLA' 'procesos al terminar' "quedan $($restos.Count) proceso(s) de la prueba: $($restos -join ', ')"; $restos | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
    else { Write-Resultado 'OK' 'procesos al terminar' 'ninguno de la prueba sigue vivo' }
    $registro = Join-Path $DirRegistros 'nexo-runtime.log'
    if (Test-Path -LiteralPath $registro) {
        if (Select-String -LiteralPath $registro -Pattern 'token=(?!\*\*\*)' -Quiet) { Write-Resultado 'FALLA' 'registro sin token' 'hay «token=» sin enmascarar' }
        else { Write-Resultado 'OK' 'registro sin token' 'todo enmascarado (token=***)' }
    }
    foreach ($nombre in 'NEXO_STATE_DIR', 'NEXO_LOGS_DIR', 'NEXO_MODE', 'NEXO_GPU', 'NEXO_MICROFONO', 'REMOTE_KEYBOARD_PORT', 'REMOTE_KEYBOARD_HOST', 'REMOTE_KEYBOARD_TOKEN') { Remove-Item "Env:$nombre" -ErrorAction SilentlyContinue }
    if (-not $Conservar) { Remove-Item -LiteralPath $Base -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
if ($fallas -eq 0) { Write-Host 'Resultado: todo en verde.' -ForegroundColor Green; exit 0 }
Write-Host "Resultado: $fallas paso(s) fallaron." -ForegroundColor Red
exit 1

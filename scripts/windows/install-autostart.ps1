# Convierte NEXO en «parte de Windows»: carpeta privada con ACL, tarea programada
# al iniciar sesión (con privilegios más altos), reglas de firewall sólo en perfil
# Privado, ajustes de energía opcionales y scripts\windows en el PATH.
#
# Requiere administrador: si no lo eres, se relanza elevado (aparece el aviso de
# UAC una vez). Los pasos que tocan energía o borran reglas ajenas preguntan antes.
#
# Uso:
#   pwsh -File scripts\windows\install-autostart.ps1
#   -SinPreguntas   no aplica ningún paso opcional (energía, borrar reglas Públicas)
#   -SoloMostrar    imprime lo que haría sin cambiar nada (no pide administrador)
#   -SinFirewall / -SinPath   omite ese paso
#
# Para pruebas: -NombreTarea y -NivelEjecucion (Limited permite registrar una tarea
# de prueba sin administrador). Con los valores por defecto es la instalación real.

[CmdletBinding()]
param(
    [switch] $SinPreguntas,
    [switch] $SoloMostrar,
    [string] $NombreTarea = 'NEXO',
    [ValidateSet('Highest', 'Limited')] [string] $NivelEjecucion = 'Highest',
    [switch] $SinFirewall,
    [switch] $SinPath,
    [switch] $Elevado
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Tray = Join-Path $Raiz 'bin\win\nexo-tray.exe'
$Puente = Join-Path $Raiz 'bin\win\nexo-gpu-webrtc.exe'
$DirNexo = Join-Path $env:LOCALAPPDATA 'NEXO'
$DirNexoRoaming = Join-Path $env:APPDATA 'NEXO'
$DirScripts = Join-Path $Raiz 'scripts\windows'
$Puerto = if ($env:REMOTE_KEYBOARD_PORT) { [int]$env:REMOTE_KEYBOARD_PORT } else { 8765 }
$Usuario = [Security.Principal.WindowsIdentity]::GetCurrent()
$SidUsuario = $Usuario.User.Value

function Write-Paso([string] $Texto) { Write-Host "`n▶ $Texto" -ForegroundColor Cyan }
function Write-Hecho([string] $Texto) { Write-Host "  ✓ $Texto" -ForegroundColor Green }
function Write-Aviso([string] $Texto) { Write-Host "  ! $Texto" -ForegroundColor Yellow }
function Invoke-Accion([string] $Descripcion, [scriptblock] $Bloque) {
    if ($SoloMostrar) { Write-Host "  [simulación] $Descripcion" -ForegroundColor DarkGray; return }
    & $Bloque
}
# S/N con el comando a la vista. Con -SinPreguntas o -SoloMostrar la respuesta es «no».
function Read-Confirmacion([string] $Pregunta, [string] $Comando) {
    Write-Host "  $Pregunta" -ForegroundColor White
    Write-Host "    Comando: $Comando" -ForegroundColor DarkGray
    if ($SinPreguntas -or $SoloMostrar) { Write-Host '    (omitido)' -ForegroundColor DarkGray; return $false }
    return (Read-Host '    ¿Aplicar? [s/N]') -match '^(s|S|si|SI|Si|sí|Sí|SÍ)$'
}

# ── Elevación ───────────────────────────────────────────────────────────────
$esAdmin = ([Security.Principal.WindowsPrincipal]$Usuario).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin -and -not $SoloMostrar -and $NivelEjecucion -eq 'Highest') {
    Write-Host 'Se necesitan permisos de administrador; se abrirá el aviso de Windows (UAC).' -ForegroundColor Yellow
    $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevado')
    if ($SinPreguntas) { $argumentos += '-SinPreguntas' }
    if ($SinFirewall) { $argumentos += '-SinFirewall' }
    if ($SinPath) { $argumentos += '-SinPath' }
    $argumentos += @('-NombreTarea', $NombreTarea, '-NivelEjecucion', $NivelEjecucion)
    $proceso = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $argumentos -Verb RunAs -Wait -PassThru
    exit $proceso.ExitCode
}

try {
    Write-Host "NEXO · instalación del autoarranque ($Raiz)" -ForegroundColor White
    if ($SoloMostrar) { Write-Host 'Modo simulación: no se cambia nada.' -ForegroundColor Yellow }

    # ── a) ACL de la carpeta privada ─────────────────────────────────────────
    Write-Paso 'Carpeta privada (token, dispositivos, perfil)'
    # Los modos 0600/0700 no protegen nada en Windows: sin esto cualquier usuario
    # del equipo puede leer el token y emparejarse. Se usan SID para no depender del idioma.
    foreach ($dir in @($DirNexo, $DirNexoRoaming)) {
        if ($dir -eq $DirNexoRoaming -and -not (Test-Path -LiteralPath $dir)) { continue }
        Invoke-Accion "icacls `"$dir`" /inheritance:r /grant:r *$SidUsuario`:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F" {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            $salida = & icacls $dir /inheritance:r /grant:r "*${SidUsuario}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 2>&1
            if ($LASTEXITCODE -ne 0) { throw "icacls falló en ${dir}: $salida" }
            Write-Hecho "acceso restringido a tu usuario, SYSTEM y Administradores: $dir"
        }
    }

    # ── b) Tarea programada ───────────────────────────────────────────────────
    Write-Paso "Tarea programada «$NombreTarea»"
    if (-not (Test-Path -LiteralPath $Tray)) { Write-Aviso "falta ${Tray}: ejecuta scripts\windows\build.ps1 antes (se registra igualmente)" }
    Invoke-Accion "Register-ScheduledTask $NombreTarea (al iniciar sesión de $($Usuario.Name), $NivelEjecucion, sólo con sesión iniciada, reinicia 3 veces cada 1 min, sin límite de tiempo) -> $Tray" {
        $accion = New-ScheduledTaskAction -Execute $Tray -WorkingDirectory $Raiz
        $disparador = New-ScheduledTaskTrigger -AtLogOn -User $Usuario.Name
        # Interactive = «ejecutar sólo cuando el usuario haya iniciado sesión»: la
        # sesión 0 no vería el escritorio y NEXO no podría capturarlo ni controlarlo.
        $principal = New-ScheduledTaskPrincipal -UserId $Usuario.Name -LogonType Interactive -RunLevel $NivelEjecucion
        $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $disparador -Principal $principal -Settings $ajustes `
            -Description 'NEXO: pantalla, teclado y audio remotos de esta PC (bandeja + lanzador).' -Force | Out-Null
        Write-Hecho "registrada: al iniciar sesión $($Usuario.Name), privilegios $NivelEjecucion"
    }

    # ── c) Firewall (sólo perfil Privado) ─────────────────────────────────────
    Write-Paso 'Reglas de firewall (sólo perfil Privado)'
    if ($SinFirewall) { Write-Aviso 'omitido por -SinFirewall' }
    else {
        $nodo = (Get-Command node -ErrorAction SilentlyContinue).Source
        if (-not $nodo) { Write-Aviso 'node no está en el PATH: no se pueden crear las reglas de node.exe' }
        $reglas = @()
        if ($nodo) {
            $reglas += @{ Nombre = "NEXO HTTP $Puerto (node)"; Protocolo = 'TCP'; Puerto = $Puerto; Programa = $nodo }
            $reglas += @{ Nombre = 'NEXO WebRTC UDP (node)'; Protocolo = 'UDP'; Puerto = 'Any'; Programa = $nodo }
        }
        $reglas += @{ Nombre = 'NEXO WebRTC UDP (puente GPU)'; Protocolo = 'UDP'; Puerto = 'Any'; Programa = $Puente }
        foreach ($regla in $reglas) {
            Invoke-Accion "New-NetFirewallRule `"$($regla.Nombre)`" Inbound Allow $($regla.Protocolo) puerto $($regla.Puerto) -Program $($regla.Programa) -Profile Private" {
                Get-NetFirewallRule -DisplayName $regla.Nombre -ErrorAction SilentlyContinue | Remove-NetFirewallRule
                $parametros = @{ DisplayName = $regla.Nombre; Direction = 'Inbound'; Action = 'Allow'; Protocol = $regla.Protocolo; Program = $regla.Programa; Profile = 'Private' }
                if ($regla.Puerto -ne 'Any') { $parametros.LocalPort = $regla.Puerto }
                New-NetFirewallRule @parametros | Out-Null
                Write-Hecho $regla.Nombre
            }
        }
        Write-Aviso 'Sin reglas para el perfil Público: en una red pública NEXO no será alcanzable por LAN (el túnel de Internet sí funciona).'
        # Reglas que Windows creó al preguntar la primera vez, abiertas también al perfil Público.
        $ajenas = @(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue | ForEach-Object {
            $app = $_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
            if ($_.DisplayName -cnotlike 'NEXO *' -and $app.Program -and $app.Program -match 'nexo-gpu-webrtc|\\nodejs\\node\.exe|\\ffmpeg\.exe' -and ([string]$_.Profile -match 'Public|Any' -or [string]$_.Profile -eq '0')) { $_ }
        })
        if ($ajenas.Count) {
            $nombres = ($ajenas | ForEach-Object { $_.DisplayName } | Select-Object -Unique) -join ', '
            if (Read-Confirmacion "Hay $($ajenas.Count) regla(s) que Windows abrió también al perfil Público ($nombres). ¿Quitarlas?" 'Remove-NetFirewallRule (sólo las de node.exe, ffmpeg.exe y nexo-gpu-webrtc.exe)') {
                $ajenas | Remove-NetFirewallRule
                Write-Hecho 'reglas Públicas quitadas'
            }
        }
    }

    # ── d) Energía ────────────────────────────────────────────────────────────
    Write-Paso 'Energía (cada cambio pregunta antes)'
    if (Read-Confirmacion 'No pedir contraseña al despertar de suspensión (sin esto, tras suspender NEXO queda detrás de la pantalla de bloqueo).' 'powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 ; powercfg /SETACTIVE SCHEME_CURRENT') {
        powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
        powercfg /SETACTIVE SCHEME_CURRENT
        Write-Hecho 'sin contraseña al despertar (con corriente)'
    }
    if (Read-Confirmacion 'Desactivar el Inicio rápido (necesario para encender la PC con Wake-on-LAN desde apagado).' 'reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f') {
        reg add 'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power' /v HiberbootEnabled /t REG_DWORD /d 0 /f | Out-Null
        Write-Hecho 'Inicio rápido desactivado'
    }
    try {
        $tarjetas = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object Status -eq 'Up'
        foreach ($tarjeta in $tarjetas) {
            $energia = Get-NetAdapterPowerManagement -Name $tarjeta.Name -ErrorAction SilentlyContinue
            if ($energia) {
                Write-Host "  Wake on Magic Packet en «$($tarjeta.Name)»: $($energia.WakeOnMagicPacket)" -ForegroundColor White
                if ("$($energia.WakeOnMagicPacket)" -notmatch 'Enabled') { Write-Aviso 'para activarlo: Administrador de dispositivos → la tarjeta → Administración de energía → «Permitir que este dispositivo reactive el equipo» y «Sólo permitir un paquete mágico»; y «Wake on Magic Packet» en la BIOS/UEFI' }
            }
        }
    } catch { Write-Aviso "no se pudo leer la energía de la tarjeta de red: $($_.Exception.Message)" }

    # ── e) PATH ───────────────────────────────────────────────────────────────
    Write-Paso 'PATH del usuario'
    $rutaUsuario = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($SinPath) { Write-Aviso 'omitido por -SinPath' }
    elseif (($rutaUsuario -split ';') -contains $DirScripts) { Write-Hecho 'scripts\windows ya está en el PATH' }
    else {
        Invoke-Accion "añadir $DirScripts al PATH del usuario (nexo-control, nexo-doctor)" {
            [Environment]::SetEnvironmentVariable('Path', ($rutaUsuario.TrimEnd(';') + ';' + $DirScripts).TrimStart(';'), 'User')
            Write-Hecho 'añadido (abre una consola nueva para usar `nexo-control`)'
        }
    }

    # ── f) Pasos manuales ─────────────────────────────────────────────────────
    Write-Paso '👤 Pasos manuales para que NEXO vuelva solo tras encender o reiniciar'
    Write-Host @'
  1) Inicio de sesión automático (sin esto, tras reiniciar Windows se queda en la
     pantalla de bloqueo y NEXO no puede ni verla ni controlarla):
       winget install --id Microsoft.Sysinternals.Autologon -e
       Autologon64.exe   → usuario, dominio y contraseña; «Enable».
     La contraseña la guarda Windows cifrada como secreto de LSA (no en texto plano).
  2) Si tu cuenta es Microsoft y no usas contraseña: Configuración → Cuentas →
     Opciones de inicio de sesión → desactiva «Para mayor seguridad, permitir sólo el
     inicio de sesión de Windows Hello…»; si no, Autologon no funciona.
  3) Wake-on-LAN y arranque dual: GRUB debe arrancar Windows por defecto (o usar
     `grub-reboot` desde Linux); no se toca desde Windows.
  4) Comprueba todo con: nexo-control doctor
'@
    Write-Host "`nListo." -ForegroundColor Green
    $codigo = 0
} catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    $codigo = 1
}
if ($Elevado) { Read-Host "`nPulsa Enter para cerrar" | Out-Null }
exit $codigo

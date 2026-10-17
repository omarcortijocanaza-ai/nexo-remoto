# Deshace lo que instaló install-autostart.ps1: la tarea programada, las reglas de
# firewall «NEXO …» y la entrada del PATH. NO toca la energía, Autologon ni la
# carpeta de estado (token, dispositivos): eso lo decides tú.
#
# Uso: pwsh -File scripts\windows\uninstall-autostart.ps1   (pide administrador)
#   -SoloMostrar   imprime lo que haría sin cambiar nada
# Para pruebas: -NombreTarea.

[CmdletBinding()]
param(
    [switch] $SoloMostrar,
    [string] $NombreTarea = 'NEXO',
    [switch] $Elevado
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DirScripts = Join-Path $Raiz 'scripts\windows'
$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
$esAdmin = ([Security.Principal.WindowsPrincipal]$identidad).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Invoke-Accion([string] $Descripcion, [scriptblock] $Bloque) {
    if ($SoloMostrar) { Write-Host "  [simulación] $Descripcion" -ForegroundColor DarkGray; return }
    & $Bloque
}

# Sólo la instalación real (tarea «NEXO», reglas de firewall) exige administrador.
if (-not $esAdmin -and -not $SoloMostrar -and $NombreTarea -eq 'NEXO') {
    Write-Host 'Se necesitan permisos de administrador; se abrirá el aviso de Windows (UAC).' -ForegroundColor Yellow
    $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevado', '-NombreTarea', $NombreTarea)
    $proceso = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $argumentos -Verb RunAs -Wait -PassThru
    exit $proceso.ExitCode
}

try {
    Write-Host 'NEXO · desinstalación del autoarranque' -ForegroundColor White

    Write-Host "`n▶ Tarea programada «$NombreTarea»" -ForegroundColor Cyan
    if (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue) {
        Invoke-Accion "Unregister-ScheduledTask $NombreTarea" { Unregister-ScheduledTask -TaskName $NombreTarea -Confirm:$false; Write-Host '  ✓ eliminada' -ForegroundColor Green }
    } else { Write-Host '  (no estaba instalada)' }

    Write-Host "`n▶ Acceso directo «NEXO» del menú Inicio" -ForegroundColor Cyan
    $acceso = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\NEXO.lnk'
    if (($NombreTarea -eq 'NEXO') -and (Test-Path -LiteralPath $acceso)) {
        Invoke-Accion "borrar $acceso" { Remove-Item -LiteralPath $acceso -Force; Write-Host '  ✓ eliminado' -ForegroundColor Green }
    } else { Write-Host '  (no había)' }

    Write-Host "`n▶ Reglas de firewall «NEXO …»" -ForegroundColor Cyan
    $reglas = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -cmatch '^NEXO ' })
    if ($reglas.Count) {
        foreach ($regla in $reglas) {
            Invoke-Accion "Remove-NetFirewallRule `"$($regla.DisplayName)`"" { $regla | Remove-NetFirewallRule; Write-Host "  ✓ $($regla.DisplayName)" -ForegroundColor Green }
        }
    } else { Write-Host '  (no había reglas)' }

    Write-Host "`n▶ PATH del usuario" -ForegroundColor Cyan
    $partes = ([Environment]::GetEnvironmentVariable('Path', 'User')) -split ';' | Where-Object { $_ }
    if ($partes -contains $DirScripts) {
        Invoke-Accion "quitar $DirScripts del PATH del usuario" {
            [Environment]::SetEnvironmentVariable('Path', (($partes | Where-Object { $_ -ne $DirScripts }) -join ';'), 'User')
            Write-Host '  ✓ quitado' -ForegroundColor Green
        }
    } else { Write-Host '  (no estaba)' }

    Write-Host @'

No se ha tocado (hazlo a mano si lo quieres):
  · Carpeta de estado y registros:   %LOCALAPPDATA%\NEXO   (token y dispositivos emparejados)
  · Inicio de sesión automático:     ejecuta Autologon64.exe y pulsa «Disable»
  · Sin contraseña al despertar:     powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 ; powercfg /SETACTIVE SCHEME_CURRENT
  · Inicio rápido de Windows:        reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 1 /f
'@
    $codigo = 0
} catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    $codigo = 1
}
if ($Elevado) { Read-Host "`nPulsa Enter para cerrar" | Out-Null }
exit $codigo

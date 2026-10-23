$ErrorActionPreference = 'Stop'
try {
    $raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $propietario = Join-Path $PSScriptRoot 'install-owner.json'
    # Una instalación interrumpida antes de configurar no es dueña de tareas ajenas.
    if (-not (Test-Path $propietario)) { exit 0 }
    $sid = (Get-Content $propietario -Raw | ConvertFrom-Json).sid
    if ($sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Desinstala desde la cuenta que instaló NEXO.' }
    $tray = Join-Path $raiz 'bin/win/nexo-tray.exe'
    $tarea = Get-ScheduledTask -TaskName NEXO -ErrorAction SilentlyContinue
    if ($tarea -and -not @($tarea.Actions | Where-Object { $_.Execute -ne $tray }).Count) {
        Unregister-ScheduledTask -TaskName NEXO -Confirm:$false
    }
    # Sólo retirar reglas que apuntan a los ejecutables de esta instalación.
    $binarios = @((Join-Path $raiz 'runtime/node/node.exe'),(Join-Path $raiz 'bin/win/nexo-gpu-webrtc.exe'))
    Get-NetFirewallRule -ErrorAction Stop | Where-Object DisplayName -Like 'NEXO *' | ForEach-Object {
        $regla = $_
        if (@($regla | Get-NetFirewallApplicationFilter | Where-Object { $_.Program -in $binarios }).Count) { $regla | Remove-NetFirewallRule }
    }
    $acceso = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/NEXO.lnk'
    if (Test-Path $acceso) {
        $shell = New-Object -ComObject WScript.Shell
        if ($shell.CreateShortcut($acceso).TargetPath -eq $tray) { Remove-Item -LiteralPath $acceso }
    }
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}

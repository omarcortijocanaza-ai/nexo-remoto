param([ValidateSet('0','1')][string]$Autostart = '1')
$ErrorActionPreference = 'Stop'
$raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privado = Join-Path $env:LOCALAPPDATA 'NEXO'
New-Item -ItemType Directory -Force (Join-Path $privado 'logs') | Out-Null
$registro = Join-Path $privado 'logs/instalacion.log'
try {
    Set-Location -LiteralPath $raiz
    # El instalador no toma herramientas de una instalación ajena del PATH.
    $env:PATH = (@('node','pwsh','ffmpeg','cloudflared') | ForEach-Object { Join-Path $raiz "runtime/$_" }) -join ';'
    $env:PATH += ";$env:SystemRoot\System32;$env:SystemRoot"
    $tarea = Get-ScheduledTask -TaskName NEXO -ErrorAction SilentlyContinue
    if ($tarea -and @($tarea.Actions | Where-Object { $_.Execute -and [IO.Path]::GetFullPath($_.Execute) -ne (Join-Path $raiz 'bin/win/nexo-tray.exe') }).Count) {
        throw 'Ya existe una tarea NEXO de otra carpeta. Desinstala su autoarranque antes de migrar a esta instalación.'
    }
    $ffmpeg = Join-Path $raiz 'runtime/ffmpeg/ffmpeg.exe'
    $origen = Get-Content (Join-Path $PSScriptRoot 'ffmpeg.json') -Raw | ConvertFrom-Json
    if (-not (Test-Path $ffmpeg) -or (Get-FileHash $ffmpeg).Hash -ne $origen.binarySha256) {
        $temporal = Join-Path ([IO.Path]::GetTempPath()) ('NEXO-' + [guid]::NewGuid())
        New-Item -ItemType Directory $temporal | Out-Null
        try {
            $zip = Join-Path $temporal 'ffmpeg.zip'
            Invoke-WebRequest $origen.url -OutFile $zip
            if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $origen.sha256) { throw 'SHA-256 de FFmpeg incorrecto. No se ejecutará.' }
            Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $temporal 'extraido')
            $ejecutable = @(Get-ChildItem (Join-Path $temporal 'extraido') -Recurse -Filter ffmpeg.exe)
            if ($ejecutable.Count -ne 1) { throw 'Distribución FFmpeg inesperada.' }
            New-Item -ItemType Directory -Force (Split-Path $ffmpeg) | Out-Null
            Copy-Item $ejecutable[0].FullName $ffmpeg
            # Se conservan licencias y documentación del distribuidor descargado.
            $distribucion = Split-Path (Split-Path $ejecutable[0].FullName)
            foreach ($nombre in @('LICENSE','README.txt')) { Copy-Item (Join-Path $distribucion $nombre) (Split-Path $ffmpeg) }
        } finally {
            # Sólo se borra el directorio temporal creado aquí, nunca una ruta del usuario.
            if ($temporal.StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $temporal -Leaf) -like 'NEXO-*') { Remove-Item -LiteralPath $temporal -Recurse -Force }
        }
    }
    & (Join-Path $raiz 'runtime/node/node.exe') -e "require('@roamhq/wrtc');require('ws')" 2>&1 | Out-File $registro -Append
    if ($LASTEXITCODE -ne 0) { throw 'No carga el motor WebRTC. Consulta instalacion.log.' }
    @{sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json | Set-Content (Join-Path $raiz 'installer/install-owner.json')
    & (Join-Path $raiz 'runtime/pwsh/pwsh.exe') -NoProfile -NonInteractive -File (Join-Path $raiz 'scripts/windows/install-autostart.ps1') -SinPreguntas -SinPath *> $registro
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar la tarea o el firewall.' }
    if ($Autostart -eq '0') {
        # Desactivar sólo el disparador conserva la apertura manual elevada del panel.
        $tarea = Get-ScheduledTask -TaskName NEXO
        foreach ($disparador in $tarea.Triggers) { $disparador.Enabled = $false }
        Set-ScheduledTask -TaskName NEXO -Trigger $tarea.Triggers | Out-Null
    }
    New-Item -ItemType Directory -Force (Join-Path $privado 'state') | Out-Null
    $ajustes = Join-Path $privado 'state/.nexo-settings.json'
    if (-not (Test-Path $ajustes)) {
        # Prueba sintética: no captura el escritorio ni necesita monitor adicional.
        & $ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=size=640x360:rate=30' -frames:v 1 -c:v h264_nvenc -f null - *> (Join-Path $privado 'logs/prueba-nvenc.log')
        @{modo='both';gpu=($LASTEXITCODE -eq 0);micDispositivo='CABLE Input';httpsLan=$false} | ConvertTo-Json | Set-Content $ajustes -Encoding utf8NoBOM
    }
    exit 0
} catch {
    $_ | Out-String | Out-File $registro -Append
    exit 1
}

#Requires -Version 7.4
# Sólo prepara herramientas de construcción. No instala NEXO ni toca su estado.
param([switch]$InstallCompiler)
$ErrorActionPreference = 'Stop'
$raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$cache = Join-Path $raiz 'dist/cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$dependencias = Get-Content (Join-Path $raiz 'installer/dependencies.json') -Raw | ConvertFrom-Json
foreach ($nombre in @('node','pwsh','ffmpeg','inno','cloudflared')) {
    $origen = $dependencias.$nombre
    $extension = if ($nombre -in 'inno','cloudflared') { 'exe' } else { 'zip' }
    $destino = Join-Path $cache "$nombre.$extension"
    if (-not (Test-Path $destino) -or (Get-FileHash $destino).Hash -ne $origen.sha256) {
        Write-Host "Descargando $nombre $($origen.version) desde su editor..."
        Invoke-WebRequest $origen.url -OutFile $destino
    }
    if ((Get-FileHash $destino).Hash -ne $origen.sha256) { throw "SHA-256 incorrecto: $nombre" }
}
Invoke-WebRequest 'https://raw.githubusercontent.com/cloudflare/cloudflared/2026.7.1/LICENSE' -OutFile (Join-Path $cache 'cloudflared-LICENSE')
Invoke-WebRequest 'https://raw.githubusercontent.com/WonderInventions/node-webrtc/v0.10.0/THIRD_PARTY_LICENSES.md' -OutFile (Join-Path $cache 'wrtc-THIRD_PARTY_LICENSES.md')
New-Item -ItemType Directory -Force (Join-Path $cache 'font-licenses') | Out-Null
foreach ($familia in @('barlow','barlowcondensed','jetbrainsmono','cinzel','atkinsonhyperlegible','publicsans','dmmono','caveat','bricolagegrotesque')) {
    Invoke-WebRequest "https://raw.githubusercontent.com/google/fonts/main/ofl/$familia/OFL.txt" -OutFile (Join-Path $cache "font-licenses/$familia-OFL.txt")
}
if ($InstallCompiler) {
    $exe = Join-Path $cache 'inno.exe'
    $firma = Get-AuthenticodeSignature $exe
    if ($firma.Status -ne 'Valid' -or $firma.SignerCertificate.Subject -notmatch 'Pyrsys') { throw 'Firma del compilador no válida' }
    $destino = Join-Path $raiz 'dist/tools/inno'
    $p = Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER','/NOICONS',"/DIR=`"$destino`"") -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw 'No se pudo instalar el compilador' }
}
Write-Host 'Descargas verificadas. Ejecuta scripts/windows/package.ps1 para generar el instalador.'

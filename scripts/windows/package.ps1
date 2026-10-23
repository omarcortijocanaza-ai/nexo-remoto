#Requires -Version 7.4
# Construye un instalador sin tomar estado privado ni modificar binarios en uso.
param(
    [string]$Version = '1.0.4',
    [string]$NodeArchive = '',
    [string]$PowerShellArchive = '',
    [string]$FFmpegArchive = '',
    [string]$Cloudflared = '',
    [string]$ISCC = ''
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version debe ser X.Y.Z' }
$raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$dist = Join-Path $raiz 'dist'
$cache = Join-Path $dist 'cache'
if (-not $NodeArchive) { $NodeArchive = Join-Path $cache 'node.zip' }
if (-not $PowerShellArchive) { $PowerShellArchive = Join-Path $cache 'pwsh.zip' }
if (-not $FFmpegArchive) { $FFmpegArchive = Join-Path $cache 'ffmpeg.zip' }
if (-not $Cloudflared) { $Cloudflared = Join-Path $cache 'cloudflared.exe' }
if (-not $ISCC) { $ISCC = Join-Path $dist 'tools/inno/ISCC.exe' }
foreach ($archivo in @($NodeArchive,$PowerShellArchive,$FFmpegArchive,$Cloudflared,$ISCC)) {
    if (-not (Test-Path -LiteralPath $archivo -PathType Leaf)) { throw "Falta $archivo. Consulta installer/COMPILAR.md." }
}
$dependencias = Get-Content (Join-Path $raiz 'installer/dependencies.json') -Raw | ConvertFrom-Json
foreach ($entrada in @(@($NodeArchive,$dependencias.node),@($PowerShellArchive,$dependencias.pwsh),@($FFmpegArchive,$dependencias.ffmpeg),@($Cloudflared,$dependencias.cloudflared))) {
    if ((Get-FileHash $entrada[0] -Algorithm SHA256).Hash -ne $entrada[1].sha256) { throw "Descarga inesperada: $($entrada[0])" }
}
$stage = Join-Path $dist ('stage-' + [guid]::NewGuid())
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Force $app | Out-Null
function Copiar([string]$relativo) {
    $destino = Join-Path $app $relativo
    New-Item -ItemType Directory -Force (Split-Path $destino) | Out-Null
    Copy-Item -LiteralPath (Join-Path $raiz $relativo) -Destination $destino -Recurse
}
# Lista positiva: nunca copiar el repositorio entero, el estado ni .claude.
foreach ($nombre in @('auth-manager.js','device-manager.js','entorno.js','entrada-x11.js','gpu-stream.js','gpu-stream-windows.js','keyboard-translation.js','launcher.js','microfono-cliente.js','microfono-host.js','microfono-virtual.js','microfono-virtual-windows.js','rotate-token.js','server.js','webrtc-host.js','index.html','microfono.html','pizarra.html','package.json','package-lock.json','THIRD_PARTY_NOTICES.md','lib','platform','ui','assets/fuentes','assets/viego','scripts/windows','scripts/pair.js','scripts/turn-config.js','scripts/turn-test.js','installer/configure.ps1','installer/uninstall.ps1','installer/ANTES-DE-INSTALAR.txt','installer/PRIMER-INICIO.txt')) { Copiar $nombre }
# Las pruebas y herramientas de construcción no forman parte del programa instalado.
foreach ($recurso in @('assets/viego-mist-keyboard.webp','assets/viego-wallpaper.webp')) { Copiar $recurso }
Get-ChildItem (Join-Path $app 'lib') -Filter '*.test.js' | Remove-Item -Force
Copy-Item (Join-Path $raiz 'installer/PRIMER-INICIO.txt') $app
New-Item -ItemType Directory -Force (Join-Path $app 'licenses/go') | Out-Null
Copy-Item (Join-Path $cache 'wrtc-THIRD_PARTY_LICENSES.md') (Join-Path $app 'licenses')
Copy-Item (Join-Path $cache 'font-licenses') (Join-Path $app 'licenses') -Recurse
$vistos = @{}
foreach ($modulo in @('native/tray','native/agent','gpu-webrtc','windows-helper')) {
    Push-Location (Join-Path $raiz $modulo)
    try {
        $lista = & go list -m -f '{{.Path}}|{{.Version}}|{{.Dir}}' all
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron inventariar licencias Go' }
        foreach ($linea in $lista) {
            $partes = $linea -split '\|',3
            if (-not $partes[1] -or -not $partes[2]) { continue }
            $id = ($partes[0] + '@' + $partes[1]) -replace '[/\\:]','_'
            if ($vistos[$id]) { continue }; $vistos[$id] = $true
            $licencias = @(Get-ChildItem $partes[2] -File | Where-Object Name -Match '^(LICENSE|COPYING|NOTICE|PATENTS|AUTHORS)')
            if (-not $licencias.Count) { throw "Falta licencia de $id" }
            $destino = Join-Path $app "licenses/go/$id"
            New-Item -ItemType Directory -Force $destino | Out-Null
            $licencias | Copy-Item -Destination $destino
        }
    } finally { Pop-Location }
}
New-Item -ItemType Directory -Force (Join-Path $app 'runtime/node'),(Join-Path $app 'runtime/pwsh'),(Join-Path $app 'runtime/cloudflared') | Out-Null
Expand-Archive -LiteralPath $NodeArchive -DestinationPath (Join-Path $stage 'node')
$nodos = @(Get-ChildItem (Join-Path $stage 'node') -Recurse -Filter node.exe)
if ($nodos.Count -ne 1) { throw 'ZIP Node inesperado' }
Copy-Item ((Split-Path $nodos[0].FullName) + '/*') (Join-Path $app 'runtime/node') -Recurse
Expand-Archive -LiteralPath $PowerShellArchive -DestinationPath (Join-Path $app 'runtime/pwsh')
Copy-Item -LiteralPath $Cloudflared (Join-Path $app 'runtime/cloudflared/cloudflared.exe')
Copy-Item -LiteralPath (Join-Path $cache 'cloudflared-LICENSE') (Join-Path $app 'runtime/cloudflared/LICENSE')
$dependencias.ffmpeg | ConvertTo-Json | Set-Content (Join-Path $app 'installer/ffmpeg.json')
# Las dependencias se reconstruyen con el lockfile; no arrastrar cachés del desarrollador.
$node = Join-Path $app 'runtime/node/node.exe'
$pwsh = Join-Path $app 'runtime/pwsh/pwsh.exe'
$envAnterior = $env:PATH
try {
    $env:PATH = (Split-Path $node) + ';' + $envAnterior
    Push-Location $app
    try {
        & $node (Join-Path $app 'runtime/node/node_modules/npm/bin/npm-cli.js') ci --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci falló' }
        & $node -e "require('@roamhq/wrtc');require('ws');console.log('WebRTC y ws cargan con el runtime incluido')"
        if ($LASTEXITCODE -ne 0) { throw 'No carga WebRTC incluido' }
    } finally { Pop-Location }
    & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'build.ps1') -OutputDir (Join-Path $app 'bin/win')
    if ($LASTEXITCODE -ne 0) { throw 'Compilación Go fallida' }
} finally { $env:PATH = $envAnterior }
# El cliente Windows opcional tiene su propio ejecutable descargable.
New-Item -ItemType Directory -Force (Join-Path $app 'windows-helper/dist') | Out-Null
Copy-Item (Join-Path $app 'bin/win/nexo-super-bridge.exe') (Join-Path $app 'windows-helper/dist/nexo-super-bridge.exe')
$entradas = @(Get-ChildItem $app -Recurse -File | ForEach-Object {
    $rel = [IO.Path]::GetRelativePath($app,$_.FullName).Replace('\','/')
    if ($rel -match '(^|/)(\.nexo-|\.git|\.claude|\.env($|\.))' -or $_.Extension -in '.log','.pfx','.pem','.key') { throw "Archivo privado/prohibido en paquete: $rel" }
    @{path=$rel;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash;bytes=$_.Length}
})
@{version=$Version;createdUtc=[DateTime]::UtcNow.ToString('o');files=$entradas} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $app 'package-manifest.json') -Encoding utf8NoBOM
& $node (Join-Path $PSScriptRoot 'verify-package.js') $app
if ($LASTEXITCODE -ne 0) { throw 'La verificación del paquete falló' }
& $node (Join-Path $PSScriptRoot 'smoke-package.js') $app
if ($LASTEXITCODE -ne 0) { throw 'El servidor empaquetado no supera la prueba HTTP' }
& $ISCC "/DStage=$app" "/DVersion=$Version" (Join-Path $raiz 'installer/setup.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC falló' }
$instalador = Join-Path $dist "NEXO-Setup-$Version-x64.exe"
(Get-FileHash $instalador -Algorithm SHA256).Hash + '  ' + (Split-Path $instalador -Leaf) | Set-Content "$instalador.sha256"
Write-Host "Instalador: $instalador"
Write-Host "Paquete verificable: $app"

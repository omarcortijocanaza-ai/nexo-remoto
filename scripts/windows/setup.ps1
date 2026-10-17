#Requires -Version 5.1
# Script idempotente para instalar las herramientas base de NEXO en Windows vía winget.
# Se recomienda ejecutar con PowerShell 7 (pwsh), pero soporta PowerShell 5.1 para el primer arranque
# antes de que Microsoft.PowerShell esté instalado.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Update-SessionPath {
    # Recarga las variables PATH de máquina y de usuario en la sesión actual para que los binarios
    # recién instalados por winget sean visibles sin necesidad de cerrar la ventana.
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $combined = @($machinePath, $userPath) -join ';'
    $extraDirs = @(
        'C:\Program Files\PowerShell\7',
        "$env:LOCALAPPDATA\Microsoft\WindowsApps",
        'C:\Program Files\Git\cmd',
        'C:\Program Files\GitHub CLI',
        'C:\Program Files\nodejs',
        'C:\Program Files\Go\bin',
        "$env:LOCALAPPDATA\Programs\Go\bin",
        'C:\Program Files (x86)\cloudflared'
    )
    foreach ($dir in $extraDirs) {
        if ((Test-Path $dir) -and ($combined -notlike "*$dir*")) {
            $combined = "$combined;$dir"
        }
    }
    $env:PATH = $combined
}

Update-SessionPath

$packages = @(
    @{ Id = 'Microsoft.PowerShell';   Cmd = 'pwsh';        Name = 'PowerShell 7' },
    @{ Id = 'Git.Git';                Cmd = 'git';         Name = 'Git' },
    @{ Id = 'GitHub.cli';             Cmd = 'gh';          Name = 'GitHub CLI' },
    @{ Id = 'OpenJS.NodeJS.LTS';      Cmd = 'node';        Name = 'Node.js LTS' },
    @{ Id = 'GoLang.Go';              Cmd = 'go';          Name = 'Go' },
    @{ Id = 'Gyan.FFmpeg';            Cmd = 'ffmpeg';      Name = 'FFmpeg (Gyan)' },
    @{ Id = 'Cloudflare.cloudflared'; Cmd = 'cloudflared'; Name = 'cloudflared' }
)

foreach ($pkg in $packages) {
    $existing = Get-Command $pkg.Cmd -ErrorAction SilentlyContinue
    $needsInstall = $null -eq $existing

    if (-not $needsInstall -and $pkg.Cmd -eq 'node') {
        $nodeVer = (& node --version 2>$null)
        if ($nodeVer -notmatch '^v24\.') {
            Write-Host "[setup] Node.js actual ($nodeVer) no es v24.x; solicitando OpenJS.NodeJS.LTS..." -ForegroundColor Yellow
            $needsInstall = $true
        }
    }

    if ($needsInstall) {
        Write-Host "[setup] Instalando $($pkg.Name) ($($pkg.Id))..." -ForegroundColor Cyan
        & winget install --id $pkg.Id -e --accept-source-agreements --accept-package-agreements
        $code = $LASTEXITCODE
        Update-SessionPath
        if ($code -ne 0 -and $pkg.Id -eq 'GoLang.Go' -and -not (Get-Command go -ErrorAction SilentlyContinue)) {
            # Si el MSI de Go falla en una sesión sin elevación (1603), extraemos el MSI ya verificado por winget
            # hacia %LOCALAPPDATA%\Programs\Go y lo añadimos al PATH del usuario.
            $cachedMsi = Get-ChildItem "$env:TEMP\WinGet\GoLang.Go*" -Recurse -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($cachedMsi) {
                Write-Host "[setup] Extrayendo MSI verificado de Go en espacio de usuario..." -ForegroundColor Yellow
                $extractDir = "$env:LOCALAPPDATA\Programs\GoExtract"
                if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
                Start-Process msiexec.exe -ArgumentList @('/a', "`"$($cachedMsi.FullName)`"", '/qn', "TARGETDIR=`"$extractDir`"") -Wait -NoNewWindow
                $goSub = Join-Path $extractDir 'Go'
                $goTarget = "$env:LOCALAPPDATA\Programs\Go"
                if (Test-Path (Join-Path $goSub 'bin\go.exe')) {
                    if (Test-Path $goTarget) { Remove-Item -Recurse -Force $goTarget }
                    Move-Item $goSub $goTarget
                    Remove-Item -Recurse -Force $extractDir
                    $uPath = [Environment]::GetEnvironmentVariable('Path', 'User')
                    $goBin = "$goTarget\bin"
                    if ($uPath -notlike "*$goBin*") {
                        [Environment]::SetEnvironmentVariable('Path', "$uPath;$goBin", 'User')
                    }
                    Update-SessionPath
                    $code = 0
                }
            }
        }
        if ($code -ne 0) {
            Write-Error "[setup] Falló la instalación de $($pkg.Id) (código $code)."
            exit 1
        }
    } else {
        Write-Host "[setup] $($pkg.Name) ya está instalado ($($existing.Source))." -ForegroundColor Green
    }
}

Update-SessionPath

$nodeVersion = (& node --version 2>$null).Trim()
if ($nodeVersion -notmatch '^v24\.') {
    Write-Error "[setup] ERROR: node --version devolvió '$nodeVersion' y se requiere Node.js v24.x LTS."
    exit 1
}

Write-Host ""
Write-Host "=== Versiones instaladas ===" -ForegroundColor Cyan
Write-Host ("pwsh        : " + ((& pwsh --version 2>$null) -join ' '))
Write-Host ("git         : " + ((& git --version 2>$null) -join ' '))
Write-Host ("gh          : " + ((& gh --version 2>$null | Select-Object -First 1) -join ' '))
Write-Host ("node        : " + $nodeVersion)
Write-Host ("npm         : " + ((& npm --version 2>$null) -join ' '))
Write-Host ("go          : " + ((& go version 2>$null) -join ' '))
Write-Host ("ffmpeg      : " + ((& ffmpeg -version 2>$null | Select-Object -First 1) -join ' '))
Write-Host ("cloudflared : " + ((& cloudflared --version 2>$null | Select-Object -First 1) -join ' '))
exit 0

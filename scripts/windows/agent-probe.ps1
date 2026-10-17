#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NexoProbeWin32 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessW(
        string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll")]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetThreadDesktop(uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public static string CurrentDesktopName() {
        IntPtr hDesk = GetThreadDesktop(GetCurrentThreadId());
        if (hDesk == IntPtr.Zero) return "";
        StringBuilder sb = new StringBuilder(256);
        int needed;
        if (!GetUserObjectInformationW(hDesk, 2, sb, sb.Capacity * 2, out needed)) return "";
        return sb.ToString();
    }

    public static uint RunOnDefaultDesktop(string exePath, string cmdLine, string workDir) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = "Winsta0\\Default";
        PROCESS_INFORMATION pi;
        if (!CreateProcessW(exePath, cmdLine, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, workDir, ref si, out pi)) {
            throw new InvalidOperationException("CreateProcessW falló: " + Marshal.GetLastWin32Error());
        }
        WaitForSingleObject(pi.hProcess, 60000);
        uint code = 0;
        GetExitCodeProcess(pi.hProcess, out code);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return code;
    }

    public static bool FocusProcessWindow(uint targetPid, out IntPtr foundHwnd, out RECT foundRect) {
        IntPtr hRes = IntPtr.Zero;
        RECT rRes = new RECT();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid) {
                RECT r;
                if (GetWindowRect(hWnd, out r) && (r.Right - r.Left) > 100 && (r.Bottom - r.Top) > 100) {
                    hRes = hWnd;
                    ShowWindow(hWnd, 9); // SW_RESTORE
                    SetWindowPos(hWnd, new IntPtr(-1), 100, 100, 800, 600, 0x0040); // HWND_TOPMOST | SWP_SHOWWINDOW
                    SetForegroundWindow(hWnd);
                    GetWindowRect(hWnd, out rRes);
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        foundHwnd = hRes;
        foundRect = rRes;
        return hRes != IntPtr.Zero;
    }
}
'@

# Si el proceso actual corre en un escritorio aislado (p. ej. exebox), relanzarse en Winsta0\Default
$deskName = [NexoProbeWin32]::CurrentDesktopName()
if ($deskName -ne 'Default' -and $env:NEXO_ON_DEFAULT_DESKTOP -ne '1') {
    $outLog = Join-Path $env:TEMP ("nexo-probe-out-" + [guid]::NewGuid().ToString('N') + ".log")
    $env:NEXO_ON_DEFAULT_DESKTOP = '1'
    $env:NEXO_PROBE_OUT_LOG = $outLog
    $pwshExe = [System.Environment]::ProcessPath
    $cmdLine = "`"$pwshExe`" -NoProfile -File `"$PSCommandPath`""
    try {
        $exitCode = [NexoProbeWin32]::RunOnDefaultDesktop($pwshExe, $cmdLine, (Get-Location).Path)
        if (Test-Path $outLog) {
            Get-Content -LiteralPath $outLog -Encoding UTF8 | ForEach-Object { Write-Host $_ }
        }
        exit $exitCode
    }
    finally {
        Remove-Item -LiteralPath $outLog -Force -ErrorAction SilentlyContinue
    }
}

function Write-ProbeLine {
    param([string]$Text = "")
    Write-Host $Text
    if ($env:NEXO_PROBE_OUT_LOG) {
        Add-Content -LiteralPath $env:NEXO_PROBE_OUT_LOG -Value $Text -Encoding UTF8
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agentExe = Join-Path $repoRoot 'bin\win\nexo-agent.exe'
if (-not (Test-Path $agentExe)) {
    throw "No existe $agentExe. Ejecuta antes: pwsh -File scripts/windows/build.ps1"
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $agentExe
$psi.Arguments = 'serve'
$psi.WorkingDirectory = $repoRoot
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
$psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
$psi.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)

$proc = [System.Diagnostics.Process]::new()
$proc.StartInfo = $psi
[void]$proc.Start()

$script:reqId = 0

function Read-NextResponse {
    param([int]$ExpectedId)
    while ($true) {
        $line = $proc.StandardOutput.ReadLine()
        if ($null -eq $line) {
            throw "nexo-agent cerró stdout inesperadamente"
        }
        $obj = $line | ConvertFrom-Json
        if ($null -ne $obj.event) {
            continue
        }
        if ($obj.id -eq $ExpectedId) {
            if (-not $obj.ok) {
                throw "Error de nexo-agent en id=$ExpectedId : $($obj.error)"
            }
            return $obj
        }
    }
}

function Invoke-AgentOp {
    param(
        [string]$Op,
        [hashtable]$Params = @{}
    )
    $script:reqId++
    $id = $script:reqId
    $payload = @{ id = $id; op = $Op }
    foreach ($k in $Params.Keys) {
        $payload[$k] = $Params[$k]
    }
    $json = $payload | ConvertTo-Json -Depth 10 -Compress
    $proc.StandardInput.WriteLine($json)
    $proc.StandardInput.Flush()
    return Read-NextResponse -ExpectedId $id
}

$notepadProc = $null
$tmpFile = Join-Path $env:TEMP ("nexo-probe-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + ".txt")
[System.IO.File]::WriteAllText($tmpFile, "", [System.Text.UTF8Encoding]::new($false))

try {
    # 1) Evento ready
    $readyLine = $proc.StandardOutput.ReadLine()
    Write-ProbeLine "1) READY: $readyLine"

    # 2) monitors -> tabla
    $monResp = Invoke-AgentOp -Op 'monitors'
    Write-ProbeLine ""
    Write-ProbeLine "2) MONITORS:"
    $tableStr = ($monResp.monitors | Select-Object index, name, description, x, y, width, height, primary, rotation | Format-Table -AutoSize | Out-String).TrimEnd()
    foreach ($line in ($tableStr -split "`r?`n")) {
        Write-ProbeLine $line
    }
    Write-ProbeLine "   Escritorio virtual: x=$($monResp.virtual.x) y=$($monResp.virtual.y) width=$($monResp.virtual.width) height=$($monResp.virtual.height)"

    # 3) Notepad + text + Ctrl+A / Ctrl+C + clipboard.get
    Write-ProbeLine ""
    Write-ProbeLine "3) PRUEBA DE TEXTO Y PORTAPAPELES EN NOTEPAD:"
    [void](Invoke-AgentOp -Op 'clipboard.set' -Params @{ text = '' })

    $notepadProc = Start-Process -FilePath 'notepad.exe' -ArgumentList "`"$tmpFile`"" -PassThru
    $hwnd = [IntPtr]::Zero
    $winRect = New-Object NexoProbeWin32+RECT
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 100
        if ([NexoProbeWin32]::FocusProcessWindow([uint32]$notepadProc.Id, [ref]$hwnd, [ref]$winRect)) {
            break
        }
        $npProcs = Get-Process -Name notepad -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending
        foreach ($np in $npProcs) {
            if ([NexoProbeWin32]::FocusProcessWindow([uint32]$np.Id, [ref]$hwnd, [ref]$winRect)) {
                $notepadProc = $np
                break
            }
        }
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    if ($hwnd -eq [IntPtr]::Zero) {
        throw "No se encontró la ventana de Notepad"
    }

    # Esperar a que el área de edición de Notepad esté lista y enfocar con un clic en su centro
    Start-Sleep -Milliseconds 900
    [void][NexoProbeWin32]::FocusProcessWindow([uint32]$notepadProc.Id, [ref]$hwnd, [ref]$winRect)
    $clickX = [int](($winRect.Left + $winRect.Right) / 2)
    $clickY = [int](($winRect.Top + $winRect.Bottom) / 2)
    [void](Invoke-AgentOp -Op 'pointer' -Params @{ action = 'click'; x = $clickX; y = $clickY; button = 'left' })
    Start-Sleep -Milliseconds 250

    $expectedText = "Hola ñandú áéíóú 😀`n2ª línea"
    [void](Invoke-AgentOp -Op 'text' -Params @{ text = $expectedText })
    Start-Sleep -Milliseconds 300

    # Ctrl+A (scan codes 1D/1E) y Ctrl+C (scan codes 1D/2E)
    [void](Invoke-AgentOp -Op 'keys' -Params @{
        events = @(
            @{ scan = 0x1D; ext = $false; up = $false },
            @{ scan = 0x1E; ext = $false; up = $false },
            @{ scan = 0x1E; ext = $false; up = $true  },
            @{ scan = 0x1D; ext = $false; up = $true  }
        )
    })
    Start-Sleep -Milliseconds 150
    [void](Invoke-AgentOp -Op 'keys' -Params @{
        events = @(
            @{ scan = 0x1D; ext = $false; up = $false },
            @{ scan = 0x2E; ext = $false; up = $false },
            @{ scan = 0x2E; ext = $false; up = $true  },
            @{ scan = 0x1D; ext = $false; up = $true  }
        )
    })
    Start-Sleep -Milliseconds 250

    $clipResp = Invoke-AgentOp -Op 'clipboard.get'
    $gotNormalized = ([string]$clipResp.text) -replace "`r`n", "`n"
    $comparison = if ($gotNormalized -eq $expectedText) { 'IGUAL' } else { 'DISTINTO' }
    Write-ProbeLine "   Texto enviado     : $($expectedText | ConvertTo-Json -Compress)"
    Write-ProbeLine "   Texto portapapeles: $($gotNormalized | ConvertTo-Json -Compress)"
    Write-ProbeLine "   Resultado         : $comparison"

    # 4) pointer move al centro del monitor 0 y leer [System.Windows.Forms.Cursor]::Position
    $m0 = $monResp.monitors | Where-Object { $_.index -eq 0 } | Select-Object -First 1
    if ($null -eq $m0) { $m0 = $monResp.monitors[0] }
    $centerX = [int]($m0.x + [math]::Round($m0.width / 2))
    $centerY = [int]($m0.y + [math]::Round($m0.height / 2))
    [void](Invoke-AgentOp -Op 'pointer' -Params @{ action = 'move'; x = $centerX; y = $centerY; button = 'left' })
    $actualPos = [System.Windows.Forms.Cursor]::Position
    $dx = [math]::Abs($actualPos.X - $centerX)
    $dy = [math]::Abs($actualPos.Y - $centerY)
    Write-ProbeLine ""
    Write-ProbeLine "4) POINTER MOVE (centro monitor 0):"
    Write-ProbeLine "   Esperada: ($centerX, $centerY) | Real ([System.Windows.Forms.Cursor]::Position): ($($actualPos.X), $($actualPos.Y)) | Diferencia: dx=$dx px, dy=$dy px"

    # 5) desktop.info
    $deskResp = Invoke-AgentOp -Op 'desktop.info'
    Write-ProbeLine ""
    Write-ProbeLine "5) DESKTOP.INFO: supported=$($deskResp.supported) index=$($deskResp.index) count=$($deskResp.count)"

    # 6) foreground
    $fgResp = Invoke-AgentOp -Op 'foreground'
    Write-ProbeLine ""
    Write-ProbeLine "6) FOREGROUND: process=$($fgResp.process) elevated=$($fgResp.elevated) title=$($fgResp.title)"

    # 7) Cerrar stdin y comprobar que termina en < 2 s
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc.StandardInput.Close()
    $exited = $proc.WaitForExit(2000)
    $sw.Stop()
    Write-ProbeLine ""
    Write-ProbeLine "7) CIERRE POR STDIN EOF: exited=$exited en $($sw.ElapsedMilliseconds) ms (código=$($proc.ExitCode))"
    if (-not $exited) {
        throw "nexo-agent no terminó en < 2 s tras cerrar stdin"
    }
}
finally {
    if ($null -ne $notepadProc) {
        Stop-Process -Id $notepadProc.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $proc.HasExited) {
        $proc.Kill()
    }
    Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
}

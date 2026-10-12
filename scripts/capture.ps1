# capture.ps1 - screenshot helper for the MCP screenshot/browser server.
# Configuration is passed via environment variables to avoid any quoting issues:
#   MCPS_MODE    : full | region | window | list
#   MCPS_OUT     : output PNG path (full/region/window)
#   MCPS_MONITOR : all | primary (mode=full)
#   MCPS_X, MCPS_Y, MCPS_W, MCPS_H : region rectangle (virtual-screen coords)
#   MCPS_TITLE   : window title substring; empty = foreground window (mode=window)
# stdout: PNG path for capture modes, JSON array for mode=list.

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'

# Validate output before loading capture APIs or touching the desktop.
if (@('full', 'region', 'window', 'list') -notcontains $env:MCPS_MODE) { throw 'Unsupported MCPS_MODE.' }
if ($env:MCPS_MODE -ne 'list') {
    if ([string]::IsNullOrWhiteSpace($env:MCPS_OUT)) { throw 'MCPS_OUT is required.' }
    $testRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\test')).TrimEnd('\')
    $output = [IO.Path]::GetFullPath($env:MCPS_OUT)
    if (-not $output.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Capture output must remain inside project test/.' }
    if (Test-Path -LiteralPath $output) { throw 'Capture output already exists; overwriting is refused.' }
    $walk = Split-Path $output -Parent
    while ($walk -and $walk.Length -ge $testRoot.Length) {
        if (Test-Path -LiteralPath $walk) {
            if (((Get-Item -LiteralPath $walk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Capture output cannot traverse junctions or symbolic links.' }
        }
        if ($walk -eq $testRoot) { break }
        $walk = Split-Path $walk -Parent
    }
    $env:MCPS_OUT = $output
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Make coordinates physical pixels on high-DPI displays.
Add-Type -Name DpiAware -Namespace Mcps -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -ErrorAction SilentlyContinue
try { [void][Mcps.DpiAware]::SetProcessDPIAware() } catch { }

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class McpsWin {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Save-Bitmap([System.Drawing.Bitmap]$bmp, [string]$path) {
    $dir = Split-Path $path -Parent
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void][IO.Directory]::CreateDirectory($dir) }
    try { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $bmp.Dispose() }
    Write-Output $path
}

function Test-HasVisibleContent([System.Drawing.Bitmap]$bmp) {
    # Sample a sparse grid; PrintWindow on accelerated windows can yield a black frame.
    $w = $bmp.Width; $h = $bmp.Height
    for ($i = 1; $i -le 25; $i++) {
        $x = [int]($w * $i / 26); $y = [int]($h * $i / 26)
        if ($x -ge $w) { $x = $w - 1 }
        if ($y -ge $h) { $y = $h - 1 }
        $c = $bmp.GetPixel($x, $y)
        if ($c.R -gt 10 -or $c.G -gt 10 -or $c.B -gt 10) { return $true }
    }
    return $false
}

function Get-ScreenRect([int]$x, [int]$y, [int]$w, [int]$h) {
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    # Clamp the requested rectangle to the virtual screen.
    $x2 = [Math]::Min($x + $w, $vs.Right)
    $y2 = [Math]::Min($y + $h, $vs.Bottom)
    $x = [Math]::Max($x, $vs.Left)
    $y = [Math]::Max($y, $vs.Top)
    return @($x, $y, [Math]::Max(0, $x2 - $x), [Math]::Max(0, $y2 - $y))
}

$mode = $env:MCPS_MODE

switch ($mode) {
    'full' {
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        if ($env:MCPS_MONITOR -eq 'primary') {
            $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $vs = New-Object System.Drawing.Rectangle $b.X, $b.Y, $b.Width, $b.Height
        }
        if ($vs.Width -le 0 -or $vs.Height -le 0) { throw 'Screen has zero size; no desktop session available.' }
        $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size) }
        finally { $g.Dispose() }
        Save-Bitmap $bmp $env:MCPS_OUT
    }

    'region' {
        $x = [int]$env:MCPS_X; $y = [int]$env:MCPS_Y
        $w = [int]$env:MCPS_W; $h = [int]$env:MCPS_H
        if ($w -le 0 -or $h -le 0) { throw 'Region width and height must be positive.' }
        $rect = Get-ScreenRect $x $y $w $h
        if ($rect[2] -le 0 -or $rect[3] -le 0) { throw 'Region is outside the visible screen.' }
        $bmp = New-Object System.Drawing.Bitmap $rect[2], $rect[3]
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($rect[0], $rect[1], 0, 0, $bmp.Size) }
        finally { $g.Dispose() }
        Save-Bitmap $bmp $env:MCPS_OUT
    }

    'window' {
        $title = $env:MCPS_TITLE
        $hwnd = [IntPtr]::Zero

        if ([string]::IsNullOrWhiteSpace($title)) {
            $hwnd = [McpsWin]::GetForegroundWindow()
        } else {
            $needle = '*' + $title + '*'
            $found = [System.Collections.Generic.List[IntPtr]]::new()
            $cb = [McpsWin+EnumProc]{
                param($h, $l)
                if ([McpsWin]::IsWindowVisible($h)) {
                    $sb = New-Object System.Text.StringBuilder 1024
                    [void][McpsWin]::GetWindowText($h, $sb, 1024)
                    $t = $sb.ToString()
                    if ($t -and ($t -like $needle)) { $found.Add($h) }
                }
                return $true
            }
            [void][McpsWin]::EnumWindows($cb, [IntPtr]::Zero)
            if ($found.Count -gt 0) {
                # Prefer a matching foreground window, otherwise the first match.
                $fg = [McpsWin]::GetForegroundWindow()
                $hwnd = if ($found -contains $fg) { $fg } else { $found[0] }
            }
        }

        if ($hwnd -eq [IntPtr]::Zero) { throw "No window found matching title '$title'." }

        $r = New-Object McpsWin+RECT
        if (-not [McpsWin]::GetWindowRect($hwnd, [ref]$r)) { throw 'GetWindowRect failed.' }
        $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
        if ($w -le 0 -or $h -le 0) { throw 'Window has zero size (minimized?).' }

        $captured = $false
        $bmp = New-Object System.Drawing.Bitmap $w, $h
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $hdc = $g.GetHdc()
            try {
                $ok = [McpsWin]::PrintWindow($hwnd, $hdc, 2)  # PW_RENDERFULLCONTENT
            } finally { $g.ReleaseHdc($hdc) }
            if ($ok) { $captured = Test-HasVisibleContent $bmp }
        } catch { $captured = $false }
        finally { $g.Dispose() }

        if (-not $captured) {
            # Fallback: copy whatever is on screen at the window's rectangle.
            $bmp.Dispose()
            $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
            $rect = Get-ScreenRect $r.Left $r.Top $w $h
            if ($rect[2] -le 0 -or $rect[3] -le 0) { throw 'Window is off screen and PrintWindow failed.' }
            $bmp = New-Object System.Drawing.Bitmap $rect[2], $rect[3]
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try { $g.CopyFromScreen($rect[0], $rect[1], 0, 0, $bmp.Size) }
            finally { $g.Dispose() }
        }
        Save-Bitmap $bmp $env:MCPS_OUT
    }

    'list' {
        $items = [System.Collections.Generic.List[object]]::new()
        $fg = [McpsWin]::GetForegroundWindow()
        $cb = [McpsWin+EnumProc]{
            param($h, $l)
            if ([McpsWin]::IsWindowVisible($h)) {
                $sb = New-Object System.Text.StringBuilder 1024
                [void][McpsWin]::GetWindowText($h, $sb, 1024)
                $t = $sb.ToString()
                if ($t) {
                    $r = New-Object McpsWin+RECT
                    [void][McpsWin]::GetWindowRect($h, [ref]$r)
                    $pid2 = 0
                    [void][McpsWin]::GetWindowThreadProcessId($h, [ref]$pid2)
                    $items.Add([pscustomobject]@{
                        title      = $t
                        handle     = '0x{0:X}' -f $h.ToInt64()
                        pid        = $pid2
                        left       = $r.Left
                        top        = $r.Top
                        width      = $r.Right - $r.Left
                        height     = $r.Bottom - $r.Top
                        foreground = ($h -eq $fg)
                    })
                }
            }
            return $true
        }
        [void][McpsWin]::EnumWindows($cb, [IntPtr]::Zero)
        Write-Output (($items | ConvertTo-Json -Compress -Depth 3))
    }

    default { throw "Unknown MCPS_MODE '$mode'." }
}

# Opens the Study & Guard Manager as a standalone app window.
# Starts the local server first if it is not running.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = 'http://127.0.0.1:8765/admin'

function Test-Port {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8765); $c.Close(); return $true } catch { return $false }
}

if (-not (Test-Port)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { Add-Type -AssemblyName PresentationFramework; [Windows.MessageBox]::Show('Node.js was not found, so the manager cannot start.', 'Study & Guard Manager') | Out-Null; exit 1 }
    $server = Join-Path $root 'study-player\server.js'
    Start-Process -FilePath $node -ArgumentList "`"$server`" `"$root\config.json`" `"$root`"" -WindowStyle Hidden
    for ($i = 0; $i -lt 20 -and -not (Test-Port); $i++) { Start-Sleep -Milliseconds 500 }
}

$candidates = @(
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$url", '--window-size=1180,780'
} else {
    Start-Process $url
}

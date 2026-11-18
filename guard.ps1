# Runs from Task Scheduler (as SYSTEM). If the hosts file differs from the saved
# baseline, it restores the baseline and writes a line to guard.log.

$dir   = Join-Path $env:ProgramData 'HostsGuard'
$hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$good  = Join-Path $dir 'hosts.good'
$log   = Join-Path $dir 'guard.log'

if (-not (Test-Path $good)) { exit 1 }

for ($i = 1; $i -le 10; $i++) {
    try {
        $current  = (Get-FileHash $hosts -Algorithm SHA256).Hash
        $baseline = (Get-FileHash $good  -Algorithm SHA256).Hash
        if ($current -ne $baseline) {
            Copy-Item $good $hosts -Force
            ipconfig /flushdns | Out-Null
            Add-Content -Path $log -Value ("{0} hosts changed - restored" -f (Get-Date -Format s))
        }
        break
    }
    catch { Start-Sleep -Seconds 3 }
}

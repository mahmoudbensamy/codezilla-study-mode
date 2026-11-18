#Requires -RunAsAdministrator
<#
  HostsGuard installer.
  1. Writes a managed block to the hosts file blocking everything in blocked-domains.txt
  2. Saves the result as the baseline
  3. Registers a scheduled task (SYSTEM, at startup + every N minutes) that restores the baseline if the file changes
  4. Copies the browser extension (YouTube -> SoundCloud redirect) to a permanent folder
  Safe to run again: it replaces its own block instead of duplicating it.
#>
param([int]$IntervalMinutes = 0)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root 'common.ps1')

# --- settings from config.json (edited in the Study & Guard Manager) --------
$cfgFile = Join-Path $root 'config.json'
if (Test-Path $cfgFile) {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($nodeExe) {
        & $nodeExe (Join-Path $root 'generate.js')
        if ($LASTEXITCODE -ne 0) { throw 'generate.js failed - fix config.json and run install again.' }
    }
    if ($IntervalMinutes -le 0) { $IntervalMinutes = [int]((Get-Content $cfgFile -Raw | ConvertFrom-Json).guard.intervalMinutes) }
}
if ($IntervalMinutes -le 0) { $IntervalMinutes = 2 }

# --- read the domain list ---------------------------------------------------
$listFile = Join-Path $root 'blocked-domains.txt'
$domains = @(Get-Content $listFile | ForEach-Object { $_.Trim() } |
             Where-Object { $_ -and -not $_.StartsWith('#') })
if ($domains.Count -eq 0) { throw "blocked-domains.txt has no domains." }

# --- stop the guard first, so it cannot undo our own edit --------------------
Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction SilentlyContinue

# --- write the managed block -------------------------------------------------
$lines = Get-HostsWithoutBlock
$lines.Add('')
$lines.Add($script:BlockBegin)
foreach ($d in $domains) {
    $lines.Add("0.0.0.0 $d")
    $lines.Add(":: $d")
}
$lines.Add($script:BlockEnd)
Write-Hosts $lines
ipconfig /flushdns | Out-Null
Write-Host "[1/4] Blocked $($domains.Count) domains in the hosts file."

# --- data folder, baseline, guard script ------------------------------------
New-Item -ItemType Directory -Force $script:DataDir | Out-Null
Invoke-Retry { Copy-Item $script:HostsPath (Join-Path $script:DataDir 'hosts.good') -Force } | Out-Null
Copy-Item (Join-Path $root 'guard.ps1') (Join-Path $script:DataDir 'guard.ps1') -Force

# Standard users get read-only access, so only an administrator can change the guard.
icacls $script:DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
Write-Host "[2/4] Saved baseline and guard script to $script:DataDir"

# --- extension copy ---------------------------------------------------------
$extSrc = Join-Path $root 'extension'
$extDst = Join-Path $script:DataDir 'extension'
if (Test-Path $extSrc) {
    if (Test-Path $extDst) { Remove-Item $extDst -Recurse -Force }
    Copy-Item $extSrc $extDst -Recurse -Force
    # The browser writes a _metadata folder into extension folders it loads; never copy it.
    Remove-Item (Join-Path $extDst '_metadata') -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "[3/4] Extension copied to $extDst"

# --- scheduled task ---------------------------------------------------------
$guard   = Join-Path $script:DataDir 'guard.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
           -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$guard`""
$repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date) `
           -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
           -RepetitionDuration (New-TimeSpan -Days 3650)
$boot    = New-ScheduledTaskTrigger -AtStartup
$who     = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$set     = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
           -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $repeat, $boot `
    -Principal $who -Settings $set -Force | Out-Null
Start-ScheduledTask -TaskName $script:TaskName
Write-Host "[4/4] Scheduled task '$script:TaskName' registered (every $IntervalMinutes min and at startup)."

# --- study player: local page for the allowlisted YouTube study playlists ----
$spSrc = Join-Path $root 'study-player'
$spDst = Join-Path $script:DataDir 'study-player'
$node  = (Get-Command node -ErrorAction SilentlyContinue).Source
if ((Test-Path $spSrc) -and $node) {
    if (Test-Path $spDst) { Remove-Item $spDst -Recurse -Force }
    Copy-Item $spSrc $spDst -Recurse -Force
    $me    = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $spAct = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$node' '$spDst\server.js' '$root\config.json' '$root'`""
    $spTrg = New-ScheduledTaskTrigger -AtLogOn -User $me
    $spPri = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    $spSet = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName 'HostsGuardStudyPlayer' -Action $spAct -Trigger $spTrg `
        -Principal $spPri -Settings $spSet -Force | Out-Null
    # Restart the player now so a new copy takes effect without logging out.
    $old = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($old) {
        $p = Get-Process -Id $old.OwningProcess -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; Start-Sleep -Seconds 1 }
    }
    Start-ScheduledTask -TaskName 'HostsGuardStudyPlayer'
    Write-Host "[+] Study player will start at every login (127.0.0.1:8765) and was restarted now."
}
else {
    Write-Host '[!] Study player skipped (study-player folder or Node.js not found).'
}

Write-Host ''
Write-Host 'Done. To redirect YouTube and LinkedIn in Chrome/Brave/Edge:'
Write-Host '  1. Open chrome://extensions (or brave://extensions) and turn on Developer mode'
Write-Host "  2. Load unpacked -> $extDst (or press Reload if it is already loaded)"

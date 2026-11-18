#Requires -RunAsAdministrator
# Removes the scheduled task, the HostsGuard block in the hosts file, and the data folder.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root 'common.ps1')

# Task first, otherwise it would restore the blocked state right after we clean up.
Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'HostsGuardStudyPlayer' -Confirm:$false -ErrorAction SilentlyContinue

Write-Hosts (Get-HostsWithoutBlock)
ipconfig /flushdns | Out-Null

if (Test-Path $script:DataDir) { Remove-Item $script:DataDir -Recurse -Force }

Write-Host 'HostsGuard removed: task deleted, hosts file cleaned, data folder deleted.'
Write-Host 'If you loaded the browser extension, remove it from the extensions page too.'

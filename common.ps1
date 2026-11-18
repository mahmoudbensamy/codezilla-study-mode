# Shared helpers for HostsGuard install/uninstall scripts.

$script:HostsPath  = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$script:DataDir    = Join-Path $env:ProgramData 'HostsGuard'
$script:TaskName   = 'HostsGuard'
$script:BlockBegin = '# >>> HostsGuard >>>'
$script:BlockEnd   = '# <<< HostsGuard <<<'
$script:Utf8NoBom  = New-Object System.Text.UTF8Encoding($false)

# Windows Defender or other software can lock the hosts file for a few seconds.
# Retry instead of failing on the first "file is being used by another process".
function Invoke-Retry {
    param([scriptblock]$Action, [int]$Tries = 20, [int]$DelaySeconds = 3)
    for ($i = 1; $i -le $Tries; $i++) {
        try { return (& $Action) }
        catch {
            if ($i -eq $Tries) { throw }
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

# Returns the hosts file lines with any previous HostsGuard block removed.
function Get-HostsWithoutBlock {
    $lines = @(Invoke-Retry { [IO.File]::ReadAllLines($script:HostsPath) })
    $out = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($l in $lines) {
        if ($l.Trim() -eq $script:BlockBegin) { $skip = $true;  continue }
        if ($l.Trim() -eq $script:BlockEnd)   { $skip = $false; continue }
        if (-not $skip) { $out.Add($l) }
    }
    while ($out.Count -gt 0 -and [string]::IsNullOrWhiteSpace($out[$out.Count - 1])) {
        $out.RemoveAt($out.Count - 1)
    }
    return , $out
}

function Write-Hosts {
    param([System.Collections.Generic.List[string]]$Lines)
    Invoke-Retry { [IO.File]::WriteAllLines($script:HostsPath, $Lines.ToArray(), $script:Utf8NoBom) } | Out-Null
}

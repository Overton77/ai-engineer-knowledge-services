param([switch]$Remove, [switch]$Start)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$identity = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($repository))).Substring(0, 12)
$taskName = "KS-Git-Maintenance-$identity"
$marker = "Knowledge Services Git reconciliation for $repository"
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $marker) { throw 'Existing unrelated scheduled task preserved.' }
if ($Remove) {
    if ($existing) {
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Write-Output "Removed managed watcher: $taskName"
    exit
}
$shellPath = (Get-Process -Id $PID).Path
$runner = Join-Path $PSScriptRoot 'run-watcher.ps1'
$action = New-ScheduledTaskAction -Execute $shellPath -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$runner`"" -WorkingDirectory $repository
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $marker
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
if ($Start) { Start-ScheduledTask -TaskName $taskName }
Write-Output "Installed managed watcher: $taskName (current user must be signed in)"

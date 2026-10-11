<#
.SYNOPSIS
Registers the Windows scheduled task that prepares the morning inventory (D38, R9).

.DESCRIPTION
The inventory is mechanical and does not need Claude, so Windows prepares it: every day at
-At (default 06:00), and again at every logon. With StartWhenAvailable, a run missed while
the computer was off happens as soon as it is back. Running twice in a day is harmless: the
second run gives the same sheet with fresher counts.

The task runs as the current user, only while that user is logged on, without elevation.
It calls bin/run_inventory.ps1, which runs `python -m routine inventory` and appends one
line per run to <data>/inventory/task.log.

-DryRun builds the task in memory, prints it as JSON and registers nothing.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File bin\install_windows_task.ps1 -DataDir D:\routine-data -DryRun
#>
[CmdletBinding()]
param(
    [string]$DataDir = $env:ROUTINE_DATA_DIR,
    [string]$Python = "",
    [string]$At = "06:00",
    [string]$TaskName = "routine-inventory",
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $DataDir) { throw "No data folder: pass -DataDir or set ROUTINE_DATA_DIR." }
if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) {
    throw "The data folder does not exist: $DataDir"
}
$DataDir = (Resolve-Path -LiteralPath $DataDir).Path
if (-not $Python) { $Python = (Get-Command python -ErrorAction Stop).Source }

$user = "$env:USERDOMAIN\$env:USERNAME"
$runner = Join-Path $repo "bin\run_inventory.ps1"
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass " +
             "-File `"$runner`" -DataDir `"$DataDir`" -Python `"$Python`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $repo
$daily = New-ScheduledTaskTrigger -Daily -At $At
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger @($daily, $logon) -Settings $settings `
    -Principal $principal -Description "Prepares the routine's morning inventory (python -m routine inventory)."

$kinds = @{ "MSFT_TaskDailyTrigger" = "daily"; "MSFT_TaskLogonTrigger" = "logon" }
$summary = [ordered]@{
    registered         = $false
    name               = $TaskName
    StartWhenAvailable = [bool]$task.Settings.StartWhenAvailable
    triggers           = @($task.Triggers | ForEach-Object {
                             [ordered]@{ kind = $kinds[$_.CimClass.CimClassName]; start = $_.StartBoundary }
                         })
    action             = [ordered]@{ execute = $action.Execute; arguments = $action.Arguments;
                                     workdir = $action.WorkingDirectory }
    user               = $user
}

if (-not $DryRun) {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    $summary.registered = $true
}
$summary | ConvertTo-Json -Depth 5

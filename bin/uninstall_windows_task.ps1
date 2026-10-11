<#
.SYNOPSIS
Removes the scheduled task registered by install_windows_task.ps1. The data folder and its
inventories are left untouched.

-DryRun only says whether the task exists.
#>
[CmdletBinding()]
param(
    [string]$TaskName = "routine-inventory",
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$result = [ordered]@{ name = $TaskName; existed = [bool]$task; removed = $false }
if ($task -and -not $DryRun) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    $result.removed = $true
}
$result | ConvertTo-Json

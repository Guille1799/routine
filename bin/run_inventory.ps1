<#
.SYNOPSIS
What the scheduled task runs: `python -m routine inventory`, with one log line per run.

The log is <data>/inventory/task.log. A failed run is written there too, so a missing
sheet in the morning can be explained instead of guessed.
#>
param(
    [Parameter(Mandatory = $true)][string]$DataDir,
    [string]$Python = "python"
)
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:ROUTINE_DATA_DIR = $DataDir
$log = Join-Path $DataDir "inventory\task.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

Push-Location $repo
try {
    $out = (& $Python -m routine inventory 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
} catch {
    $out = "could not run python: $_"
    $code = 3
} finally {
    Pop-Location
}
"$(Get-Date -Format o) exit=$code $out" | Add-Content -LiteralPath $log -Encoding utf8
exit $code

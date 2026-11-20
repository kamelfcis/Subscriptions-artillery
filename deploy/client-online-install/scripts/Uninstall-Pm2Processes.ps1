# Stops/deletes SubscriptionsAPI + SubscriptionsWeb from PM2 and removes boot task.
# Does NOT touch SQL databases or project source.

[CmdletBinding()]
param(
  [string]$PackageRoot
)

$ErrorActionPreference = 'Continue'

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
  $PackageRoot = Split-Path -Parent $PSScriptRoot
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

Refresh-Path
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  Write-Host 'pm2 not found — nothing to uninstall.' -ForegroundColor Yellow
} else {
  foreach ($n in @('SubscriptionsAPI', 'SubscriptionsWeb', 'SubscriptionsPrint')) {
    Write-Host "pm2 delete $n"
    & pm2 delete $n 2>$null | Out-Null
  }
  & pm2 save 2>$null | Out-Null
  Write-Host 'PM2 apps removed and dump saved.' -ForegroundColor Green
}

schtasks.exe /Delete /TN 'SubscriptionsPM2-Resurrect' /F 2>$null | Out-Null
$startupCmd = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\SubscriptionsPM2-Resurrect.cmd'
if (Test-Path -LiteralPath $startupCmd) {
  Remove-Item -LiteralPath $startupCmd -Force
  Write-Host "Removed Startup hook: $startupCmd" -ForegroundColor Green
}
Write-Host 'Boot task SubscriptionsPM2-Resurrect removed (if it existed).' -ForegroundColor Green
Write-Host 'Database was not modified.' -ForegroundColor DarkGray

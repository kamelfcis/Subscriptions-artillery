# Stops and removes SubscriptionsAPI + SubscriptionsWeb Windows services (WinSW).
# Requires Administrator. Does not touch SQL databases or project source.

[CmdletBinding()]
param(
  [string]$PackageRoot
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
  $PackageRoot = Split-Path -Parent $PSScriptRoot
}
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$ServicesDir = Join-Path $PackageRoot 'services'

function Test-IsAdmin {
  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  Write-Host 'Uninstall needs Administrator. Re-launching elevated...' -ForegroundColor Yellow
  $argList = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', $PSCommandPath,
    '-PackageRoot', $PackageRoot
  )
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
  if ($null -eq $p -or $p.ExitCode -ne 0) {
    throw "Elevated uninstall failed (exit $(if ($p) { $p.ExitCode } else { 'unknown' }))."
  }
  return
}

foreach ($id in @('SubscriptionsAPI', 'SubscriptionsWeb')) {
  $exe = Join-Path $ServicesDir "$id.exe"
  $svc = Get-Service -Name $id -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Stopped') {
    Write-Host "Stopping $id ..." -ForegroundColor Yellow
    Stop-Service -Name $id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  if (Test-Path -LiteralPath $exe) {
    Write-Host "WinSW uninstall $id ..." -ForegroundColor Cyan
    & $exe uninstall 2>$null | Out-Null
  }
  $svc = Get-Service -Name $id -ErrorAction SilentlyContinue
  if ($svc) {
    sc.exe delete $id | Out-Null
    Write-Host "sc delete $id" -ForegroundColor Cyan
  } else {
    Write-Host "$id removed (or was not installed)." -ForegroundColor Green
  }
}

Write-Host 'Done. Project files and SQL data were not modified.' -ForegroundColor Green

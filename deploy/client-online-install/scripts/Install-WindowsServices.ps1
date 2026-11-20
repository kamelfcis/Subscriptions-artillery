# Installs SubscriptionsAPI + SubscriptionsWeb as Automatic Windows services (WinSW).
# Survives logoff and reboot. Requires Administrator.
#
# Does NOT modify SQL databases. Does NOT set NODE_ENV=production (LAN HTTP cookies).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [string]$PackageRoot,
  [switch]$SkipStart,
  [switch]$ForceReinstall
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
  $PackageRoot = Split-Path -Parent $PSScriptRoot
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path

$ToolsDir = Join-Path $PackageRoot 'tools'
$ServicesDir = Join-Path $PackageRoot 'services'
$WinSwSource = Join-Path $ToolsDir 'WinSW-x64.exe'
$WinSwUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'

$ApiId = 'SubscriptionsAPI'
$WebId = 'SubscriptionsWeb'

function Test-IsAdmin {
  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NodeExePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'node.exe not found on PATH. Install Node.js LTS first.' }
  $path = $cmd.Source
  if ($path -like '*.cmd' -or $path -like '*.bat') {
    $candidate = Join-Path (Split-Path $path -Parent) 'node.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Resolved node path is missing: $path"
  }
  return $path
}

function Ensure-WinSW {
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  if (Test-Path -LiteralPath $WinSwSource) {
    Write-Host "WinSW present: $WinSwSource" -ForegroundColor Green
    return
  }
  Write-Host "Downloading WinSW to $WinSwSource ..." -ForegroundColor Cyan
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $WinSwUrl -OutFile $WinSwSource -UseBasicParsing
  } catch {
    throw "Failed to download WinSW. Place WinSW-x64.exe manually in $ToolsDir then re-run. $($_.Exception.Message)"
  }
  if (-not (Test-Path -LiteralPath $WinSwSource)) {
    throw "WinSW download did not create $WinSwSource"
  }
}

function Write-ServiceXml {
  param(
    [string]$Id,
    [string]$DisplayName,
    [string]$Description,
    [string]$NodeExe,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$LogDirectory
  )
  New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
  # Escape XML special chars in paths
  function Esc([string]$s) {
    return ($s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;' -replace '"', '&quot;')
  }
  $xml = @"
<service>
  <id>$Id</id>
  <name>$DisplayName</name>
  <description>$Description</description>
  <executable>$(Esc $NodeExe)</executable>
  <arguments>$(Esc $Arguments)</arguments>
  <workingdirectory>$(Esc $WorkingDirectory)</workingdirectory>
  <logpath>$(Esc $LogDirectory)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="5 sec"/>
  <resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
</service>
"@
  $xmlPath = Join-Path $ServicesDir "$Id.xml"
  Set-Content -LiteralPath $xmlPath -Value $xml -Encoding UTF8
  return $xmlPath
}

function Stop-ServiceIfExists([string]$Name) {
  $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Stopped') {
    Write-Host "Stopping service $Name ..." -ForegroundColor Yellow
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Uninstall-WinSwService {
  param([string]$Id, [string]$ExePath)
  Stop-ServiceIfExists $Id
  if (Test-Path -LiteralPath $ExePath) {
    & $ExePath uninstall 2>$null | Out-Null
  }
  # Fallback if WinSW uninstall left the service
  $svc = Get-Service -Name $Id -ErrorAction SilentlyContinue
  if ($svc) {
    sc.exe delete $Id | Out-Null
    Start-Sleep -Seconds 1
  }
}

function Install-OneService {
  param(
    [string]$Id,
    [string]$DisplayName,
    [string]$Description,
    [string]$NodeExe,
    [string]$Arguments,
    [string]$WorkingDirectory
  )
  $exePath = Join-Path $ServicesDir "$Id.exe"
  $logDir = Join-Path $ServicesDir 'logs'
  Copy-Item -LiteralPath $WinSwSource -Destination $exePath -Force
  Write-ServiceXml -Id $Id -DisplayName $DisplayName -Description $Description `
    -NodeExe $NodeExe -Arguments $Arguments -WorkingDirectory $WorkingDirectory -LogDirectory $logDir | Out-Null

  if ($ForceReinstall) {
    Uninstall-WinSwService -Id $Id -ExePath $exePath
  } else {
    $existing = Get-Service -Name $Id -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Host "Service $Id already registered — refreshing config and restarting..." -ForegroundColor Cyan
      Stop-ServiceIfExists $Id
      # Refresh EXE + XML; WinSW update may require uninstall/reinstall if binary changed
      & $exePath uninstall 2>$null | Out-Null
      Start-Sleep -Seconds 1
    }
  }

  Write-Host "Installing service $Id ..." -ForegroundColor Cyan
  & $exePath install
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    # WinSW often returns 0; still verify service exists
  }
  $svc = Get-Service -Name $Id -ErrorAction SilentlyContinue
  if (-not $svc) {
    throw "Service $Id was not created. Run this script as Administrator."
  }

  # Ensure Automatic (Delayed)
  sc.exe config $Id start= delayed-auto | Out-Null

  if (-not $SkipStart) {
    Write-Host "Starting service $Id ..." -ForegroundColor Cyan
    Start-Service -Name $Id
    Start-Sleep -Seconds 2
    $svc.Refresh()
    if ((Get-Service -Name $Id).Status -ne 'Running') {
      Write-Host "Warning: $Id is not Running yet. Check logs under $logDir" -ForegroundColor Yellow
    } else {
      Write-Host "$Id is Running." -ForegroundColor Green
    }
  }
}

# --- elevation ---
if (-not (Test-IsAdmin)) {
  Write-Host 'Windows service install needs Administrator. Re-launching elevated...' -ForegroundColor Yellow
  $argList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $PSCommandPath,
    '-RepoRoot', $RepoRoot,
    '-PackageRoot', $PackageRoot
  )
  if ($SkipStart) { $argList += '-SkipStart' }
  if ($ForceReinstall) { $argList += '-ForceReinstall' }
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
  if ($null -eq $p -or $p.ExitCode -ne 0) {
    $code = if ($p) { $p.ExitCode } else { 'unknown' }
    throw "Elevated service install failed (exit $code). Approve UAC or run Install-ClientOnline.bat as Administrator."
  }
  return
}

$serverDir = Join-Path $RepoRoot 'server'
$webDir = Join-Path $RepoRoot 'web'
$viteJs = Join-Path $webDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath (Join-Path $serverDir 'src\index.js'))) {
  throw "API entry missing: $serverDir\src\index.js"
}
if (-not (Test-Path -LiteralPath $viteJs)) {
  throw "Vite missing at $viteJs — run npm install in web first."
}

New-Item -ItemType Directory -Force -Path $ServicesDir | Out-Null
Ensure-WinSW
$nodeExe = Get-NodeExePath
Write-Host "Using node: $nodeExe" -ForegroundColor DarkGray

# Free ports if old console node/vite still listening (do not touch SQL).
foreach ($port in @(5050, 5173)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.OwningProcess -gt 0) {
      Write-Host "Freeing TCP $port (PID $($_.OwningProcess)) before service start..." -ForegroundColor Yellow
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}
Start-Sleep -Seconds 1

Install-OneService `
  -Id $ApiId `
  -DisplayName 'SubscriptionsAPI' `
  -Description 'Subscriptions Enterprise Node API (port 5050). Uses server/.env. Do not set NODE_ENV=production for LAN HTTP.' `
  -NodeExe $nodeExe `
  -Arguments 'src/index.js' `
  -WorkingDirectory $serverDir

# Relative vite path — workingdirectory is web/
Install-OneService `
  -Id $WebId `
  -DisplayName 'SubscriptionsWeb' `
  -Description 'Subscriptions Enterprise Vite web UI (port 5173, host 0.0.0.0) with /api proxy to 5050.' `
  -NodeExe $nodeExe `
  -Arguments 'node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173' `
  -WorkingDirectory $webDir

Write-Host ''
Write-Host 'Windows services installed:' -ForegroundColor Green
Write-Host "  $ApiId  (API :5050)   Automatic (Delayed Start)"
Write-Host "  $WebId  (Web :5173)   Automatic (Delayed Start)"
Write-Host 'Logs: ' (Join-Path $ServicesDir 'logs')
Write-Host ''
Write-Host 'Manage with:' -ForegroundColor Cyan
Write-Host '  sc start SubscriptionsAPI & sc start SubscriptionsWeb'
Write-Host '  sc stop  SubscriptionsAPI & sc stop  SubscriptionsWeb'
Write-Host '  sc query SubscriptionsAPI'
Write-Host '  services.msc  (look for SubscriptionsAPI / SubscriptionsWeb)'
Write-Host ''
Write-Host 'SQL note: services run as Local System. For SQL Windows auth, grant NT AUTHORITY\SYSTEM' -ForegroundColor DarkYellow
Write-Host 'access to the database, or switch server/.env to SQL_AUTH=sql with a SQL login.' -ForegroundColor DarkYellow

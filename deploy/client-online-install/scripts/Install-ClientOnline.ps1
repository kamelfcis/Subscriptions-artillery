# Online client-site installer for Subscriptions Enterprise.
# Creates/updates server/.env, npm installs, applies migrations 01,02,04,05,07-11 on Subscriptions2,
# optional admin bootstrap, then starts API + web under PM2 (pm2 startup + pm2 save)
# so they survive terminal close and reboot. Optional -UseWindowsServices for legacy WinSW.
#
# Does NOT run staging fee seeds (02-05).
# Refuses App* migration against live [Subscriptions] on DESKTOP-2OFCNI4.

[CmdletBinding()]
param(
  [string]$SqlServer,
  [string]$SqlDatabase = 'Subscriptions2',
  [switch]$SkipMigration,
  [switch]$SkipBootstrap,
  [switch]$SkipStart,
  [switch]$SkipPrintAgent,
  [switch]$SkipPm2,
  [switch]$UseWindowsServices,
  [switch]$SkipServices,
  [switch]$ForceServiceReinstall
)

$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $PackageRoot '..\..')).Path

Write-Host ''
Write-Host '=== Subscriptions Enterprise — Client Online Install ===' -ForegroundColor Cyan
Write-Host "Package: $PackageRoot"
Write-Host "Repo:    $RepoRoot"
Write-Host "Host:    $env:COMPUTERNAME"
Write-Host ''

function Test-NodeReady {
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  return ($null -ne $node -and $null -ne $npm)
}

function Ensure-NodeJs {
  if (Test-NodeReady) {
    Write-Host "Node.js: $(node --version)" -ForegroundColor Green
    Write-Host "npm:     $(npm --version)" -ForegroundColor Green
    return
  }

  Write-Host 'Node.js / npm not found on PATH.' -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    $ans = Read-Host 'Install Node.js LTS with winget now? [Y/n]'
    if ([string]::IsNullOrWhiteSpace($ans) -or $ans -match '^[Yy]') {
      Write-Host 'Installing OpenJS.NodeJS.LTS via winget...' -ForegroundColor Cyan
      & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                  [System.Environment]::GetEnvironmentVariable('Path', 'User')
      if (Test-NodeReady) {
        Write-Host "Node.js ready: $(node --version)" -ForegroundColor Green
        return
      }
      Write-Host 'winget finished but node is still not on PATH in this session.' -ForegroundColor Yellow
      Write-Host 'Close this window, open a new Command Prompt, and re-run Install-ClientOnline.bat.' -ForegroundColor Yellow
      exit 1
    }
  }

  Write-Host 'Install Node.js 20+ LTS from: https://nodejs.org/' -ForegroundColor Yellow
  $open = Read-Host 'Open the download page in your browser? [Y/n]'
  if ([string]::IsNullOrWhiteSpace($open) -or $open -match '^[Yy]') {
    Start-Process 'https://nodejs.org/'
  }
  throw 'Node.js is required. Install LTS, then re-run this installer.'
}

function Invoke-NpmInstall([string]$dir, [string]$label) {
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
    throw "package.json missing in $dir"
  }
  Write-Host "npm install ($label) ..." -ForegroundColor Cyan
  Push-Location $dir
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed in $dir (exit $LASTEXITCODE)" }
  }
  finally {
    Pop-Location
  }
}

# --- Guardrails ---
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'server\package.json'))) {
  throw "Repo root looks wrong ($RepoRoot). Keep this package under deploy\client-online-install inside the full project tree."
}

Ensure-NodeJs

# --- SQL Server / database prompts ---
$defaultServer = $env:COMPUTERNAME
if ([string]::IsNullOrWhiteSpace($SqlServer)) {
  $prompt = "Enter SQL Server name or IP [$defaultServer]"
  $entered = Read-Host $prompt
  if ([string]::IsNullOrWhiteSpace($entered)) {
    $SqlServer = $defaultServer
  } else {
    $SqlServer = $entered.Trim()
  }
}

$dbPrompt = "Enter SQL database name [$SqlDatabase]"
$dbEntered = Read-Host $dbPrompt
if (-not [string]::IsNullOrWhiteSpace($dbEntered)) {
  $SqlDatabase = $dbEntered.Trim()
}

Write-Host ''
Write-Host "Will use SQL_SERVER=$SqlServer  SQL_DATABASE=$SqlDatabase  SQL_AUTH=windows" -ForegroundColor Cyan
$confirm = Read-Host 'Continue? [Y/n]'
if ($confirm -match '^[Nn]') {
  Write-Host 'Cancelled.'
  exit 0
}

if ($SqlDatabase -ieq 'Subscriptions' -and -not $SkipMigration) {
  Write-Host ''
  Write-Host 'REFUSED: This installer never migrates live [Subscriptions].' -ForegroundColor Red
  Write-Host 'Keep the legacy app on [Subscriptions]; use default [Subscriptions2] for this package.' -ForegroundColor Red
  exit 2
}

function Test-SqlDatabaseExists([string]$Server, [string]$Db) {
  if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { return $null }
  $q = "SET NOCOUNT ON; SELECT CASE WHEN DB_ID(N'$Db') IS NULL THEN 0 ELSE 1 END;"
  $out = & sqlcmd -S $Server -d master -E -b -W -h -1 -Q $q 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return (($out | Out-String).Trim() -eq '1')
}

# --- .env ---
& (Join-Path $PSScriptRoot 'Update-ServerEnv.ps1') `
  -RepoRoot $RepoRoot `
  -SqlServer $SqlServer `
  -SqlDatabase $SqlDatabase `
  -SqlAuth 'windows'

# --- frontend API bridge (VITE_API_BASE=/api + vite proxy check) ---
& (Join-Path $PSScriptRoot 'Ensure-FrontendApiBridge.ps1') -RepoRoot $RepoRoot

# --- npm install ---
Invoke-NpmInstall (Join-Path $RepoRoot 'server') 'server'
Invoke-NpmInstall (Join-Path $RepoRoot 'web') 'web'

# --- Windows Firewall for LAN access (TCP 5173 web, 5050 API) ---
Write-Host ''
Write-Host 'Opening Windows Firewall for LAN web/API access...' -ForegroundColor Cyan
try {
  & (Join-Path $PSScriptRoot 'Open-ClientFirewall.ps1') -Ports '5173,5050,5678'
} catch {
  Write-Host "Firewall setup warning: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host 'You can re-run scripts\Open-ClientFirewall.ps1 as Administrator later.' -ForegroundColor Yellow
}

# --- Subscriptions2 copy + full client migrations ---
if (-not $SkipMigration) {
  if ($SqlDatabase -ieq 'Subscriptions2') {
    $exists = Test-SqlDatabaseExists -Server $SqlServer -Db 'Subscriptions2'
    if ($exists -eq $false) {
      Write-Host ''
      Write-Host '[Subscriptions2] not found. Will COPY_ONLY backup [Subscriptions] and RESTORE as Subscriptions2.' -ForegroundColor Yellow
      $prep = Read-Host 'Run Prepare-Subscriptions2.ps1 now? [Y/n]'
      if ([string]::IsNullOrWhiteSpace($prep) -or $prep -match '^[Yy]') {
        & (Join-Path $PSScriptRoot 'Prepare-Subscriptions2.ps1') -SqlServer $SqlServer
      } else {
        throw 'Subscriptions2 is required. Create it with scripts\Prepare-Subscriptions2.ps1 or choose another database.'
      }
    }
  }

  Write-Host ''
  Write-Host 'Applying client migrations (01,02,04,05,07-11; skips 03/06)...' -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot 'Apply-AdditiveMigration.ps1') `
    -SqlServer $SqlServer `
    -SqlDatabase $SqlDatabase `
    -RepoRoot $RepoRoot
} else {
  Write-Host 'Skipping migration (-SkipMigration).' -ForegroundColor Yellow
}

# --- optional bootstrap / reset admin (default password 12345678 = digits 1-8) ---
if (-not $SkipBootstrap) {
  Write-Host ''
  $boot = Read-Host 'Create or reset admin user? Default password is 12345678 [Y/n]'
  if ([string]::IsNullOrWhiteSpace($boot) -or $boot -match '^[Yy]') {
    $pwdIn = Read-Host 'Admin password (blank = 12345678)'
    Push-Location (Join-Path $RepoRoot 'server')
    try {
      if (-not [string]::IsNullOrWhiteSpace($pwdIn)) {
        $env:BOOTSTRAP_PASSWORD = $pwdIn
      } else {
        $env:BOOTSTRAP_PASSWORD = '12345678'
      }
      & npm run bootstrap-admin -- admin
      if ($LASTEXITCODE -ne 0) {
        Write-Host 'bootstrap-admin reported an error. Continuing.' -ForegroundColor Yellow
      } else {
        $shown = if ([string]::IsNullOrWhiteSpace($pwdIn)) { '12345678' } else { '(custom password you entered)' }
        Write-Host ("Admin login: username=admin  password={0}" -f $shown) -ForegroundColor Green
      }
    }
    finally {
      Remove-Item Env:BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
      Pop-Location
    }
  }
}

# --- start API + web under PM2 (preferred) / optional WinSW / console fallback ---
if (-not $SkipStart) {
  $startedManaged = $false
  $managedVia = ''

  # Default: PM2 (caller-requested). -SkipPm2 or -SkipServices skips PM2.
  $wantPm2 = -not $SkipPm2 -and -not $SkipServices
  if ($wantPm2) {
    Write-Host ''
    Write-Host 'Starting API + web with PM2 (SubscriptionsAPI :5050, SubscriptionsWeb :5173)...' -ForegroundColor Cyan
    try {
      & (Join-Path $PSScriptRoot 'Install-Pm2Processes.ps1') -RepoRoot $RepoRoot -PackageRoot $PackageRoot
      $startedManaged = $true
      $managedVia = 'pm2'
    } catch {
      Write-Host "PM2 setup warning: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host 'Will try Windows services or console fallback.' -ForegroundColor Yellow
      $startedManaged = $false
    }
  } else {
    Write-Host 'Skipped PM2 (-SkipPm2 / -SkipServices).' -ForegroundColor Yellow
  }

  # Optional legacy WinSW path
  if (-not $startedManaged -and $UseWindowsServices) {
    Write-Host ''
    Write-Host 'Registering WinSW Windows services (optional fallback)...' -ForegroundColor Cyan
    try {
      $svcArgs = @{
        RepoRoot    = $RepoRoot
        PackageRoot = $PackageRoot
      }
      if ($ForceServiceReinstall) { $svcArgs['ForceReinstall'] = $true }
      & (Join-Path $PSScriptRoot 'Install-WindowsServices.ps1') @svcArgs
      $startedManaged = $true
      $managedVia = 'winsw'
    } catch {
      Write-Host "Windows service install warning: $($_.Exception.Message)" -ForegroundColor Yellow
      $startedManaged = $false
    }
  }

  if (-not $startedManaged) {
    Write-Host ''
    Write-Host 'Starting API (0.0.0.0:5050) and web (0.0.0.0:5173) in new windows...' -ForegroundColor Cyan
    $serverCmd = "cd /d `"$RepoRoot\server`" && npm run start"
    $webCmd = "cd /d `"$RepoRoot\web`" && npx vite --host 0.0.0.0 --port 5173"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $serverCmd -WorkingDirectory (Join-Path $RepoRoot 'server')
    Start-Sleep -Seconds 2
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $webCmd -WorkingDirectory (Join-Path $RepoRoot 'web')
  }

  Write-Host ''
  Write-Host 'Verifying frontend and backend can see each other...' -ForegroundColor Cyan
  try {
    & (Join-Path $PSScriptRoot 'Ensure-FrontendApiBridge.ps1') -RepoRoot $RepoRoot -Verify -TimeoutSec 90
  } catch {
    Write-Host "Bridge verify warning: $($_.Exception.Message)" -ForegroundColor Yellow
    if ($managedVia -eq 'pm2') {
      Write-Host 'Check: pm2 status / pm2 logs SubscriptionsAPI / pm2 logs SubscriptionsWeb' -ForegroundColor Yellow
    } elseif ($managedVia -eq 'winsw') {
      Write-Host 'Check: sc query SubscriptionsAPI / services\logs\' -ForegroundColor Yellow
    } else {
      Write-Host 'Check the two new console windows; you can re-run Ensure-FrontendApiBridge.ps1 -Verify.' -ForegroundColor Yellow
    }
  }

  if (-not $SkipPrintAgent) {
    Write-Host ''
    Write-Host 'Configuring Card Print Agent (:5678) + PM2 SubscriptionsPrint when PM2 is active...' -ForegroundColor Cyan
    try {
      $printArgs = @{
        PackageRoot = $PackageRoot
        RepoRoot    = $RepoRoot
      }
      if ($managedVia -eq 'pm2') { $printArgs['RegisterPm2'] = $true }
      & (Join-Path $PSScriptRoot 'Start-PrintAgent.ps1') @printArgs
    } catch {
      Write-Host "Print agent warning: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host 'Rebuild payload: scripts\Build-ClientDeployPackage.ps1' -ForegroundColor Yellow
    }
  } else {
    Write-Host 'Skipped print agent (-SkipPrintAgent).' -ForegroundColor Yellow
  }

  & (Join-Path $PSScriptRoot 'Show-LanAccessInfo.ps1') -WebPort 5173 -ApiPort 5050
  if ($managedVia -eq 'pm2') {
    Write-Host 'API/Web/Print run under PM2 (SubscriptionsAPI, SubscriptionsWeb, SubscriptionsPrint) — survive reboot via pm2 save + resurrect.' -ForegroundColor Green
    Write-Host 'Manage: pm2 status | pm2 restart all | pm2 stop all  — see PM2.md' -ForegroundColor DarkYellow
  } elseif ($managedVia -eq 'winsw') {
    Write-Host 'API/Web run as Windows services (SubscriptionsAPI, SubscriptionsWeb).' -ForegroundColor Green
    Write-Host 'Manage: sc start/stop SubscriptionsAPI|SubscriptionsWeb — see SERVICES.md' -ForegroundColor DarkYellow
  } else {
    Write-Host 'Leave the API, web, and print-agent windows open while using the app.' -ForegroundColor DarkYellow
  }
} else {
  Write-Host 'Skipped start (-SkipStart). Use scripts\Install-Pm2Processes.ps1 or Show-LanAccessInfo.ps1 when ready.' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'Show-LanAccessInfo.ps1') -WebPort 5173 -ApiPort 5050
  if (-not $SkipPrintAgent) {
    Write-Host 'Print agent was not started because -SkipStart was set. Use scripts\Start-PrintAgent.ps1 when ready.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Client online install finished.' -ForegroundColor Green
Write-Host 'Legacy desktop app: SQL [Subscriptions]. This package default: [Subscriptions2] (parallel, live DB untouched).' -ForegroundColor DarkGray

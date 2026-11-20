# Starts Card Print Agent for LAN clients (default bind http://+:5678/).
# Reads PRINT_AGENT_HOST.txt (LAN IP, or + / 0.0.0.0 for all interfaces).
# Keeps PRINT_AGENT_KEY.txt auth. Writes VITE_PRINT_AGENT_URL into web/.env.local.
param(
  [string]$PackageRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$RepoRoot = '',
  [string]$HostBind = '',
  [int]$Port = 5678,
  [switch]$SkipStart,
  [switch]$RegisterPm2
)

$PrintPm2Name = 'SubscriptionsPrint'

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PackageRoot '..\..')).Path
}

function New-PrintKey {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Get-PrimaryLanIPv4 {
  try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -ne '127.0.0.1' -and
        $_.IPAddress -notlike '169.254.*' -and
        ($_.AddressState -eq 'Preferred' -or -not $_.AddressState)
      } |
      Sort-Object InterfaceMetric |
      Select-Object -ExpandProperty IPAddress -Unique)
    if ($ips.Count -gt 0) { return $ips[0] }
  } catch { }
  return $null
}

function Get-LanOriginList([string]$PrimaryIp) {
  $origins = [System.Collections.Generic.List[string]]::new()
  foreach ($o in @(
      'http://localhost:5173', 'http://127.0.0.1:5173',
      'http://localhost:5050', 'http://127.0.0.1:5050'
    )) { $origins.Add($o) }
  try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*'
      } | Select-Object -ExpandProperty IPAddress -Unique)
    foreach ($ip in $ips) {
      $origins.Add("http://${ip}:5173")
      $origins.Add("http://${ip}:5050")
    }
  } catch { }
  if ($PrimaryIp) {
    $origins.Add("http://${PrimaryIp}:5173")
    $origins.Add("http://${PrimaryIp}:5050")
  }
  return ($origins | Select-Object -Unique) -join ','
}

function Ensure-UrlAcl([string]$Prefix) {
  $existing = & netsh http show urlacl url=$Prefix 2>$null | Out-String
  if ($existing -match [regex]::Escape($Prefix)) {
    Write-Host "URL ACL already present for $Prefix" -ForegroundColor Green
    return
  }
  Write-Host "Registering URL ACL for $Prefix ..." -ForegroundColor Cyan
  $user = "$env:USERDOMAIN\$env:USERNAME"
  & netsh http add urlacl url=$Prefix user=$user
  if ($LASTEXITCODE -ne 0) {
    & netsh http add urlacl url=$Prefix user=Everyone
  }
}

$keyDir = Join-Path $PackageRoot 'payload\print-agent'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

$hostFile = Join-Path $keyDir 'PRINT_AGENT_HOST.txt'
if ([string]::IsNullOrWhiteSpace($HostBind)) {
  if (Test-Path -LiteralPath $hostFile) {
    $HostBind = (Get-Content -LiteralPath $hostFile -Raw -Encoding UTF8).Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($HostBind)) {
  $HostBind = '+'
  Set-Content -LiteralPath $hostFile -Value $HostBind -Encoding UTF8
  Write-Host "Wrote default PRINT_AGENT_HOST.txt = + (all interfaces). Edit this file to pin a LAN IP." -ForegroundColor Yellow
}

$primaryIp = Get-PrimaryLanIPv4
# Public URL clients use: prefer explicit IP file if it looks like an IP, else detected LAN IP.
$publicIp = $HostBind
if ($HostBind -in @('+', '*', '0.0.0.0')) {
  if (-not $primaryIp) { throw 'Could not detect LAN IP. Put the server IP in PRINT_AGENT_HOST.txt' }
  $publicIp = $primaryIp
}

$payloadExe = Join-Path $keyDir 'CardPrintAgent.exe'
$repoPublishExe = Join-Path $RepoRoot 'print-agent\bin\Release\net8.0-windows\win-x64\publish\CardPrintAgent.exe'
$repoBuildExe = Join-Path $RepoRoot 'print-agent\bin\Release\net8.0-windows\win-x64\CardPrintAgent.exe'
$exe = $null
foreach ($candidate in @($payloadExe, $repoPublishExe, $repoBuildExe)) {
  if (Test-Path -LiteralPath $candidate) { $exe = $candidate; break }
}
if (-not $exe) {
  throw "CardPrintAgent.exe not found. Run scripts\Build-ClientDeployPackage.ps1 first."
}

$keyFile = Join-Path $keyDir 'PRINT_AGENT_KEY.txt'
if (Test-Path -LiteralPath $keyFile) {
  $key = (Get-Content -LiteralPath $keyFile -Raw -Encoding UTF8).Trim()
} else {
  $key = New-PrintKey
  Set-Content -LiteralPath $keyFile -Value $key -Encoding UTF8
  Write-Host "Generated PRINT_AGENT_KEY -> $keyFile" -ForegroundColor Green
}
if ($key.Length -lt 32) { throw "PRINT_AGENT_KEY in $keyFile must be at least 32 characters." }

$origins = Get-LanOriginList $publicIp
Set-Content -LiteralPath (Join-Path $keyDir 'PRINT_AGENT_ORIGINS.txt') -Value $origins -Encoding UTF8

$agentUrl = "http://${publicIp}:${Port}"
Set-Content -LiteralPath (Join-Path $keyDir 'PRINT_AGENT_URL.txt') -Value $agentUrl -Encoding UTF8

# Keep web app pointed at the same LAN print URL + embed print key for staff UI
$webEnv = Join-Path $RepoRoot 'web\.env.local'
$envLines = @()
if (Test-Path -LiteralPath $webEnv) {
  $envLines = @(Get-Content -LiteralPath $webEnv -Encoding UTF8 | Where-Object {
    $_ -notmatch '^\s*VITE_PRINT_AGENT_URL\s*=' -and $_ -notmatch '^\s*VITE_PRINT_AGENT_KEY\s*='
  })
}
if (-not ($envLines | Where-Object { $_ -match '^\s*VITE_API_BASE\s*=' })) {
  $envLines += 'VITE_API_BASE=/api'
}
$envLines += "VITE_PRINT_AGENT_URL=$agentUrl"
$envLines += "VITE_PRINT_AGENT_KEY=$key"
Set-Content -LiteralPath $webEnv -Value ($envLines -join "`r`n") -Encoding UTF8
Write-Host "Updated web/.env.local -> VITE_PRINT_AGENT_URL / VITE_PRINT_AGENT_KEY" -ForegroundColor Green

function Invoke-Pm2Simple {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Pm2Args)
  $argLine = ($Pm2Args | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  cmd /c "pm2 $argLine"
  return $LASTEXITCODE
}

function Register-PrintAgentWithPm2([string]$LauncherPath, [string]$WorkDir) {
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue) -and -not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) {
    throw 'PM2 not on PATH; cannot register SubscriptionsPrint.'
  }
  Write-Host "Registering PM2 app $PrintPm2Name ..." -ForegroundColor Cyan
  Invoke-Pm2Simple delete $PrintPm2Name 2>$null | Out-Null
  $launcherEsc = $LauncherPath -replace '\\', '/'
  $code = Invoke-Pm2Simple start $launcherEsc --name $PrintPm2Name --cwd ($WorkDir -replace '\\', '/') --interpreter cmd --interpreter-args '/c'
  if ($code -ne 0) {
  $code = Invoke-Pm2Simple start $LauncherPath --name $PrintPm2Name
  }
  if ($code -ne 0) { throw "pm2 start $PrintPm2Name failed (exit $code)" }
  Invoke-Pm2Simple save | Out-Null
  Write-Host "$PrintPm2Name registered under PM2 (port $Port)." -ForegroundColor Green
}

# HttpListener wants + for all interfaces
$listenHost = $HostBind
if ($listenHost -in @('0.0.0.0', '*')) { $listenHost = '+' }
$prefix = "http://${listenHost}:${Port}/"
Ensure-UrlAcl $prefix

# Open firewall for print agent LAN access
try {
  & (Join-Path $PSScriptRoot 'Open-ClientFirewall.ps1') -Ports "$Port"
} catch {
  Write-Host "Firewall note: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "Print agent EXE: $exe" -ForegroundColor Cyan
Write-Host "Bind: $prefix" -ForegroundColor Cyan
Write-Host "Clients use: $agentUrl" -ForegroundColor Green
Write-Host "Key file: $keyFile" -ForegroundColor Yellow
Write-Host $key -ForegroundColor Green

$workDir = Split-Path -Parent $exe
$cmd = @"
@echo off
set PRINT_AGENT_KEY=$key
set PRINT_AGENT_ORIGINS=$origins
set PRINT_AGENT_HOST=$listenHost
set PRINT_AGENT_PORT=$Port
echo Card Print Agent — SubscriptionsPrint
echo Listening: $prefix
echo Clients:   $agentUrl
"$exe"
"@
$launcher = Join-Path $keyDir 'Run-CardPrintAgent.cmd'
Set-Content -LiteralPath $launcher -Value $cmd -Encoding ASCII

if ($RegisterPm2) {
  Register-PrintAgentWithPm2 -LauncherPath $launcher -WorkDir $workDir
  return
}

if ($SkipStart) { return }

Start-Process -FilePath $launcher -WorkingDirectory $workDir
Write-Host 'Print agent window started. Run it on the PC that has the card printer.' -ForegroundColor Green

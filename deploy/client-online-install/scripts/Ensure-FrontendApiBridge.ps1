# Ensures the Vite frontend can reach the API on the host:
# - VITE_API_BASE=/api (same-origin; Vite proxies /api -> 127.0.0.1:5050)
# - Optional wait/verify that API health is reachable via the web proxy
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [switch]$Verify,
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = 'Stop'

$webDir = Join-Path $RepoRoot 'web'
if (-not (Test-Path -LiteralPath $webDir)) {
  throw "Web directory not found: $webDir"
}

# Client LAN install: keep API relative so cookies/CSRF stay same-origin through Vite proxy.
$envLocal = Join-Path $webDir '.env.local'
$desired = @(
  '# Written by deploy/client-online-install — do not point at a foreign origin.',
  '# Browsers call /api on the same host:port as the UI; Vite proxies to the local API.',
  'VITE_API_BASE=/api'
) -join "`r`n"

$write = $true
if (Test-Path -LiteralPath $envLocal) {
  $existing = Get-Content -LiteralPath $envLocal -Raw -Encoding UTF8
  if ($existing -match '(?m)^\s*VITE_API_BASE\s*=\s*/api\s*$') {
    $write = $false
    Write-Host 'web/.env.local already has VITE_API_BASE=/api' -ForegroundColor Green
  }
}
if ($write) {
  Set-Content -LiteralPath $envLocal -Value ($desired + "`r`n") -Encoding UTF8
  Write-Host 'Wrote web/.env.local with VITE_API_BASE=/api (Vite proxy to API).' -ForegroundColor Green
}

# Confirm vite.config still proxies /api to the local API port.
$viteCfg = Join-Path $webDir 'vite.config.js'
if (Test-Path -LiteralPath $viteCfg) {
  $cfg = Get-Content -LiteralPath $viteCfg -Raw -Encoding UTF8
  if ($cfg -notmatch "proxy" -or $cfg -notmatch "/api") {
    Write-Host 'WARNING: web/vite.config.js may be missing /api proxy. LAN UI will not reach the API.' -ForegroundColor Yellow
  } elseif ($cfg -match "127\.0\.0\.1:5050" -or $cfg -match "localhost:5050") {
    Write-Host 'Vite /api proxy target looks correct (local :5050).' -ForegroundColor Green
  } else {
    Write-Host 'WARNING: vite proxy /api target is not the usual 127.0.0.1:5050 — verify manually.' -ForegroundColor Yellow
  }
}

if (-not $Verify) { return }

function Wait-Url([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  return $false
}

Write-Host "Waiting for API http://127.0.0.1:5050/api/health (up to ${TimeoutSec}s)..." -ForegroundColor Cyan
if (-not (Wait-Url 'http://127.0.0.1:5050/api/health' $TimeoutSec)) {
  throw 'API did not become ready on port 5050. Check the API window for errors.'
}
Write-Host 'API health OK on loopback.' -ForegroundColor Green

Write-Host "Waiting for web http://127.0.0.1:5173/ (up to ${TimeoutSec}s)..." -ForegroundColor Cyan
if (-not (Wait-Url 'http://127.0.0.1:5173/' $TimeoutSec)) {
  throw 'Web UI did not become ready on port 5173. Check the web window for errors.'
}
Write-Host 'Web UI OK on loopback.' -ForegroundColor Green

Write-Host 'Checking frontend→backend bridge via Vite proxy /api/health ...' -ForegroundColor Cyan
if (-not (Wait-Url 'http://127.0.0.1:5173/api/health' 30)) {
  throw 'Vite proxy could not reach the API at /api/health. Frontend and backend cannot see each other.'
}
Write-Host 'Frontend and backend can see each other (proxied /api/health OK).' -ForegroundColor Green

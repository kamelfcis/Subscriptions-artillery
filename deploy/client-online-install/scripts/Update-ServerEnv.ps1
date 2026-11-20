# Creates or updates server/.env for a client online install.
# Caller supplies SQL_SERVER (required) and optional SQL_DATABASE (default Subscriptions).
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$SqlServer,
  [string]$SqlDatabase = 'Subscriptions',
  [string]$SqlAuth = 'windows',
  [switch]$ForceFromTemplate
)

$ErrorActionPreference = 'Stop'

if ($SqlDatabase -notmatch '^[A-Za-z0-9_-]{1,80}$') {
  throw "Unsupported SQL_DATABASE identifier: $SqlDatabase"
}
if ([string]::IsNullOrWhiteSpace($SqlServer)) {
  throw 'SQL_SERVER is required.'
}

$serverDir = Join-Path $RepoRoot 'server'
$envPath = Join-Path $serverDir '.env'
$clientTemplate = Join-Path $PSScriptRoot '..\templates\server.env.client.example'
$repoExample = Join-Path $serverDir '.env.example'

function Get-OdbcDriverPreference {
  $names = @(
    'ODBC Driver 18 for SQL Server',
    'ODBC Driver 17 for SQL Server'
  )
  $installed = @()
  try {
    $installed = @(Get-OdbcDriver | ForEach-Object { $_.Name } | Select-Object -Unique)
  } catch {
    $installed = @()
  }
  foreach ($n in $names) {
    if ($installed -contains $n) { return $n }
  }
  # Default for typical client lab / SQL 2014–2019 sites when detection fails.
  return 'ODBC Driver 17 for SQL Server'
}

function Set-EnvKey([string]$content, [string]$key, [string]$value) {
  $escaped = [regex]::Escape($key)
  $line = "$key=$value"
  if ($content -match "(?m)^\s*#?\s*$escaped\s*=") {
    return [regex]::Replace($content, "(?m)^\s*#?\s*$escaped\s*=.*$", $line, 1)
  }
  if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
    $content += "`r`n"
  }
  return $content + $line + "`r`n"
}

function New-JwtSecret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $serverDir)) {
  throw "Server directory not found: $serverDir"
}

$created = $false
if (-not (Test-Path -LiteralPath $envPath) -or $ForceFromTemplate) {
  $src = $null
  if (Test-Path -LiteralPath $clientTemplate) {
    $src = $clientTemplate
  } elseif (Test-Path -LiteralPath $repoExample) {
    $src = $repoExample
  } else {
    throw 'No .env template found (templates/server.env.client.example or server/.env.example).'
  }
  Copy-Item -LiteralPath $src -Destination $envPath -Force
  $created = $true
  Write-Host "Created server/.env from $(Split-Path $src -Leaf)" -ForegroundColor Green
} else {
  Write-Host 'Updating existing server/.env (SQL_SERVER / SQL_DATABASE / auth defaults).' -ForegroundColor Cyan
}

$content = Get-Content -LiteralPath $envPath -Raw -Encoding UTF8
if ($null -eq $content) { $content = '' }

$odbc = Get-OdbcDriverPreference
$content = Set-EnvKey $content 'SQL_SERVER' $SqlServer
$content = Set-EnvKey $content 'SQL_DATABASE' $SqlDatabase
$content = Set-EnvKey $content 'SQL_AUTH' $SqlAuth
$content = Set-EnvKey $content 'SQL_ODBC_DRIVER' $odbc
$content = Set-EnvKey $content 'SQL_ENCRYPT' 'true'
$content = Set-EnvKey $content 'SQL_TRUST_CERT' 'true'
$content = Set-EnvKey $content 'SQL_INSTANCE' ''
# Bind on all interfaces so Vite on this host and LAN clients can reach the API.
$content = Set-EnvKey $content 'HOST' '0.0.0.0'
$content = Set-EnvKey $content 'PORT' '5050'
$content = Set-EnvKey $content 'BACKUP_ALLOW_LIVE' 'false'
$content = Set-EnvKey $content 'LEGACY_MIRROR_ENABLED' 'false'

$jwtMatch = [regex]::Match($content, '(?m)^\s*JWT_SECRET\s*=\s*(.*)$')
$jwtVal = if ($jwtMatch.Success) { $jwtMatch.Groups[1].Value.Trim() } else { '' }
$needsJwt = (-not $jwtMatch.Success) -or
  [string]::IsNullOrWhiteSpace($jwtVal) -or
  $jwtVal -match 'CHANGE_ME' -or
  $jwtVal.Length -lt 32

if ($needsJwt) {
  $secret = New-JwtSecret
  $content = Set-EnvKey $content 'JWT_SECRET' $secret
  Write-Host 'Generated a new JWT_SECRET (stored in server/.env only).' -ForegroundColor Green
}

Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8 -NoNewline

Write-Host "SQL_SERVER=$SqlServer" -ForegroundColor Green
Write-Host "SQL_DATABASE=$SqlDatabase" -ForegroundColor Green
Write-Host "SQL_AUTH=$SqlAuth" -ForegroundColor Green
Write-Host "SQL_ODBC_DRIVER=$odbc" -ForegroundColor Green
Write-Host "SQL_TRUST_CERT=true (lab default)" -ForegroundColor DarkYellow
if ($created) {
  Write-Host 'server/.env was created. Review other keys if this site differs from defaults.' -ForegroundColor DarkYellow
}

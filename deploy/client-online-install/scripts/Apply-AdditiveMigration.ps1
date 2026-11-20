# Applies client SQL migrations in order: 01,02,04,05,07,08,09,10,11 (skips 03,06).
# Rewrites USE [...] and DB_NAME() guards for the target database.
# ALWAYS refuses SqlDatabase name Subscriptions (all hosts).
param(
  [Parameter(Mandatory = $true)][string]$SqlServer,
  [Parameter(Mandatory = $true)][string]$SqlDatabase,
  [Parameter(Mandatory = $true)][string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

if ($SqlDatabase -ieq 'Subscriptions') {
  throw @"
REFUSED: This client package will not run migrations against live [Subscriptions].
Use Subscriptions2 (parallel install) or another non-live database name.
"@
}

if ($SqlDatabase -notmatch '^[A-Za-z0-9_-]{1,80}$') {
  throw "Unsupported SQL_DATABASE identifier: $SqlDatabase"
}

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
  throw 'sqlcmd not found. Install SQL Server Command Line Utilities and re-run.'
}

$sqlDir = Join-Path $RepoRoot 'server\sql'
$migrationFiles = @(
  '01_additive_migration.sql',
  '02_optional_index_maintenance.sql',
  '04_renewal_adjustments_and_reprint.sql',
  '05_card_template.sql',
  '07_member_security_block.sql',
  '08_member_vip.sql',
  '09_member_vip_job.sql',
  '10_lost_card_replacement.sql',
  '11_pricelist_relnada_cleanup.sql'
)

function Rewrite-MigrationText([string]$text, [string]$Db) {
  $escapedDb = [regex]::Escape($Db)
  $useLine = "USE [$Db];"

  if ($text -match '(?im)^\s*USE\s+\[[^\]]+\]\s*;') {
    $text = [regex]::Replace($text, '(?im)^\s*USE\s+\[[^\]]+\]\s*;', $useLine)
  } else {
    $text = "$useLine`r`nGO`r`n" + $text
  }

  # Commented USE lines in some scripts
  $text = [regex]::Replace($text, '(?im)^\s*--\s*USE\s+\[[^\]]+\]\s*;', "-- USE [$Db];")

  $text = [regex]::Replace(
    $text,
    "(?i)DB_NAME\(\)\s+NOT\s+IN\s*\(\s*N'Subscriptions_Staging'\s*,\s*N'Subscriptions'\s*\)",
    "DB_NAME() NOT IN (N'Subscriptions_Staging', N'Subscriptions', N'$Db')"
  )

  $text = [regex]::Replace(
    $text,
    "(?i)DB_NAME\(\)\s+<>\s*N'Subscriptions_Staging'",
    "DB_NAME() NOT IN (N'Subscriptions_Staging', N'$Db')"
  )

  return $text
}

$tempDir = Join-Path $env:TEMP 'subscriptions-enterprise-client-install'
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

Write-Host "Applying migrations to [$SqlDatabase] on $SqlServer ..." -ForegroundColor Cyan
Write-Host 'Order: 01,02,04,05,07-11 (03 staging seeds and 06 staging pricing import skipped).' -ForegroundColor DarkGray

foreach ($file in $migrationFiles) {
  $source = Join-Path $sqlDir $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Migration file not found: $source"
  }

  $text = Get-Content -LiteralPath $source -Raw -Encoding UTF8
  $text = Rewrite-MigrationText -text $text -Db $SqlDatabase

  $tempSql = Join-Path $tempDir ("{0}_{1}.sql" -f ([IO.Path]::GetFileNameWithoutExtension($file)), ([guid]::NewGuid().ToString('N')))
  Set-Content -LiteralPath $tempSql -Value $text -Encoding UTF8

  Write-Host "  -> $file" -ForegroundColor Cyan
  try {
    & sqlcmd -S $SqlServer -E -b -i $tempSql
    if ($LASTEXITCODE -ne 0) {
      throw "sqlcmd failed on $file (exit $LASTEXITCODE)"
    }
  }
  finally {
    Remove-Item -LiteralPath $tempSql -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'All client migrations completed.' -ForegroundColor Green
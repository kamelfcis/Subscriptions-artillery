# COPY_ONLY backup of live [Subscriptions], RESTORE as [Subscriptions2] with new data/log files.
# Never RESTORE/DROP [Subscriptions]. Target name [Subscriptions] is always refused.
param(
  [Parameter(Mandatory = $true)][string]$SqlServer,
  [string]$SourceDatabase = 'Subscriptions',
  [string]$TargetDatabase = 'Subscriptions2',
  [string]$BackupDirectory = '',
  [switch]$Replace
)

$ErrorActionPreference = 'Stop'

if ($TargetDatabase -ieq 'Subscriptions') {
  throw 'REFUSED: Target database cannot be [Subscriptions]. Use Subscriptions2 (or another non-live name).'
}
if ($SourceDatabase -notmatch '^[A-Za-z0-9_-]{1,80}$' -or $TargetDatabase -notmatch '^[A-Za-z0-9_-]{1,80}$') {
  throw 'Unsupported database identifier.'
}
if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
  throw 'sqlcmd not found. Install SQL Server Command Line Utilities and re-run.'
}

function Invoke-SqlcmdScalar([string]$Query) {
  $out = & sqlcmd -S $SqlServer -d master -E -b -W -h -1 -Q $Query 2>&1
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed: $out" }
  return (($out | Out-String).Trim())
}

$srcId = Invoke-SqlcmdScalar "SET NOCOUNT ON; SELECT CAST(DB_ID(N'$SourceDatabase') AS nvarchar(20));"
if ([string]::IsNullOrWhiteSpace($srcId) -or $srcId -eq 'NULL') {
  throw "Source database [$SourceDatabase] was not found on $SqlServer."
}

$tgtId = Invoke-SqlcmdScalar "SET NOCOUNT ON; SELECT CAST(DB_ID(N'$TargetDatabase') AS nvarchar(20));"
if ($tgtId -and $tgtId -ne 'NULL') {
  if (-not $Replace) {
    throw @"
[$TargetDatabase] already exists on $SqlServer.
Re-run with -Replace to drop and recreate only [$TargetDatabase] (live [$SourceDatabase] is never dropped).
"@
  }
  Write-Host "Dropping existing [$TargetDatabase] (-Replace)..." -ForegroundColor Yellow
  Invoke-SqlcmdScalar "ALTER DATABASE [$TargetDatabase] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$TargetDatabase];" | Out-Null
}

if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
  $BackupDirectory = Join-Path $env:TEMP 'subscriptions-enterprise-client-install\backups'
}
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null

$dataPath = Invoke-SqlcmdScalar "SET NOCOUNT ON; SELECT CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultDataPath'));"
$logPath = Invoke-SqlcmdScalar "SET NOCOUNT ON; SELECT CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultLogPath'));"
if ([string]::IsNullOrWhiteSpace($dataPath)) { $dataPath = 'C:\Program Files\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQL\DATA\' }
if ([string]::IsNullOrWhiteSpace($logPath)) { $logPath = $dataPath }
if (-not $dataPath.EndsWith('\')) { $dataPath += '\' }
if (-not $logPath.EndsWith('\')) { $logPath += '\' }

$stamp = (Get-Date).ToString('yyyyMMdd_HHmmss')
$bakName = "${SourceDatabase}_copyonly_${stamp}.bak"
$bakPath = Join-Path $BackupDirectory $bakName
$bakEsc = $bakPath.Replace("'", "''")

Write-Host "COPY_ONLY backup [$SourceDatabase] -> $bakPath" -ForegroundColor Cyan
$backupSql = @"
SET NOCOUNT ON;
BACKUP DATABASE [$SourceDatabase] TO DISK = N'$bakEsc'
  WITH COPY_ONLY, CHECKSUM, INIT, STATS = 10;
"@
& sqlcmd -S $SqlServer -d master -E -b -Q $backupSql
if ($LASTEXITCODE -ne 0) { throw 'BACKUP failed (read-only COPY_ONLY; live DB unchanged except backup file written).' }

$fileList = & sqlcmd -S $SqlServer -d master -E -b -s '|' -W -Q "RESTORE FILELISTONLY FROM DISK = N'$bakEsc';"
if ($LASTEXITCODE -ne 0) { throw 'RESTORE FILELISTONLY failed.' }

$moveClauses = [System.Collections.Generic.List[string]]::new()
$dataFileIndex = 0
foreach ($line in ($fileList -split "`r?`n")) {
  if ($line -notmatch '\|') { continue }
  $cols = $line -split '\|'
  if ($cols.Count -lt 3) { continue }
  $logical = $cols[0].Trim()
  $ftype = $cols[2].Trim()
  if ($logical -match '^LogicalName$' -or [string]::IsNullOrWhiteSpace($logical)) { continue }
  if ($ftype -eq 'L') {
    $dest = Join-Path $logPath ($TargetDatabase + '.ldf')
  } elseif ($dataFileIndex -eq 0) {
    $dest = Join-Path $dataPath ($TargetDatabase + '.mdf')
    $dataFileIndex++
  } else {
    $safeLogical = ($logical -replace '[^\w\-]', '_')
    $dest = Join-Path $dataPath ($TargetDatabase + '_' + $safeLogical + '.ndf')
    $dataFileIndex++
  }
  $destEsc = $dest.Replace("'", "''")
  $moveClauses.Add("MOVE N'$logical' TO N'$destEsc'")
}

if ($moveClauses.Count -eq 0) {
  throw 'Could not parse logical files from backup; check RESTORE FILELISTONLY output.'
}

$moveSql = ($moveClauses -join ",`n")
$restoreSql = @"
SET NOCOUNT ON;
RESTORE DATABASE [$TargetDatabase]
  FROM DISK = N'$bakEsc'
  WITH RECOVERY, REPLACE,
$moveSql,
  STATS = 10;
"@
Write-Host "RESTORE [$TargetDatabase] (new mdf/ldf; [$SourceDatabase] files untouched)..." -ForegroundColor Cyan
& sqlcmd -S $SqlServer -d master -E -b -Q $restoreSql
if ($LASTEXITCODE -ne 0) { throw 'RESTORE failed.' }

Write-Host "[$TargetDatabase] is ready. Live [$SourceDatabase] was only read for COPY_ONLY backup." -ForegroundColor Green
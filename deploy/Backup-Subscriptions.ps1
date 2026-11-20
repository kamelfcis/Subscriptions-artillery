# Windows Scheduled Task / Manual DBA-only backup on SQL Server. Run with an account authorized for SQL backups.
# SQL Server SERVICE account must have file-system write permission to $BackupDirectory.
param(
 [string]$Server = 'DESKTOP-7Q8JPT0',
 [string]$Database = 'Subscriptions_Staging',
 [string]$BackupDirectory = 'D:\SubscriptionsBackups',
 [switch]$AllowLive
)
$ErrorActionPreference = 'Stop'
if(-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw 'sqlcmd not installed. Install the Microsoft SQL Server command-line tools.' }
if($Database -notmatch '^[A-Za-z0-9_-]{1,80}$') { throw 'Unsupported database identifier' }
if($Database -eq 'Subscriptions' -and -not $AllowLive) { throw 'Refusing live Subscriptions backup unless -AllowLive is set. Default target is Subscriptions_Staging.' }
if(-not [System.IO.Path]::IsPathRooted($BackupDirectory)) { throw 'Absolute backup path required' }
$now = (Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss')
$backupName = "${Database}_copyonly_${now}.bak"
$sqlPath = [System.IO.Path]::Combine($BackupDirectory,$backupName)
$escaped = $sqlPath.Replace("'","''")
$sql = "SET NOCOUNT ON; BACKUP DATABASE [$Database] TO DISK=N'$escaped' WITH COPY_ONLY, CHECKSUM, INIT, STATS=10; RESTORE VERIFYONLY FROM DISK=N'$escaped' WITH CHECKSUM;"
& sqlcmd -S $Server -d master -E -b -Q $sql
if($LASTEXITCODE -ne 0) { throw 'Backup or VERIFYONLY failed; inspect SQL Server error log.' }
Write-Host "SQL Server BACKUP verified: $sqlPath" -ForegroundColor Green
Write-Host 'Schedule full restoration on an isolated SQL instance: VERIFYONLY is not a replacement for real restore testing.' -ForegroundColor Yellow

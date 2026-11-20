# Run on the Windows application/printer workstation. Read-only diagnostics.
Write-Host '=== Subscriptions Enterprise Preflight ===' -ForegroundColor Cyan
node --version
npm --version
try { dotnet --version } catch { Write-Warning '.NET SDK not installed for printing agent' }
Get-OdbcDriver | Where-Object { $_.Name -match 'SQL Server' } | Format-Table Name,Platform -AutoSize
Get-Printer | Select-Object Name,DriverName,PrinterStatus | Format-Table -AutoSize
Write-Host "Windows identity: $(whoami)"
Write-Host "SQL instance expected: DESKTOP-7Q8JPT0; database: Subscriptions_Staging (live Subscriptions is read-only)"
Write-Host 'Check TCP/IP access and ODBC driver; verify schema using npm run db:verify.'
Write-Host 'Do not edit the live database until a restorable backup and staging UAT succeed.'

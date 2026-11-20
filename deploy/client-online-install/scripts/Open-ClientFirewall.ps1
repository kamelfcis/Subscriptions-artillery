# Opens Windows Firewall inbound TCP rules so LAN devices can reach this host's web + API.
# Ports: 5173 (Vite web), 5050 (Node API). Safe to re-run (idempotent by rule name).
param(
  [string]$Ports = '5173,5050',
  [string]$RulePrefix = 'SubscriptionsEnterprise-Client'
)

$ErrorActionPreference = 'Stop'

$portList = @($Ports.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { [int]$_ })
if ($portList.Count -eq 0) { throw 'No ports specified.' }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host 'Firewall changes need Administrator. Re-launching elevated...' -ForegroundColor Yellow
  $argList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $PSCommandPath,
    '-Ports', $Ports,
    '-RulePrefix', $RulePrefix
  )
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
  if ($null -eq $p -or $p.ExitCode -ne 0) {
    $code = if ($p) { $p.ExitCode } else { 'unknown' }
    throw "Elevated firewall script failed (exit $code). Approve UAC or run Install-ClientOnline.bat as Administrator."
  }
  return
}

foreach ($port in $portList) {
  $name = "$RulePrefix-TCP-$port"
  $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if ($existing) {
    Enable-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Out-Null
    Write-Host "Firewall rule already present (ensured enabled): $name" -ForegroundColor Green
  } else {
    New-NetFirewallRule `
      -DisplayName $name `
      -Name $name `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $port `
      -Profile Domain,Private `
      -Description "Subscriptions Enterprise client host — allow LAN access to TCP $port" | Out-Null
    Write-Host "Created firewall rule: $name (TCP $port, Domain+Private)" -ForegroundColor Green
  }
}

Write-Host ("LAN firewall ports ready: {0}" -f ($portList -join ', ')) -ForegroundColor Cyan

# Prints the URLs other devices should use to reach this host.
param(
  [int]$WebPort = 5173,
  [int]$ApiPort = 5050
)

$ErrorActionPreference = 'Continue'

function Get-LanIPv4 {
  $addrs = @()
  try {
    $addrs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -ne '127.0.0.1' -and
        $_.PrefixOrigin -ne 'WellKnown' -and
        $_.IPAddress -notlike '169.254.*' -and
        ($_.AddressState -eq 'Preferred' -or -not $_.AddressState)
      } |
      Sort-Object InterfaceMetric |
      Select-Object -ExpandProperty IPAddress -Unique)
  } catch { }

  if (-not $addrs -or $addrs.Count -eq 0) {
    try {
      $addrs = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
        ForEach-Object { $_.IPv4Address.IPAddress } |
        Where-Object { $_ -and $_ -ne '127.0.0.1' -and $_ -notlike '169.254.*' })
    } catch { }
  }
  return @($addrs | Select-Object -Unique)
}

$ips = Get-LanIPv4

Write-Host ''
Write-Host '=== Network access (use on other devices) ===' -ForegroundColor Cyan
Write-Host "This host: $env:COMPUTERNAME"
if ($ips.Count -eq 0) {
  Write-Host 'No LAN IPv4 detected. Connect Ethernet/Wi-Fi, then re-check with ipconfig.' -ForegroundColor Yellow
} else {
  $primary = $ips[0]
  Write-Host ''
  Write-Host "  Open on phones/PCs:  http://${primary}:${WebPort}/" -ForegroundColor Green
  Write-Host "  API (direct):        http://${primary}:${ApiPort}/api/health" -ForegroundColor DarkGray
  Write-Host ''
  if ($ips.Count -gt 1) {
    Write-Host 'Other IPv4 addresses on this machine:' -ForegroundColor DarkYellow
    foreach ($ip in $ips) {
      Write-Host "  http://${ip}:${WebPort}/"
    }
  }
}
Write-Host ''
Write-Host "On this machine (loopback): http://127.0.0.1:${WebPort}/" -ForegroundColor DarkGray
Write-Host 'Staff browsers should use the LAN URL above, not 127.0.0.1, from other devices.' -ForegroundColor DarkYellow
Write-Host ''

# Also write a small reminder file next to the package for the operator.
$outDir = Split-Path -Parent $PSScriptRoot
$note = Join-Path $outDir 'LAN_ACCESS.txt'
$lines = @(
  "Subscriptions Enterprise — LAN access",
  "Generated: $((Get-Date).ToString('u'))",
  "Host: $env:COMPUTERNAME",
  ""
)
if ($ips.Count -gt 0) {
  $lines += "Primary web URL for other devices:"
  $lines += "  http://$($ips[0]):${WebPort}/"
  $lines += ""
  $lines += "All detected IPv4:"
  foreach ($ip in $ips) { $lines += "  http://${ip}:${WebPort}/" }
} else {
  $lines += "No LAN IPv4 detected at install time. Run ipconfig and use http://<IP>:${WebPort}/"
}
$lines += ""
$lines += "API health (optional): http://<IP>:${ApiPort}/api/health"
$lines += "Frontend uses relative /api (Vite proxy) so web+API stay same-origin."
Set-Content -LiteralPath $note -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "Wrote $note" -ForegroundColor DarkGray

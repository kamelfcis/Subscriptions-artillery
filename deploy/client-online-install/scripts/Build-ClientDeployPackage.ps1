# Rebuilds the client deploy package payload so the app can run from deploy/client-online-install.
# Stages the self-contained Card Print Agent into payload/print-agent/.
# Does NOT connect to SQL Server or run migrations.
param(
  [switch]$SkipPrintAgentCopy
)

$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $PackageRoot '..\..')).Path

Write-Host '=== Rebuild client deploy package payload ===' -ForegroundColor Cyan
Write-Host "Package: $PackageRoot"
Write-Host "Repo:    $RepoRoot"

$payloadRoot = Join-Path $PackageRoot 'payload'
$printPayload = Join-Path $payloadRoot 'print-agent'
New-Item -ItemType Directory -Force -Path $printPayload | Out-Null

$publishDir = Join-Path $RepoRoot 'print-agent\bin\Release\net8.0-windows\win-x64\publish'
$publishExe = Join-Path $publishDir 'CardPrintAgent.exe'

if (-not $SkipPrintAgentCopy) {
  if (-not (Test-Path -LiteralPath $publishExe)) {
    Write-Host 'Published CardPrintAgent.exe missing — attempting dotnet publish...' -ForegroundColor Yellow
    $proj = Join-Path $RepoRoot 'print-agent\CardPrintAgent.csproj'
    & dotnet publish $proj -c Release
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $publishExe)) {
      throw "Cannot stage print agent: publish failed or $publishExe still missing."
    }
  }

  Write-Host "Copying print agent from:`n  $publishDir" -ForegroundColor Cyan
  # Self-contained single-file publish still may ship companion native DLLs — copy the folder.
  Get-ChildItem -LiteralPath $printPayload -Force | Where-Object {
    $_.Name -notin @('PRINT_AGENT_KEY.txt', 'PRINT_AGENT_ORIGINS.txt', 'Run-CardPrintAgent.cmd', 'README.txt')
  } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  Copy-Item -Path (Join-Path $publishDir '*') -Destination $printPayload -Recurse -Force
  Write-Host "Staged print agent -> $printPayload" -ForegroundColor Green
}

$printReadme = @'
Card Print Agent (included in this deploy package)
==================================================
EXE: CardPrintAgent.exe (self-contained win-x64)

Runtime:
  - Listens ONLY on http://127.0.0.1:5678/ (not exposed on LAN)
  - Requires PRINT_AGENT_KEY (32+ chars) — see PRINT_AGENT_KEY.txt after first start
  - Web UI card dialog uses this key; agent must run on the PC that has the printer

Start:
  ..\..\scripts\Start-PrintAgent.ps1
  or Install-ClientOnline.bat (starts it with API + web)

Rebuild payload:
  ..\..\scripts\Build-ClientDeployPackage.ps1
'@
Set-Content -LiteralPath (Join-Path $printPayload 'README.txt') -Value $printReadme -Encoding UTF8

# Manifest of package contents
$manifestPath = Join-Path $PackageRoot 'PACKAGE_CONTENTS.md'
$printExeStaged = Test-Path -LiteralPath (Join-Path $printPayload 'CardPrintAgent.exe')
$printSize = if ($printExeStaged) {
  '{0:N1} MB' -f ((Get-Item -LiteralPath (Join-Path $printPayload 'CardPrintAgent.exe')).Length / 1MB)
} else { 'MISSING' }

$items = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\payload\\print-agent\\(?!CardPrintAgent\.exe|README\.txt|PRINT_AGENT_).+' -or $_.Name -match 'CardPrintAgent|README|PRINT_AGENT|Run-Card' } |
  ForEach-Object { $_.FullName.Substring($PackageRoot.Length + 1) }

# Simpler top-level listing for humans
$manifest = @"
# Client deploy package contents

Rebuilt: $((Get-Date).ToString('u'))
Package root: ``deploy/client-online-install/``

## Included now

| Area | Path | Notes |
|------|------|-------|
| Launcher | ``Install-ClientOnline.bat`` | Main entry |
| Orchestration | ``scripts/*.ps1`` | Env, npm, migration 01 only, firewall 5173/5050, LAN IP, API bridge, **print agent** |
| Env templates | ``templates/`` | server + web |
| **Print agent** | ``payload/print-agent/`` | Self-contained ``CardPrintAgent.exe`` ($printSize) + README |
| Docs | ``README.md``, ``HOW_TO_USE.md``, this file | Operator guides |

## Print agent status

- Staged EXE present: **$printExeStaged**
- Size: **$printSize**
- Source publish folder: ``print-agent/bin/Release/net8.0-windows/win-x64/publish/``
- Listens on ``http://127.0.0.1:5678/`` only (by design)

## Not bundled as binaries (uses live repo tree)

- ``server/`` and ``web/`` (installer runs ``npm install`` against the repo)
- SQL scripts from ``server/sql/01_additive_migration.sql`` only

## Explicitly excluded

- Staging SQL ``02``–``05``
- Opening SQL Server TCP firewall / enabling remote SQL (app host uses local/Windows SQL; see docs)
"@

Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
Write-Host "Wrote $manifestPath" -ForegroundColor Green

Write-Host ''
Write-Host 'Package rebuild complete.' -ForegroundColor Green
Write-Host "Print agent included: $printExeStaged ($printSize)" -ForegroundColor $(if ($printExeStaged) { 'Green' } else { 'Red' })

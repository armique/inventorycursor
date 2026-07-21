# Sold Pulse — open clean eBay.de sold searches (NO scraping).
# Usage (PowerShell):
#   .\scripts\sold-pulse-open-urls.ps1
#   .\scripts\sold-pulse-open-urls.ps1 -Queries "RTX 3060 12GB","RX 6600"
#   .\scripts\sold-pulse-open-urls.ps1 -File .\sold-pulse-queries.txt
#
# -File format: one query per line. Lines starting with # are ignored.
# Logs opened URLs to .\sold-pulse-open-log.txt (append).

param(
  [string[]]$Queries = @(),
  [string]$File = "",
  [ValidateSet("used_bin", "used_all", "for_parts")]
  [string]$Kind = "used_bin",
  [int]$DelayMs = 800
)

$ErrorActionPreference = "Stop"
$excludes = @(
  "defekt", "bastler", "defective", "kaputt", "fürteile", "fuerteile",
  "ersatzteil", "forparts", "bundle", "komplettsystem", "gamingpc",
  "mining", "schrott"
)

function Get-ExcludeQuery([string]$q, [string]$kind) {
  $base = ($q -replace "\s+", " ").Trim()
  if (-not $base) { return "" }
  if ($kind -eq "for_parts") { return $base }
  $extra = foreach ($w in $excludes) {
    if ($w -match "\s") { '-"' + $w + '"' } else { "-" + $w }
  }
  return ($base + " " + ($extra -join " ")).Trim()
}

function Get-SoldUrl([string]$q, [string]$kind) {
  $nkw = Get-ExcludeQuery $q $kind
  $pairs = [System.Collections.Generic.List[string]]::new()
  $pairs.Add("_nkw=$([uri]::EscapeDataString($nkw))")
  $pairs.Add("LH_Sold=1")
  $pairs.Add("LH_Complete=1")
  $pairs.Add("_sop=13")
  $pairs.Add("_ipg=240")
  if ($kind -eq "for_parts") {
    $pairs.Add("LH_ItemCondition=7000")
  } else {
    $pairs.Add("LH_ItemCondition=3000")
    if ($kind -eq "used_bin") { $pairs.Add("LH_BIN=1") }
  }
  return "https://www.ebay.de/sch/i.html?" + ($pairs -join "&")
}

$list = New-Object System.Collections.Generic.List[string]
foreach ($q in $Queries) {
  if ($q -and $q.Trim()) { [void]$list.Add($q.Trim()) }
}
if ($File -and (Test-Path -LiteralPath $File)) {
  Get-Content -LiteralPath $File | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) { [void]$list.Add($line) }
  }
}
if ($list.Count -eq 0) {
  # Sensible defaults if nothing passed
  @(
    "RTX 3060 12GB",
    "RTX 4060",
    "RX 6600",
    "Ryzen 5 5600X"
  ) | ForEach-Object { [void]$list.Add($_) }
  Write-Host "No queries given — opening starter presets. Pass -Queries or -File next time." -ForegroundColor Yellow
}

$logPath = Join-Path (Get-Location) "sold-pulse-open-log.txt"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -LiteralPath $logPath -Value "`n==== $stamp kind=$Kind ===="

Write-Host "Opening $($list.Count) clean sold search(es). This script does NOT scrape eBay." -ForegroundColor Cyan
Write-Host "Log: $logPath"

foreach ($q in $list) {
  $url = Get-SoldUrl $q $Kind
  Add-Content -LiteralPath $logPath -Value "$q`t$url"
  Write-Host "→ $q"
  Start-Process $url
  Start-Sleep -Milliseconds $DelayMs
}

Write-Host "Done. Scroll ~1 month of Verkauft dates, copy 15–30 prices into Sold Pulse → Read paste." -ForegroundColor Green

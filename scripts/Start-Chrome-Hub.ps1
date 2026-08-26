# Start Chrome with Seller Hub debugging on a private copy of YOUR normal profile.
# Safe to run alongside your regular Chrome — nothing needs to be closed first.
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "Inventory Pro — Chrome Hub (your bookmarks + extensions)" -ForegroundColor Cyan
Write-Host ""

node scripts/start-seller-hub-dev.mjs --chrome-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Chrome is ready on CDP port 9222." -ForegroundColor Green
Write-Host "  Your normal Chrome stays untouched — this is a separate window." -ForegroundColor Green
Write-Host "  npm run ebay:hub-sync        — fetch new orders" -ForegroundColor DarkGray
Write-Host "  npm run ebay:hub-sync:chrome — start Chrome + sync" -ForegroundColor DarkGray
Write-Host ""

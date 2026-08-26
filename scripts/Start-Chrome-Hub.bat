@echo off
cd /d "%~dp0.."
echo.
echo Inventory Pro - Chrome Hub (private copy of your Chrome profile)
echo Safe to run alongside your regular Chrome - nothing to close first.
echo.
node scripts\start-seller-hub-dev.mjs --chrome-only
if errorlevel 1 (
  echo.
  echo Failed. If port 9222 is stuck from a previous run, close that debug
  echo Chrome window and run this again.
  pause
  exit /b 1
)
echo.
echo Chrome ready on port 9222 with your extensions + eBay login.
echo   npm run ebay:hub-sync
echo.
pause

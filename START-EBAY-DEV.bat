@echo off
setlocal
title Inventory Pro — eBay Chrome + dev

set "REPO=%~dp0"
if exist "%REPO%package.json" goto :run

if exist "E:\AI\inventory-pro15022026\package.json" set "REPO=E:\AI\inventory-pro15022026\" & goto :run
if exist "C:\Users\ADMIN\.cursor\worktrees\inventory-pro15022026\package.json" set "REPO=C:\Users\ADMIN\.cursor\worktrees\inventory-pro15022026\" & goto :run

echo Could not find the inventory app folder (package.json missing).
echo Put this file in the project folder, or start from Desktop after the app is on this PC.
pause
exit /b 1

:run
cd /d "%REPO%"
echo.
echo App folder:
echo   %CD%
echo.
echo Starting a dedicated Chrome (eBay login) and npm run dev...
echo Leave the Chrome window open. First time: log into eBay.de there.
echo.
call npm run dev:ebay
echo.
pause

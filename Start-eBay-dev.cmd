@echo off
cd /d "%~dp0"
title Inventory Pro — eBay Chrome + dev
echo.
echo Starting a dedicated Chrome (eBay login) and npm run dev...
echo Leave the Chrome window open. First time: log into eBay.de there.
echo.
call npm run dev:ebay
echo.
pause

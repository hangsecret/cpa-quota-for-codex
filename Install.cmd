@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -ReplaceMarketplace
set "taskResult=%errorlevel%"
echo.
pause
exit /b %taskResult%

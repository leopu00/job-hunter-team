@echo off
:: ──────────────────────────────────────────────────────────────────
:: Job Hunter Team — Windows Launcher
:: Wrapper .bat che avvia lo script PowerShell
:: ──────────────────────────────────────────────────────────────────
title Job Hunter Team

echo.
echo   Job Hunter Team
echo   Avvio in corso...
echo.

:: Cerca PowerShell
where pwsh >nul 2>nul
if %ERRORLEVEL% equ 0 (
    pwsh -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
    goto :end
)

where powershell >nul 2>nul
if %ERRORLEVEL% equ 0 (
    powershell -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
    goto :end
)

echo [err] PowerShell non trovato. Installa PowerShell o esegui manualmente:
echo       cd web
echo       npm install
echo       npm run build
echo       npm run start
pause

:end

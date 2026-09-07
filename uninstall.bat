@echo off
REM Double-click-friendly wrapper for uninstall.ps1.
REM Bypasses the default PowerShell execution policy for this one invocation
REM only — does not change any system-wide policy.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*

echo.
echo Press any key to close this window.
pause >nul

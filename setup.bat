@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  =====================================
echo    Tusk's Vault - first-time setup
echo  =====================================
echo.

REM --- Pre-flight write check ------------------------------------------------
REM Most Windows-specific npm install failures come from one of:
REM   - Cloned into Program Files / Windows / a Restricted folder
REM   - OneDrive / Dropbox actively syncing while npm writes
REM   - Antivirus locking files in node_modules
REM Test write access first so we can surface a useful remediation.
set "WRITE_TEST=.tv-write-test"
echo. > "%WRITE_TEST%" 2>nul
if not exist "%WRITE_TEST%" (
  echo  [X] Can't write to this folder: %CD%
  echo.
  echo  npm install needs to create a node_modules folder here. Most likely:
  echo    - You cloned into a system-protected path ^(Program Files, Windows,
  echo      etc.^). Move the folder to your user directory instead.
  echo    - OneDrive / Dropbox / another sync client is holding files open.
  echo      Pause syncing on this folder.
  echo    - Antivirus is blocking writes to node_modules. Allowlist this
  echo      folder in your AV, or run setup from a non-scanned location.
  echo.
  echo  Recommended location:  %USERPROFILE%\Tusks-Vault
  pause
  exit /b 1
)
del /q "%WRITE_TEST%" >nul 2>nul

REM --- Node check ------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed.
  echo.
  echo  Tusk's Vault needs Node.js 20 or newer.
  echo  Download the LTS installer from: https://nodejs.org/
  echo  Then double-click this file again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if "!NODE_MAJOR!"=="" (
  echo  [X] Could not detect Node.js version. Is Node installed correctly?
  pause
  exit /b 1
)
if !NODE_MAJOR! LSS 20 (
  echo  [X] Your Node.js version is too old ^(v!NODE_MAJOR!^).
  echo  Tusk's Vault needs version 20 or newer. Upgrade from: https://nodejs.org/
  pause
  exit /b 1
)
echo  [.] Node v!NODE_MAJOR! detected.

REM --- Git check (optional but recommended) ----------------------------------
where git >nul 2>nul
if errorlevel 1 (
  echo  [!] Git is not installed. You'll be able to run Tusk's Vault, but
  echo      the in-app "Check for updates" button won't work until you
  echo      install Git from: https://git-scm.com/download/win
) else (
  echo  [.] Git detected.
)

REM --- npm install -----------------------------------------------------------
REM --no-audit --no-fund: quieter output. Audit warnings scare first-time users
REM into thinking something broke; --no-fund silences the funding nags.
REM On a truly fresh clone (no node_modules) use `npm ci` — strictly from
REM package-lock.json, no dependency resolution, faster + reproducible.
if exist node_modules (
  echo  [.] node_modules already present. Refreshing dependencies...
  call npm install --no-audit --no-fund
) else (
  echo  [.] Installing dependencies ^(first time, ~1 minute^)...
  call npm ci --no-audit --no-fund
)
if errorlevel 1 (
  echo.
  echo  [X] npm install failed.
  echo.
  echo  Common causes on Windows:
  echo    - FILE LOCKED ^(EPERM / EBUSY^): OneDrive, Dropbox, antivirus, or
  echo      an editor ^(VS Code^) is holding a file in node_modules open.
  echo      Close those, pause sync on this folder, and re-run setup.bat.
  echo    - PATH TOO LONG: Windows has a 260-char path limit by default.
  echo      Move the folder closer to the drive root, e.g. C:\Tusks-Vault.
  echo    - PROXY / FIREWALL: corporate networks may block registry.npmjs.org.
  echo      Try 'npm ping' from a command prompt for a clearer error.
  echo.
  pause
  exit /b 1
)

echo.
echo  =====================================
echo    Setup complete.
echo  =====================================
echo.
echo  Next steps:
echo    1. Double-click run.bat to start Tusk's Vault.
echo    2. The dashboard auto-opens in your browser.
echo    3. Add your LLM API key from the Settings page.
echo.
pause
endlocal

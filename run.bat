@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ===========================================================================
REM When Windows Terminal (wt.exe) is installed, this script relaunches
REM itself inside a shared "tusks" Windows Terminal window so that Tusk's
REM Vault and Tusk's Tomes open as adjacent tabs instead of two separate
REM cmd windows. Set TUSKS_NO_WT=1 to opt out and use a plain cmd window.
REM ===========================================================================
if defined WT_SESSION goto :no_wt_relaunch
if defined TUSKS_NO_WT goto :no_wt_relaunch
where wt.exe >nul 2>nul
if errorlevel 1 goto :no_wt_relaunch

start "" wt.exe --window tusks new-tab --title "Tusk's Vault" --startingDirectory "%CD%" cmd /k "%~f0"
exit /b 0

:no_wt_relaunch

echo.
echo  ==============================================================
echo.
echo                    T U S K ' S    V A U L T
echo.
echo                                      _____
echo                                     /     \
echo                                     I     I
echo                                     I     I
echo                    .--.          ___I_____I___
echo                   /    \         I           I
echo                  : .--. :        I  .-----.  I
echo                   \____/         I  I     I  I
echo                    \  \          I  I  *  I  I
echo                     \  \         I  '-----'  I
echo                      \__\        I___________I
echo                    The Key          The Vault
echo.
echo             Thank you for downloading Tusk's Vault.
echo               May your lore be forever safe.
echo.
echo  ==============================================================
echo.

REM --- Pre-flight write check ------------------------------------------------
REM Catch the cloned-into-Program-Files / OneDrive-locking-files cases before
REM npm install fails cryptically. Tests write access by creating + removing
REM a tiny sentinel file in the repo root.
set "WRITE_TEST=.tv-write-test"
echo. > "%WRITE_TEST%" 2>nul
if not exist "%WRITE_TEST%" (
  echo  [X] Can't write to this folder: %CD%
  echo.
  echo  Tusk's Vault needs to create / update node_modules here. Most likely:
  echo    - The folder is in Program Files, Windows, or another protected
  echo      path. Move it into your user directory ^(e.g. %USERPROFILE%\Tusks-Vault^).
  echo    - OneDrive / Dropbox is syncing this folder and holding files open.
  echo      Pause sync for the folder, then re-run.
  echo    - Antivirus is blocking writes. Allowlist this folder.
  echo.
  goto :end
)
del /q "%WRITE_TEST%" >nul 2>nul

REM --- Node.js check ---------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed.
  echo.
  echo  Tusk's Vault needs Node.js 20 or newer.
  echo  Download the LTS installer from: https://nodejs.org/
  echo  Then double-click this file again.
  goto :end
)

for /f "tokens=*" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if "!NODE_MAJOR!"=="" (
  echo  [X] Could not detect Node.js version. Is Node installed correctly?
  echo      Try opening a fresh Command Prompt and running:  node --version
  goto :end
)
if !NODE_MAJOR! LSS 20 (
  echo  [X] Your Node.js version is too old ^(v!NODE_MAJOR!^).
  echo  Tusk's Vault needs version 20 or newer.
  echo  Upgrade from: https://nodejs.org/
  goto :end
)
echo  [.] Node v!NODE_MAJOR! detected.

REM --- Dependency install: first run OR lockfile changed -------------------
REM We snapshot package-lock.json into node_modules\.tv-lockfile-snapshot on
REM every successful install. On subsequent boots, a snapshot mismatch means
REM a git pull / merge / hand-edit changed package-lock.json since the last
REM successful install — re-run npm install before launching so the user
REM doesn't hit ERR_MODULE_NOT_FOUND on the next line. Migration-safe:
REM a missing snapshot triggers a single re-verify install for users
REM upgrading from an older launcher.
set NEEDS_INSTALL=0
set INSTALL_REASON=
if not exist node_modules (
  set NEEDS_INSTALL=1
  set INSTALL_REASON=First run detected. Installing dependencies
) else if not exist node_modules\.tv-lockfile-snapshot (
  set NEEDS_INSTALL=1
  set INSTALL_REASON=First boot under this launcher. Re-verifying dependencies
) else (
  fc /b package-lock.json node_modules\.tv-lockfile-snapshot >nul 2>nul
  if errorlevel 1 (
    set NEEDS_INSTALL=1
    set INSTALL_REASON=package-lock.json changed since last successful install. Updating dependencies
  )
)

if !NEEDS_INSTALL!==1 (
  echo  [.] !INSTALL_REASON! ^(~1 minute^)...
  echo.
  REM On a truly fresh clone (no node_modules), use `npm ci` — it skips
  REM dependency resolution and installs strictly from package-lock.json,
  REM which is meaningfully faster and more reproducible. Fall back to
  REM `npm install` when node_modules already exists (so a legitimate
  REM lockfile change from `git pull` can still resolve new packages).
  REM
  REM --no-audit / --no-fund keep the output focused on real errors. Users
  REM can run `npm audit` themselves if they want a vulnerability report.
  if not exist node_modules (
    call npm ci --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 (
    echo.
    echo  [X] Install failed. Scroll up for the error message from npm.
    echo.
    echo  If the message mentions EPERM / EBUSY: close VS Code / your editor,
    echo  pause OneDrive sync on this folder, and try again. Antivirus can
    echo  also lock files in node_modules during a write.
    goto :end
  )
  copy /Y package-lock.json node_modules\.tv-lockfile-snapshot >nul 2>nul
  echo.
)

REM --- Launch ----------------------------------------------------------------
REM TUSKS_VAULT_OPEN_BROWSER tells the server to open your browser once it has
REM successfully bound a port (handles the 3000 -> 3001 -> ... fallback).
set TUSKS_VAULT_OPEN_BROWSER=1

if not exist .env.local (
  echo  [i] No .env.local yet. The dashboard will guide you through setup.
  echo.
)

echo  [.] Starting Tusk's Vault. Close this window or press Ctrl+C to stop.
echo.

REM Restart loop: the server exits with code 42 when the in-app updater asks
REM for a graceful restart (see src/server/util/updater.ts -> scheduleRestart).
REM We catch that specifically, re-verify dependencies in case the update
REM changed package-lock.json, and relaunch. Any other exit code falls through
REM to the existing error-handling block.
:restart_loop
call npm run start
set EXIT_CODE=!errorlevel!

if "!EXIT_CODE!"=="42" (
  echo.
  echo  [.] Graceful restart requested by the in-app updater. Reloading...
  echo.
  REM Suppress browser open on relaunch — the user already has the tab.
  set TUSKS_VAULT_OPEN_BROWSER=0
  REM Re-verify deps: the update may have changed package-lock.json.
  if exist package-lock.json (
    if exist node_modules\.tv-lockfile-snapshot (
      fc /b package-lock.json node_modules\.tv-lockfile-snapshot >nul 2>nul
      if errorlevel 1 (
        echo  [.] package-lock.json changed during update. Refreshing dependencies...
        call npm install --no-audit --no-fund
        if errorlevel 1 (
          echo  [X] Post-update dependency refresh failed.
          set EXIT_CODE=1
          goto :report_exit
        )
        copy /Y package-lock.json node_modules\.tv-lockfile-snapshot >nul 2>nul
        echo.
      )
    )
  )
  goto :restart_loop
)

:report_exit
echo.
echo  ===================================
if "!EXIT_CODE!"=="0" (
  echo    Tusk's Vault exited cleanly.
  echo  ===================================
) else (
  echo    Tusk's Vault exited with error code !EXIT_CODE!.
  echo  ===================================
  echo.
  echo  Scroll up in this window to see the error message.
  echo.
  echo  Common causes ^& fixes:
  echo.
  echo  1. PORT CONFLICT: another program is using ports 3000-3019.
  echo     - Close any other dev servers running ^(VS Code Live Server,
  echo       Vite, Create-React-App, etc.^), or...
  echo     - Pick a different port: open .env.local in a text editor
  echo       and add this line, then re-run:
  echo            PORT=3500
  echo.
  echo  2. MISSING PACKAGE / OUTDATED DEPENDENCIES: the error message says
  echo     "Cannot find package ..." or "ERR_MODULE_NOT_FOUND".
  echo     This usually means new code was pulled but npm install never ran.
  echo     - Force a re-install: delete node_modules\.tv-lockfile-snapshot
  echo       then double-click run.bat again. The launcher will detect the
  echo       missing snapshot and re-install.
  echo     - Or run from a Command Prompt:  npm install
  echo.
  echo  3. CORRUPTED DEPENDENCIES: install was interrupted or broken.
  echo     - Delete the node_modules folder
  echo     - Delete the package-lock.json file
  echo     - Double-click run.bat again to reinstall.
  echo.
  echo  4. EMBEDDING MODEL DOWNLOAD FAILED ^(needs internet on first run^):
  echo     - Delete the models folder
  echo     - Make sure you can reach https://huggingface.co
  echo     - Double-click run.bat again.
  echo.
  echo  If none of these help, copy this window's text and open an issue:
  echo  https://github.com/KochiTusker/Tusks-Vault/issues
)

:end
echo.
echo  Press any key to close this window.
pause >nul
endlocal

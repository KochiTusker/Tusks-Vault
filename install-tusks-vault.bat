@echo off
setlocal EnableDelayedExpansion

REM ===========================================================================
REM  Tusk's Vault - one-file installer for Windows
REM ===========================================================================
REM
REM  This is the file someone downloads when they found the Foundry VTT module
REM  first and have never seen this project before. After it finishes, the only
REM  thing they ever need again is run.bat.
REM
REM  Design rules, in priority order:
REM
REM  1. NOTHING HAPPENS BEFORE THE USER HAS SEEN THE FULL PLAN. Every install
REM     location, every download, and every system-wide change is printed and
REM     confirmed once, up front. A user who declines has changed nothing.
REM
REM  2. It CLONES rather than downloading a ZIP. The in-app updater runs
REM     `git pull --ff-only`, so a ZIP install would produce a Vault that can
REM     never update itself - a failure the user would not discover for weeks.
REM
REM  3. It finishes in ONE run. When winget installs Node or git, the new
REM     command is not on this process's PATH, so the PATH is re-read from the
REM     registry rather than telling the user to start over.
REM
REM  4. It reuses setup.bat for dependency installation instead of copying it.
REM     That script already handles the Windows-specific npm failures - sync
REM     clients, antivirus, protected folders, proxies - and its diagnostics
REM     are better than anything inlined here would be.
REM ===========================================================================

set "REPO_URL=https://github.com/KochiTusker/Tusks-Vault.git"
set "DEFAULT_DIR=%USERPROFILE%\Tusks-Vault"
set "CONFIG_DIR=%APPDATA%\tusks-vault\Config"

echo.
echo  ==========================================
echo    Tusk's Vault - installer
echo  ==========================================
echo.

REM --- Already inside a clone? ------------------------------------------------
REM Someone who already has the repo may double-click this out of the folder by
REM mistake. Say so plainly instead of cloning a second copy inside the first.
if exist "%~dp0package.json" if exist "%~dp0server.ts" (
  echo  [i] You are already inside a Tusk's Vault folder.
  echo      To start it, double-click run.bat in this folder instead.
  echo.
  pause
  exit /b 0
)

REM --- What is already here? --------------------------------------------------
set "NEED_NODE=1"
set "NEED_GIT=1"
set "NODE_MAJOR="

where git >nul 2>nul && set "NEED_GIT="
call :check_node && set "NEED_NODE="

REM ===========================================================================
REM  Step 1 - where should it go
REM ===========================================================================
:choose_location
echo  Where should Tusk's Vault be installed?
echo.
echo     [1] !DEFAULT_DIR!
echo         ^(recommended^)
echo     [2] Browse for a folder...
echo     [3] Type a path
echo     [Q] Quit
echo.
set "CHOICE="
set /p "CHOICE=  Choose [1]: "
if "!CHOICE!"=="" set "CHOICE=1"

if /i "!CHOICE!"=="Q" exit /b 0
REM Braced, not `set ... ^& goto`: cmd splits on `&` at the top level, so the
REM `if` would guard only the `set` and every choice would fall through here.
if "!CHOICE!"=="1" (
  set "TARGET=!DEFAULT_DIR!"
  goto :validate_target
)
if "!CHOICE!"=="2" (
  REM The native folder browser - the same "point at it rather than type it"
  REM affordance the dashboard uses for choosing a lore folder.
  set "PICKED="
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder to install Tusk''s Vault into'; $d.SelectedPath = $env:USERPROFILE; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"`) do set "PICKED=%%p"
  if "!PICKED!"=="" (
    echo.
    echo  [i] Nothing chosen.
    echo.
    goto :choose_location
  )
  set "TARGET=!PICKED!\Tusks-Vault"
  goto :validate_target
)
if "!CHOICE!"=="3" (
  set "TYPED="
  set /p "TYPED=  Full path: "
  if "!TYPED!"=="" ( echo. & goto :choose_location )
  set "TARGET=!TYPED!"
  goto :validate_target
)
echo.
echo  [i] Pick 1, 2, 3 or Q.
echo.
goto :choose_location

:validate_target
REM Strip a trailing backslash so the path prints cleanly and joins predictably.
if "!TARGET:~-1!"=="\" set "TARGET=!TARGET:~0,-1!"

REM These three destinations produce a confusing npm failure much later, so they
REM are caught here, where the message can still be useful.
echo !TARGET! | findstr /i /c:"\Program Files" >nul && (
  echo.
  echo  [X] That is a system-protected folder. npm cannot write there without
  echo      admin rights, and Vault does not need them. Pick somewhere under
  echo      your user folder instead.
  echo.
  goto :choose_location
)
echo !TARGET! | findstr /i /c:"\Windows\" >nul && (
  echo.
  echo  [X] That folder belongs to Windows. Pick somewhere under your user
  echo      folder instead.
  echo.
  goto :choose_location
)
echo !TARGET! | findstr /i /c:"OneDrive" >nul && (
  echo.
  echo  [!] That folder is inside OneDrive. Sync clients hold files open while
  echo      npm is writing, which breaks installs in ways that look random.
  echo.
  set "ONEDRIVE_OK="
  set /p "ONEDRIVE_OK=  Continue anyway? [y/N]: "
  if /i not "!ONEDRIVE_OK!"=="y" ( echo. & goto :choose_location )
)

if exist "!TARGET!\package.json" if exist "!TARGET!\server.ts" (
  echo.
  echo  [i] Tusk's Vault is already installed there.
  echo.
  set "REUSE="
  set /p "REUSE=  Start the existing install? [Y/n]: "
  if /i "!REUSE!"=="n" ( echo. & goto :choose_location )
  goto :launch
)

if exist "!TARGET!\*" (
  echo.
  echo  [X] That folder already exists and is not empty. Choose an empty or
  echo      new folder so nothing of yours is overwritten.
  echo.
  goto :choose_location
)

REM ===========================================================================
REM  Step 2 - show the whole plan, then ask once
REM ===========================================================================
echo.
echo  ==========================================
echo    What this will do
echo  ==========================================
echo.
echo   Tusk's Vault will be installed to:
echo     !TARGET!
echo.
echo   Downloaded into that folder:
echo     - The Tusk's Vault program files       ^(a few MB, from GitHub^)
echo     - node_modules\                        ^(~200 MB of libraries^)
echo     - models\                              ^(~25 MB, on first start - the
echo                                             offline text-matching model^)
echo.
echo   Saved outside that folder:
echo     - !CONFIG_DIR!
echo       ^(your settings and your encrypted API keys^)
echo.

if defined NEED_NODE (
  echo   Also installed, system-wide, because it is missing:
  echo     - Node.js ^(LTS^)  via  winget install OpenJS.NodeJS.LTS
)
if defined NEED_GIT (
  if not defined NEED_NODE echo   Also installed, system-wide, because it is missing:
  echo     - Git            via  winget install Git.Git
)
if defined NEED_NODE echo     Windows will ask for permission ^(a UAC prompt^) for these.
if not defined NEED_NODE if defined NEED_GIT echo     Windows will ask for permission ^(a UAC prompt^) for these.
if not defined NEED_NODE if not defined NEED_GIT (
  echo   Node.js v!NODE_MAJOR! and Git are already installed - nothing
  echo   system-wide will be changed.
)

echo.
echo   Not done: nothing is installed globally by npm, no service is
echo   registered, and no data leaves your machine during setup.
echo.
echo   To remove it later: delete the folder above, and the settings folder.
echo.
set "GO="
set /p "GO=  Continue? [Y/n]: "
if /i "!GO!"=="n" (
  echo.
  echo  Nothing has been changed.
  echo.
  pause
  exit /b 0
)

REM ===========================================================================
REM  Step 3 - prerequisites
REM ===========================================================================
if defined NEED_GIT (
  call :install_prereq "Git" "Git.Git" "https://git-scm.com/"
  if errorlevel 1 exit /b 1
)
if defined NEED_NODE (
  call :install_prereq "Node.js" "OpenJS.NodeJS.LTS" "https://nodejs.org/"
  if errorlevel 1 exit /b 1
)

REM Re-verify rather than trust: winget can report success while putting the
REM tool somewhere this process still cannot see.
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Git still is not available in this window. Close it, open the
  echo      installer again, and it will pick up the new command.
  echo.
  pause
  exit /b 1
)
call :check_node
if errorlevel 1 (
  echo.
  echo  [X] Node.js still is not available in this window. Close it, open the
  echo      installer again, and it will pick up the new command.
  echo.
  pause
  exit /b 1
)
echo.
echo  [.] Node v!NODE_MAJOR! and Git are ready.

REM ===========================================================================
REM  Step 4 - download
REM ===========================================================================
echo.
echo  [.] Downloading Tusk's Vault into !TARGET! ...
echo.
git clone "%REPO_URL%" "!TARGET!"
if errorlevel 1 (
  echo.
  echo  [X] Download failed. The usual causes are no internet connection, or a
  echo      company network blocking github.com.
  echo.
  pause
  exit /b 1
)

REM `git clone` reports success for a repository with no commits, which leaves a
REM folder containing nothing but .git. Verify the files we are about to depend
REM on actually arrived, so the failure is named here rather than surfacing as
REM "setup.bat is not recognized" two steps later.
if not exist "!TARGET!\run.bat" (
  echo.
  echo  [X] The download completed but arrived empty - the repository has no
  echo      published release yet.
  echo.
  echo      Nothing was installed. Check for a release at:
  echo        https://github.com/KochiTusker/Tusks-Vault
  echo.
  rmdir /s /q "!TARGET!" 2>nul
  pause
  exit /b 1
)

REM ===========================================================================
REM  Step 5 - dependencies, via the repo's own first-time setup
REM ===========================================================================
echo.
echo  [.] Installing dependencies. This takes about a minute.
echo.
pushd "!TARGET!"
call setup.bat
set "SETUP_RC=!ERRORLEVEL!"
popd
if not "!SETUP_RC!"=="0" (
  echo.
  echo  [X] Dependency installation did not finish. The messages above say why.
  echo      Fix the cause, then double-click setup.bat in:
  echo        !TARGET!
  echo.
  pause
  exit /b 1
)

REM ===========================================================================
REM  Step 6 - shortcut
REM ===========================================================================
set "MADE_LINK="
echo.
set "MAKE_LINK="
set /p "MAKE_LINK=  Put a 'Tusk's Vault' shortcut on your Desktop? [Y/n]: "
if /i not "!MAKE_LINK!"=="n" (
  powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Tusk''s Vault.lnk')); $s.TargetPath = '!TARGET!\run.bat'; $s.WorkingDirectory = '!TARGET!'; $s.Description = 'Start Tusk''s Vault'; $s.Save()" >nul 2>nul
  if not errorlevel 1 set "MADE_LINK=1"
)

REM ===========================================================================
REM  Step 7 - what just happened
REM ===========================================================================
echo.
echo  ==========================================
echo    Installed
echo  ==========================================
echo.
echo   Program:   !TARGET!
echo   Settings:  !CONFIG_DIR!
echo.
echo   To start Tusk's Vault from now on:
if defined MADE_LINK (
  echo     Double-click the "Tusk's Vault" shortcut on your Desktop
  echo     ^(or run.bat in the folder above^)
) else (
  echo     Double-click run.bat in the folder above
)
echo.
echo   It opens at http://localhost:3000 in your browser.
echo.
echo   For the Foundry module: start Vault, then in Foundry go to
echo   Settings -^> Game Settings -^> Module Settings -^> Tusk's Vault -^> Connect.
echo.

set "START_NOW="
set /p "START_NOW=  Start it now? [Y/n]: "
if /i "!START_NOW!"=="n" (
  echo.
  pause
  exit /b 0
)

:launch
echo.
echo  [.] Starting Tusk's Vault. Your browser will open by itself.
echo.
cd /d "!TARGET!"
call run.bat
exit /b 0

REM ===========================================================================
REM  Is a usable Node present? Sets NODE_MAJOR. Returns 1 when absent or old.
REM ===========================================================================
:check_node
set "NODE_MAJOR="
where node >nul 2>nul || exit /b 1
for /f "tokens=*" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
if "!NODE_MAJOR!"=="" exit /b 1
if !NODE_MAJOR! LSS 20 exit /b 1
exit /b 0

REM ===========================================================================
REM  Install a missing prerequisite through winget, then make it usable in THIS
REM  process. Without the PATH refresh the user would have to close the window
REM  and start again, which is the step most people never come back from.
REM
REM  %~1 friendly name   %~2 winget id   %~3 download page
REM ===========================================================================
:install_prereq
echo.
echo  [.] Installing %~1 ...
echo.
where winget >nul 2>nul
if errorlevel 1 (
  echo  [X] %~1 is missing and winget is not available on this PC.
  echo      Install %~1 from: %~3
  echo      Then run this installer again.
  echo.
  pause
  exit /b 1
)
winget install -e --id %~2 --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo.
  echo  [X] Installing %~1 did not complete. Install it from %~3 and run this
  echo      installer again.
  echo.
  pause
  exit /b 1
)
call :refresh_path
exit /b 0

REM ===========================================================================
REM  Rebuild PATH from the registry so a just-installed tool is callable now.
REM  Windows only hands the updated PATH to processes started afterwards.
REM  `call set` is what expands the %SystemRoot%-style entries the registry
REM  stores unexpanded.
REM ===========================================================================
:refresh_path
set "MACHINE_PATH="
set "USER_PATH="
for /f "usebackq tokens=2,*" %%a in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul`) do set "MACHINE_PATH=%%b"
for /f "usebackq tokens=2,*" %%a in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USER_PATH=%%b"
if defined MACHINE_PATH call set "PATH=%MACHINE_PATH%;%USER_PATH%"
REM Belt and braces: winget's default locations, in case the registry read
REM produced something unusable.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;!PATH!"
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;!PATH!"
exit /b 0

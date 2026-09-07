# Tusk's Vault - uninstaller (Windows PowerShell)
#
# Reverts your machine as close to "I never installed Tusk's Vault" as a
# script can get. Deletes everything Vault creates on disk OUTSIDE of:
#   - the repo source tree itself (you delete that yourself when you're ready)
#   - your Tusks-Lore/ folder (campaign data - never touched)
#   - your Lore/ folder (legacy lore location - never touched)
#   - any custom loreFolderPath you configured in settings.json
#
# Lists every path it would touch (and every external thing it cannot touch),
# requires you to type "yes" to proceed, and prints a final summary so you
# can audit anything left behind.
#
# Usage:
#   pwsh ./uninstall.ps1                  # interactive (recommended)
#   pwsh ./uninstall.ps1 -Yes             # skip the prompt (for scripts)
#   pwsh ./uninstall.ps1 -DryRun          # show what WOULD happen, change nothing
#
# Or double-click uninstall.bat which wraps this with a sensible default policy.

[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$Manual
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# ─── manual uninstall instructions ──────────────────────────────────────────
# Printed when the user passes -Manual. Lets them uninstall Vault entirely by
# hand, without running the rest of this script. Doesn't depend on being
# inside a Vault clone - we print it before Guard A so it works from
# anywhere.
function Show-ManualSteps {
  Write-Host ""
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host "  Manual uninstall - step-by-step"                                -ForegroundColor Cyan
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Every category of state that 'git clone' + 'setup.bat' + first" -ForegroundColor Cyan
  Write-Host "launch put on your machine, with the exact command to remove"    -ForegroundColor Cyan
  Write-Host "each. Run these in order from the Tusk's Vault repo root,"       -ForegroundColor Cyan
  Write-Host "EXCEPT step 5 which you run from outside the repo."              -ForegroundColor Cyan
  Write-Host ""
  Write-Host "STEP 1 - Stop the Vault dev server." -ForegroundColor White
  Write-Host "  Close any run.bat / run.sh window."
  Write-Host "  Press Ctrl+C in any terminal running 'npm run dev'."
  Write-Host ""
  Write-Host "STEP 2 - Delete Vault's runtime state inside the repo." -ForegroundColor White
  Write-Host "  All of these are gitignored - created by Vault at runtime,"
  Write-Host "  never by 'git clone' itself."
  Write-Host ""
  Write-Host "  Windows (PowerShell, from the repo root):" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Recurse -Force node_modules, models, dist, api-keys.json, settings.json, .env.local, run.log, .port-runtime -ErrorAction SilentlyContinue"
  Write-Host ""
  Write-Host "  macOS / Linux (from the repo root):" -ForegroundColor DarkGray
  Write-Host "    rm -rf node_modules models dist api-keys.json settings.json .env.local run.log .port-runtime"
  Write-Host ""
  Write-Host "STEP 3 - Delete the per-user 'tusks-vault' state directories." -ForegroundColor White
  Write-Host "  Holds add-on markers + future config/cache/log/temp use."
  Write-Host ""
  Write-Host "  Windows (PowerShell):" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Recurse -Force `"`$env:LOCALAPPDATA\tusks-vault`" -ErrorAction SilentlyContinue"
  Write-Host "    Remove-Item -Recurse -Force `"`$env:APPDATA\tusks-vault`" -ErrorAction SilentlyContinue"
  Write-Host "    Remove-Item -Recurse -Force `"`$env:TEMP\tusks-vault`" -ErrorAction SilentlyContinue"
  Write-Host ""
  Write-Host "  macOS:" -ForegroundColor DarkGray
  Write-Host "    rm -rf `"`$HOME/Library/Application Support/tusks-vault`""
  Write-Host "    rm -rf `"`$HOME/Library/Preferences/tusks-vault`""
  Write-Host "    rm -rf `"`$HOME/Library/Caches/tusks-vault`""
  Write-Host "    rm -rf `"`$HOME/Library/Logs/tusks-vault`""
  Write-Host "    rm -rf `"`${TMPDIR:-/tmp}/tusks-vault`""
  Write-Host ""
  Write-Host "  Linux:" -ForegroundColor DarkGray
  Write-Host "    rm -rf `"`${XDG_DATA_HOME:-`$HOME/.local/share}/tusks-vault`""
  Write-Host "    rm -rf `"`${XDG_CONFIG_HOME:-`$HOME/.config}/tusks-vault`""
  Write-Host "    rm -rf `"`${XDG_CACHE_HOME:-`$HOME/.cache}/tusks-vault`""
  Write-Host "    rm -rf `"`${XDG_STATE_HOME:-`$HOME/.local/state}/tusks-vault`""
  Write-Host "    rm -rf `"`${TMPDIR:-/tmp}/tusks-vault`""
  Write-Host ""
  Write-Host "STEP 4 - (Optional) Clean Vault state inside your lore folder." -ForegroundColor White
  Write-Host "  These four artifacts were written by Vault but live next to"
  Write-Host "  YOUR campaign documents - delete by hand only if you want a"
  Write-Host "  complete scrub. Replace <lore-folder> with your actual path:"
  Write-Host ""
  Write-Host "  Windows:" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Force <lore-folder>\clarifications.json, <lore-folder>\clarifications.embeddings.json, <lore-folder>\lore_gaps.json"
  Write-Host "    Remove-Item -Recurse -Force <lore-folder>\logs"
  Write-Host ""
  Write-Host "  macOS / Linux:" -ForegroundColor DarkGray
  Write-Host "    rm -f <lore-folder>/clarifications.json <lore-folder>/clarifications.embeddings.json <lore-folder>/lore_gaps.json"
  Write-Host "    rm -rf <lore-folder>/logs"
  Write-Host ""
  Write-Host "STEP 5 - Delete the repo itself." -ForegroundColor White
  Write-Host "  CAUTION: If you have campaign documents inside <repo>/Lore/" -ForegroundColor Yellow
  Write-Host "  (legacy lore location) you want to keep, MOVE them out first." -ForegroundColor Yellow
  Write-Host "  The sibling Tusks-Lore/ folder (recommended layout) is"
  Write-Host "  outside the repo and unaffected."
  Write-Host ""
  Write-Host "  Windows:  Remove-Item -Recurse -Force `"<path-to-repo>`"" -ForegroundColor DarkGray
  Write-Host "  Unix:     rm -rf `"<path-to-repo>`"" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "STEP 6 - External cleanup (live elsewhere - only you can do these)." -ForegroundColor White
  Write-Host ""
  Write-Host "  Discord bot registration:"
  Write-Host "    https://discord.com/developers/applications"
  Write-Host "    Find the app you created for the bot and delete it."
  Write-Host ""
  Write-Host "  LLM provider API keys (revoke any you generated for Vault):"
  Write-Host "    Anthropic:  https://console.anthropic.com/settings/keys"
  Write-Host "    Google:     https://aistudio.google.com/app/apikey"
  Write-Host "    OpenAI:     https://platform.openai.com/api-keys"
  Write-Host ""
  Write-Host "  Browser state for http://localhost:3000:"
  Write-Host "    Clear via your browser's site settings for that origin."
  Write-Host ""
  Write-Host "  Ollama (if you installed it for the Local LLMs add-on):"
  Write-Host "    Vault never installed Ollama. Use Ollama's own uninstaller."
  Write-Host ""
  Write-Host "STEP 7 - (Optional) Uninstall Node.js and Git." -ForegroundColor White
  Write-Host "  ONLY do this if you installed them specifically for Vault" -ForegroundColor Yellow
  Write-Host "  and don't need them for anything else. Many other apps use them." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Node.js:"
  Write-Host "    Windows:  Settings -> Apps -> Node.js -> Uninstall"
  Write-Host "    macOS:    brew uninstall node    (or use the installer's uninstaller)"
  Write-Host "    Linux:    sudo apt remove nodejs npm    (or your distro's equivalent)"
  Write-Host ""
  Write-Host "  Git:"
  Write-Host "    Windows:  Settings -> Apps -> Git -> Uninstall"
  Write-Host "    macOS:    brew uninstall git"
  Write-Host "    Linux:    sudo apt remove git"
  Write-Host ""
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host "  Done. No changes have been made by THIS script run."          -ForegroundColor Cyan
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host ""
}

if ($Manual) { Show-ManualSteps; exit 0 }

# ─── safety guards ──────────────────────────────────────────────────────────

# Guard A: refuse to run if the script isn't sitting inside a Tusk's Vault
# clone. Prevents accidental damage if someone copies uninstall.ps1 to their
# Desktop and double-clicks it - the script would otherwise treat the Desktop
# as $RepoRoot and try to delete files named node_modules / settings.json
# /etc. that happened to be there.
function Assert-VaultRepo {
  $pkg = Join-Path $RepoRoot "package.json"
  $server = Join-Path $RepoRoot "server.ts"
  if (-not (Test-Path $pkg) -or -not (Test-Path $server)) {
    Write-Host ""
    Write-Host "ERROR: This doesn't look like a Tusk's Vault clone." -ForegroundColor Red
    Write-Host "  Expected to find package.json AND server.ts in:" -ForegroundColor Red
    Write-Host "    $RepoRoot" -ForegroundColor Red
    Write-Host "  Aborting - uninstall.ps1 must live in the repo root." -ForegroundColor Red
    Write-Host ""
    exit 2
  }
  try {
    $pkgJson = Get-Content $pkg -Raw | ConvertFrom-Json
    if ($pkgJson.name -ne "tusks-vault") {
      Write-Host ""
      Write-Host "ERROR: package.json found but its name is '$($pkgJson.name)', not 'tusks-vault'." -ForegroundColor Red
      Write-Host "  Aborting - uninstall.ps1 must be run from the Tusk's Vault repo root." -ForegroundColor Red
      Write-Host ""
      exit 2
    }
  } catch {
    Write-Host ""
    Write-Host "ERROR: Could not parse $pkg. Aborting to be safe." -ForegroundColor Red
    Write-Host ""
    exit 2
  }
}
Assert-VaultRepo

# Guard B: refuse to delete suspicious paths. A defence-in-depth check that
# runs before every Remove-Item call. Catches resolved paths that match a
# system root, are dangerously short, or aren't absolute.
$SystemRootsToProtect = @(
  $env:SystemRoot,
  $env:USERPROFILE,
  $env:LOCALAPPDATA,
  $env:APPDATA,
  $env:TEMP,
  $env:HOMEDRIVE,
  "$($env:HOMEDRIVE)\",
  "C:\",
  "C:\Users",
  "C:\Windows",
  "C:\Program Files",
  "C:\Program Files (x86)"
) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }

function Assert-SafeToDelete($path) {
  if (-not [IO.Path]::IsPathRooted($path)) {
    throw "Refused to delete relative path: $path"
  }
  $trimmed = $path.TrimEnd('\').TrimEnd('/')
  if ($trimmed.Length -lt 8) {
    throw "Refused to delete suspiciously short path: $path"
  }
  foreach ($root in $SystemRootsToProtect) {
    if ($trimmed -ieq $root) {
      throw "Refused to delete system root: $path"
    }
  }
}

function Write-Banner {
  Write-Host ""
  Write-Host "===============================================================" -ForegroundColor DarkCyan
  Write-Host "  Tusk's Vault - Uninstaller"                                    -ForegroundColor DarkCyan
  Write-Host "===============================================================" -ForegroundColor DarkCyan
  Write-Host ""
}

# ─── path resolution ────────────────────────────────────────────────────────

# Per-user data directories. Mirrors env-paths' Windows layout. Vault uses
# 'data' today (for add-on markers), but cleaning all five makes the script
# resilient to future code that uses config/cache/log/temp. Deleting a
# non-existent dir is a no-op so this is safe even if a location was never
# created.
function Get-VaultEnvPathsRoots {
  $roots = @()
  if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA "tusks-vault") }  # data, cache, log
  if ($env:APPDATA)      { $roots += (Join-Path $env:APPDATA      "tusks-vault") }  # config
  if ($env:TEMP)         { $roots += (Join-Path $env:TEMP         "tusks-vault") }  # temp
  return $roots
}

# Honour TUSKS_VAULT_CONFIG_DIR if set - walks up to find a tusks-vault
# parent; if none, cleans the override dir as-is. This is where the ENCRYPTED
# KEY STORE lives on a portable install, so skipping it would leave the
# user's credentials behind after they asked for a clean removal.
function Get-VaultConfigOverrideRoot {
  if (-not $env:TUSKS_VAULT_CONFIG_DIR) { return $null }
  $p = $env:TUSKS_VAULT_CONFIG_DIR
  $orig = $p
  while ($p -and (Split-Path -Leaf $p) -ne "tusks-vault" -and $p -ne (Split-Path -Parent $p)) {
    $p = Split-Path -Parent $p
  }
  if ((Split-Path -Leaf $p) -eq "tusks-vault") { return $p }
  return $orig
}

# Read settings.json (if any) for a custom loreFolderPath so we know which
# user-owned folder to PRESERVE.
function Get-CustomLoreFolder {
  $settingsPath = Join-Path $RepoRoot "settings.json"
  if (-not (Test-Path $settingsPath)) { return $null }
  try {
    $s = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($s.loreFolderPath -and (Test-Path $s.loreFolderPath)) {
      return (Resolve-Path $s.loreFolderPath).Path
    }
  } catch {
    # Corrupt settings.json - ignore, fall through.
  }
  return $null
}

# ─── enumerate paths ────────────────────────────────────────────────────────

$toDelete = New-Object System.Collections.Generic.List[object]
$preserved = New-Object System.Collections.Generic.List[object]

function Add-ToDelete($path, $label) {
  if ($path -and (Test-Path $path)) {
    # Skip duplicates so the same path doesn't appear twice if two env-paths
    # roots collapse to the same location.
    if (-not ($toDelete | Where-Object { $_.Path -eq $path })) {
      $toDelete.Add([pscustomobject]@{ Path = $path; Label = $label })
    }
  }
}

function Add-Preserved($path, $label) {
  if ($path -and (Test-Path $path)) {
    if (-not ($preserved | Where-Object { $_.Path -eq $path })) {
      $preserved.Add([pscustomobject]@{ Path = $path; Label = $label })
    }
  }
}

# Files Vault writes inside the repo (gitignored - runtime state).
Add-ToDelete (Join-Path $RepoRoot "node_modules")     "Dependencies + add-on libs (node_modules)"
Add-ToDelete (Join-Path $RepoRoot "models")           "Local embedding model cache (~25 MB)"
Add-ToDelete (Join-Path $RepoRoot ".port-runtime")    "Runtime port marker"
Add-ToDelete (Join-Path $RepoRoot "api-keys.json")    "API keys"
Add-ToDelete (Join-Path $RepoRoot "settings.json")    "Dashboard settings"
Add-ToDelete (Join-Path $RepoRoot ".env.local")       "Local env (Discord token)"
Add-ToDelete (Join-Path $RepoRoot "run.log")          "Launcher log"
Add-ToDelete (Join-Path $RepoRoot "dist")             "Production build output"

# Per-user data directories (encrypted keys, personas, caches, logs, temp).
foreach ($root in (Get-VaultEnvPathsRoots)) {
  Add-ToDelete $root "Per-user state ($((Split-Path -Parent $root) | Split-Path -Leaf)\tusks-vault)"
}
$override = Get-VaultConfigOverrideRoot
if ($override) { Add-ToDelete $override "Per-user config (TUSKS_VAULT_CONFIG_DIR override)" }

# User-owned lore folders - PRESERVE all candidates that exist.
Add-Preserved (Join-Path $RepoRoot "Lore")                              "Legacy Lore/ folder"
Add-Preserved (Join-Path (Split-Path -Parent $RepoRoot) "Tusks-Lore")   "Tusks-Lore (campaign data)"
$customLore = Get-CustomLoreFolder
if ($customLore) {
  Add-Preserved $customLore "Custom lore folder (from settings.json)"
}

# Guard C: scrub the deletion list of any path that overlaps a preserved
# path. Catches the edge case where a user configured loreFolderPath to
# somewhere inside the repo (e.g. <repo>/dist) - we'd rather skip the delete
# than nuke their lore.
$preservedResolved = @()
foreach ($p in $preserved) {
  try { $preservedResolved += (Resolve-Path -LiteralPath $p.Path -ErrorAction Stop).Path.TrimEnd('\') } catch { }
}
$filteredToDelete = New-Object System.Collections.Generic.List[object]
$skippedDueToOverlap = New-Object System.Collections.Generic.List[object]
foreach ($d in $toDelete) {
  try {
    $resolved = (Resolve-Path -LiteralPath $d.Path -ErrorAction Stop).Path.TrimEnd('\')
  } catch {
    $filteredToDelete.Add($d) | Out-Null
    continue
  }
  $overlap = $false
  foreach ($pr in $preservedResolved) {
    if ($resolved -ieq $pr -or
        $resolved.StartsWith($pr + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $pr.StartsWith($resolved + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      $skippedDueToOverlap.Add([pscustomobject]@{ Path = $d.Path; Label = $d.Label; PreservedConflict = $pr })
      $overlap = $true
      break
    }
  }
  if (-not $overlap) { $filteredToDelete.Add($d) | Out-Null }
}
$toDelete = $filteredToDelete

# ─── print plan ─────────────────────────────────────────────────────────────

Write-Banner
Write-Host "WILL DELETE (on this machine):" -ForegroundColor Yellow
if ($toDelete.Count -eq 0) {
  Write-Host "  (nothing - Vault doesn't appear to have created any state here yet)"
} else {
  foreach ($p in $toDelete) {
    Write-Host ("  - {0,-44} {1}" -f $p.Label, $p.Path)
  }
}

if ($skippedDueToOverlap.Count -gt 0) {
  Write-Host ""
  Write-Host "SKIPPED (overlap with preserved path - safer to leave alone):" -ForegroundColor DarkYellow
  foreach ($s in $skippedDueToOverlap) {
    Write-Host ("  - {0,-44} {1}" -f $s.Label, $s.Path)
    Write-Host ("       overlaps with: {0}" -f $s.PreservedConflict) -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "PRESERVED (your data - never touched):" -ForegroundColor Green
if ($preserved.Count -eq 0) {
  Write-Host "  (no user-owned lore folders detected)"
} else {
  foreach ($p in $preserved) {
    Write-Host ("  - {0,-44} {1}" -f $p.Label, $p.Path)
  }
}

Write-Host ""
Write-Host "NOT TOUCHED (still on this machine, your call):" -ForegroundColor Cyan
Write-Host ("  - The repo at {0}" -f $RepoRoot)
Write-Host "    Delete it yourself when you're sure you don't need it:"
Write-Host ("      Remove-Item -Recurse -Force `"{0}`"" -f $RepoRoot)
Write-Host ""
Write-Host "  - Small state files inside your preserved lore folder(s):" -ForegroundColor DarkGray
Write-Host "      clarifications.json, clarifications.embeddings.json," -ForegroundColor DarkGray
Write-Host "      lore_gaps.json, logs/" -ForegroundColor DarkGray
Write-Host "    These were written by Vault but live next to YOUR documents," -ForegroundColor DarkGray
Write-Host "    so the script refuses to reach in. Delete by hand for a total scrub." -ForegroundColor DarkGray

Write-Host ""
Write-Host "CANNOT CLEAN AUTOMATICALLY (live elsewhere - do these yourself):" -ForegroundColor Magenta
Write-Host "  - Your Discord bot registration at"
Write-Host "      https://discord.com/developers/applications"
Write-Host "    Find the app you created for the bot and delete it there."
Write-Host ""
Write-Host "  - Your LLM provider API keys (still active at the provider):"
Write-Host "      Anthropic:  https://console.anthropic.com/settings/keys"
Write-Host "      Google:     https://aistudio.google.com/app/apikey"
Write-Host "      OpenAI:     https://platform.openai.com/api-keys"
Write-Host "    Revoke any keys you generated for Vault so they can't be reused."
Write-Host ""
Write-Host "  - Browser state for http://localhost:3000"
Write-Host "    (localStorage / cookies / cached assets). Clear via your"
Write-Host "    browser's site settings for that origin."
Write-Host ""
Write-Host "  - Ollama itself (if you installed it for the Local LLMs add-on)."
Write-Host "    Vault never installed it - use Ollama's own uninstaller."
Write-Host ""

if ($toDelete.Count -eq 0) {
  Write-Host "Nothing to do. Exiting."
  exit 0
}

if ($DryRun) {
  Write-Host "DRY RUN - no changes made. Re-run without -DryRun to actually delete." -ForegroundColor Cyan
  exit 0
}

# ─── acknowledgement prompt (safety net #1) ─────────────────────────────────
# Printed AFTER the plan, BEFORE the final yes prompt. Forces the user to
# explicitly accept the risk and the usage contract. Any input other than the
# exact phrase exits cleanly with no changes.
if (-not $Yes) {
  Write-Host ""
  Write-Host "===============================================================" -ForegroundColor Yellow
  Write-Host "  IMPORTANT - read this before continuing"                       -ForegroundColor Yellow
  Write-Host "===============================================================" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "This script permanently deletes the files listed above."         -ForegroundColor Yellow
  Write-Host "Deletion is IRREVERSIBLE - there is no recycle bin, no undo."    -ForegroundColor Yellow
  Write-Host ""
  Write-Host "It is SAFE to run, but only if you follow these rules:"
  Write-Host ""
  Write-Host "  1. Run this script from the root of your Tusk's Vault clone." -ForegroundColor White
  Write-Host "     (You already passed this check, or you wouldn't see this prompt.)"
  Write-Host ""
  Write-Host "  2. STOP the Vault dev server BEFORE proceeding." -ForegroundColor White
  Write-Host "     Close any run.bat / run.sh window. Press Ctrl+C in any"
  Write-Host "     terminal still running 'npm run dev'."
  Write-Host ""
  Write-Host "  3. Do NOT modify this script before running it." -ForegroundColor White
  Write-Host "     If you suspect it has been tampered with, abort now and"
  Write-Host "     re-download a clean copy from the official repo:"
  Write-Host "       https://github.com/KochiTusker/Tusks-Vault"
  Write-Host ""
  Write-Host "  4. Review the WILL DELETE list above carefully." -ForegroundColor White
  Write-Host "     If ANYTHING looks unexpected, abort now."
  Write-Host ""
  Write-Host "If you follow these rules, the script will only delete:"          -ForegroundColor Green
  Write-Host "  - Files inside this repo that Vault wrote at runtime."           -ForegroundColor Green
  Write-Host "  - The per-user 'tusks-vault' state directory."                   -ForegroundColor Green
  Write-Host "Your Tusks-Lore / Lore folders and your campaign documents"        -ForegroundColor Green
  Write-Host "will NEVER be touched."                                            -ForegroundColor Green
  Write-Host ""
  Write-Host "If you do NOT follow the rules (run from the wrong place, edit"   -ForegroundColor Red
  Write-Host "the script, bypass the safety guards, or ignore an unexpected"    -ForegroundColor Red
  Write-Host "entry in the list above), you accept the risk of unintended"      -ForegroundColor Red
  Write-Host "data loss. The author is not liable in that case."                -ForegroundColor Red
  Write-Host ""
  Write-Host "Safer previews + alternative paths:"                              -ForegroundColor Cyan
  Write-Host "  -DryRun   Show the plan without changing anything."             -ForegroundColor Cyan
  Write-Host "  -Manual   Print step-by-step manual uninstall instructions"     -ForegroundColor Cyan
  Write-Host "            and exit - skip this script entirely if you'd"        -ForegroundColor Cyan
  Write-Host "            rather remove every file by hand."                    -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Type the exact phrase below to acknowledge and continue:"
  Write-Host "    I understand and accept the risk"                              -ForegroundColor White
  Write-Host ""
  Write-Host "Anything else (including pressing Enter or Ctrl+C) exits with"
  Write-Host "NO changes made to your system."
  Write-Host ""
  $ack = Read-Host "Your response"
  if ($ack -ne "I understand and accept the risk") {
    Write-Host ""
    Write-Host "Exited. Your computer is unchanged." -ForegroundColor Green
    Write-Host ""
    exit 0
  }

  # Second confirmation - separate step so a misplaced 'yes' doesn't trigger
  # deletion. The first acknowledgement was about the contract; this one is
  # about the specific list of paths.
  Write-Host ""
  Write-Host "Final confirmation. Type 'yes' to delete the items listed above," -ForegroundColor Yellow
  Write-Host "or anything else (including Enter) to exit without changes."
  Write-Host ""
  $ans = Read-Host "Proceed with deletion?"
  if ($ans -ne "yes") {
    Write-Host ""
    Write-Host "Exited. Your computer is unchanged." -ForegroundColor Green
    Write-Host ""
    exit 0
  }
}

# ─── perform deletion ───────────────────────────────────────────────────────

Write-Host ""
$failures = 0
foreach ($p in $toDelete) {
  Write-Host ("Removing {0}..." -f $p.Path) -NoNewline
  # The guard runs OUTSIDE the try below, and a refusal skips this path
  # entirely. Inside the try, its `throw` landed in the same `catch` that runs
  # the raw `rmdir /s /q` fallback - so every path the guard refused was then
  # deleted by the fallback, which is the exact opposite of the point. The sh
  # twin has always had this shape (assert, then `continue`).
  try {
    Assert-SafeToDelete $p.Path
  } catch {
    Write-Host " REFUSED." -ForegroundColor Red
    Write-Host ("    ({0})" -f $_.Exception.Message) -ForegroundColor DarkYellow
    $failures++
    continue
  }
  $ok = $false
  try {
    Remove-Item -LiteralPath $p.Path -Recurse -Force -ErrorAction Stop
    $ok = $true
  } catch {
    # node_modules can hit Windows MAX_PATH (260 chars) issues even with -Force.
    # Fall back to `cmd /c rmdir /s /q` which handles a few cases Remove-Item
    # doesn't. Last-resort; warn the user if even this fails.
    try {
      $null = cmd /c "rmdir /s /q `"$($p.Path)`"" 2>&1
      if (-not (Test-Path $p.Path)) { $ok = $true }
    } catch {
      # fall through to failure handling below
    }
  }
  if ($ok) {
    Write-Host " done." -ForegroundColor Green
  } else {
    Write-Host " FAILED." -ForegroundColor Red
    Write-Host "    (Is the dev server still running? Stop it and re-run this script.)" -ForegroundColor DarkYellow
    $failures++
  }
}

Write-Host ""
if ($failures -eq 0) {
  Write-Host "Uninstall complete." -ForegroundColor Green
} else {
  Write-Host ("Uninstall finished with {0} failure(s) - see above." -f $failures) -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Your campaign data is intact at the paths listed under PRESERVED."
if ($failures -eq 0) {
  Write-Host ("To remove the repo itself: Remove-Item -Recurse -Force `"{0}`"" -f $RepoRoot)
}
Write-Host ""
Write-Host "Don't forget the off-machine cleanup listed under CANNOT CLEAN AUTOMATICALLY."
Write-Host ""

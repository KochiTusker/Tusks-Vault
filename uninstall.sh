#!/usr/bin/env bash
# Tusk's Vault — uninstaller (macOS / Linux)
#
# Reverts your machine as close to "I never installed Tusk's Vault" as a
# script can get. Deletes everything Vault creates on disk OUTSIDE of:
#   - the repo source tree itself (you delete that yourself when you're ready)
#   - your Tusks-Lore/ folder (campaign data — never touched)
#   - your Lore/ folder (legacy lore location — never touched)
#   - any custom loreFolderPath you configured in settings.json
#
# Lists every path it would touch (and every external thing it cannot touch),
# requires you to type "yes" to proceed, and prints a final summary so you
# can audit anything left behind.
#
# Usage:
#   ./uninstall.sh              # interactive (recommended)
#   ./uninstall.sh --yes        # skip the prompt (for scripts)
#   ./uninstall.sh --dry-run    # show what WOULD happen, change nothing

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YES=0
DRY_RUN=0
MANUAL=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)     YES=1 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --manual|-m)  MANUAL=1 ;;
    *)            echo "Unknown argument: $arg"; exit 2 ;;
  esac
done

# ─── manual uninstall instructions ──────────────────────────────────────────
# Printed when the user passes --manual. Lets them uninstall Vault entirely
# by hand, without running the rest of this script. Doesn't depend on being
# inside a Vault clone - we print it before Guard A so it works from anywhere.
print_manual_steps() {
  cat <<'MANUAL_EOF'

===============================================================
  Manual uninstall — step-by-step
===============================================================

Every category of state that 'git clone' + 'setup.sh' + first launch
put on your machine, with the exact command to remove each. Run these
in order from the Tusk's Vault repo root, EXCEPT step 5 which you run
from outside the repo.

STEP 1 — Stop the Vault dev server.
  Close any run.bat / run.sh window.
  Press Ctrl+C in any terminal running 'npm run dev'.

STEP 2 — Delete Vault's runtime state inside the repo.
  All of these are gitignored — created by Vault at runtime, never by
  'git clone' itself.

  Windows (PowerShell, from the repo root):
    Remove-Item -Recurse -Force node_modules, models, dist, api-keys.json, settings.json, .env.local, run.log, .port-runtime -ErrorAction SilentlyContinue

  macOS / Linux (from the repo root):
    rm -rf node_modules models dist api-keys.json settings.json .env.local run.log .port-runtime

STEP 3 — Delete the per-user 'tusks-vault' state directories.
  Holds add-on markers + future config/cache/log/temp use.

  Windows (PowerShell):
    Remove-Item -Recurse -Force "$env:LOCALAPPDATA\tusks-vault" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$env:APPDATA\tusks-vault" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$env:TEMP\tusks-vault" -ErrorAction SilentlyContinue

  macOS:
    rm -rf "$HOME/Library/Application Support/tusks-vault"
    rm -rf "$HOME/Library/Preferences/tusks-vault"
    rm -rf "$HOME/Library/Caches/tusks-vault"
    rm -rf "$HOME/Library/Logs/tusks-vault"
    rm -rf "${TMPDIR:-/tmp}/tusks-vault"

  Linux:
    rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/tusks-vault"
    rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/tusks-vault"
    rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/tusks-vault"
    rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/tusks-vault"
    rm -rf "${TMPDIR:-/tmp}/tusks-vault"

STEP 4 — (Optional) Clean Vault state inside your lore folder.
  These four artifacts were written by Vault but live next to YOUR
  campaign documents — delete by hand only if you want a complete
  scrub. Replace <lore-folder> with your actual path:

  Windows:
    Remove-Item -Force <lore-folder>\clarifications.json, <lore-folder>\clarifications.embeddings.json, <lore-folder>\lore_gaps.json
    Remove-Item -Recurse -Force <lore-folder>\logs

  macOS / Linux:
    rm -f <lore-folder>/clarifications.json <lore-folder>/clarifications.embeddings.json <lore-folder>/lore_gaps.json
    rm -rf <lore-folder>/logs

STEP 5 — Delete the repo itself.
  CAUTION: If you have campaign documents inside <repo>/Lore/ (legacy
  lore location) you want to keep, MOVE them out first. The sibling
  Tusks-Lore/ folder (recommended layout) is outside the repo and
  unaffected.

  Windows:  Remove-Item -Recurse -Force "<path-to-repo>"
  Unix:     rm -rf "<path-to-repo>"

STEP 6 — External cleanup (live elsewhere — only you can do these).

  Discord bot registration:
    https://discord.com/developers/applications
    Find the app you created for the bot and delete it.

  LLM provider API keys (revoke any you generated for Vault):
    Anthropic:  https://console.anthropic.com/settings/keys
    Google:     https://aistudio.google.com/app/apikey
    OpenAI:     https://platform.openai.com/api-keys

  Browser state for http://localhost:3000:
    Clear via your browser's site settings for that origin.

  Ollama (if you installed it for the Local LLMs add-on):
    Vault never installed Ollama. Use Ollama's own uninstaller.

STEP 7 — (Optional) Uninstall Node.js and Git.
  ONLY do this if you installed them specifically for Vault and don't
  need them for anything else. Many other applications also use them.

  Node.js:
    Windows:  Settings -> Apps -> Node.js -> Uninstall
    macOS:    brew uninstall node    (or use the installer's uninstaller)
    Linux:    sudo apt remove nodejs npm    (or your distro's equivalent)

  Git:
    Windows:  Settings -> Apps -> Git -> Uninstall
    macOS:    brew uninstall git
    Linux:    sudo apt remove git

===============================================================
  Done. No changes have been made by THIS script run.
===============================================================

MANUAL_EOF
}

if [[ $MANUAL -eq 1 ]]; then
  print_manual_steps
  exit 0
fi

# ─── safety guards ──────────────────────────────────────────────────────────

# Guard A: refuse to run if the script isn't sitting inside a Tusk's Vault
# clone. Prevents accidental damage if someone copies uninstall.sh elsewhere
# — the script would otherwise treat that other dir as REPO_ROOT and try to
# delete files named node_modules / settings.json / etc. that happened to be
# there.
assert_vault_repo() {
  if [[ ! -f "$REPO_ROOT/package.json" ]] || [[ ! -f "$REPO_ROOT/server.ts" ]]; then
    echo ""
    echo "ERROR: This doesn't look like a Tusk's Vault clone."
    echo "  Expected to find package.json AND server.ts in:"
    echo "    $REPO_ROOT"
    echo "  Aborting — uninstall.sh must live in the repo root."
    echo ""
    exit 2
  fi
  if command -v node >/dev/null 2>&1; then
    local pkg_name
    pkg_name=$(node -e '
      try {
        const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
        process.stdout.write(p.name || "");
      } catch { process.exit(1); }
    ' "$REPO_ROOT/package.json" 2>/dev/null || echo "")
    if [[ "$pkg_name" != "tusks-vault" ]]; then
      echo ""
      echo "ERROR: package.json found but its name is '$pkg_name', not 'tusks-vault'."
      echo "  Aborting — uninstall.sh must be run from the Tusk's Vault repo root."
      echo ""
      exit 2
    fi
  else
    # No node available — fall back to a grep heuristic on the package.json.
    if ! grep -q '"name"[[:space:]]*:[[:space:]]*"tusks-vault"' "$REPO_ROOT/package.json"; then
      echo ""
      echo "ERROR: package.json in $REPO_ROOT doesn't appear to be tusks-vault."
      echo "  Aborting — uninstall.sh must be run from the Tusk's Vault repo root."
      echo ""
      exit 2
    fi
  fi
}
assert_vault_repo

# Guard B: refuse to delete suspicious paths. Defence in depth — runs before
# every rm. Catches paths that match a system root, are dangerously short,
# aren't absolute, or contain shell metacharacters.
assert_safe_to_delete() {
  local path="$1"
  case "$path" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib32|/lib64|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|/Users|/Applications|/Library|/System|/Volumes|"$HOME"|"$HOME/"|"")
      echo "Refused to delete system root: $path" >&2
      return 1
      ;;
  esac
  if [[ ${#path} -lt 4 ]]; then
    echo "Refused to delete suspiciously short path: $path" >&2
    return 1
  fi
  if [[ "$path" != /* ]]; then
    echo "Refused to delete relative path: $path" >&2
    return 1
  fi
  return 0
}

# ─── path resolution ────────────────────────────────────────────────────────

# Per-user data directories. Mirrors env-paths' layout. Vault uses `data`
# today (for add-on markers), but cleaning all five locations makes the
# script resilient to future code that uses config/cache/log/temp. Deleting
# a non-existent dir is a no-op so this is safe even if a location was
# never created.
vault_envpaths_roots() {
  case "$(uname)" in
    Darwin)
      # macOS — each kind of state lives in a different top-level dir.
      echo "$HOME/Library/Application Support/tusks-vault"   # data
      echo "$HOME/Library/Preferences/tusks-vault"           # config
      echo "$HOME/Library/Caches/tusks-vault"                # cache
      echo "$HOME/Library/Logs/tusks-vault"                  # log
      echo "${TMPDIR:-/tmp}/tusks-vault"                     # temp
      ;;
    *)
      # Linux / other Unix — XDG dirs.
      echo "${XDG_DATA_HOME:-$HOME/.local/share}/tusks-vault"   # data
      echo "${XDG_CONFIG_HOME:-$HOME/.config}/tusks-vault"      # config
      echo "${XDG_CACHE_HOME:-$HOME/.cache}/tusks-vault"        # cache
      echo "${XDG_STATE_HOME:-$HOME/.local/state}/tusks-vault"  # log
      echo "${TMPDIR:-/tmp}/tusks-vault"                        # temp
      ;;
  esac
}

# Honour TUSKS_VAULT_CONFIG_DIR if set — walks up to find a tusks-vault
# parent; if none, cleans the override dir as-is. This is where the ENCRYPTED
# KEY STORE lives on a portable install, so skipping it would leave the
# user's credentials behind after they asked for a clean removal.
vault_config_override_root() {
  if [[ -z "${TUSKS_VAULT_CONFIG_DIR:-}" ]]; then
    return
  fi
  local p="$TUSKS_VAULT_CONFIG_DIR"
  local orig="$p"
  while [[ -n "$p" && "$(basename "$p")" != "tusks-vault" && "$p" != "/" ]]; do
    p="$(dirname "$p")"
  done
  if [[ "$(basename "$p")" == "tusks-vault" ]]; then
    echo "$p"
  else
    echo "$orig"
  fi
}

# Read settings.json (if any) for a custom loreFolderPath so we know which
# user-owned folder to PRESERVE.
custom_lore_folder() {
  local settings="$REPO_ROOT/settings.json"
  if [[ ! -f "$settings" ]] || ! command -v node >/dev/null 2>&1; then
    return
  fi
  node -e '
    try {
      const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
      if (s && typeof s.loreFolderPath === "string" && s.loreFolderPath) {
        process.stdout.write(s.loreFolderPath);
      }
    } catch { /* ignore */ }
  ' "$settings" 2>/dev/null || true
}

# ─── enumerate paths ────────────────────────────────────────────────────────

declare -a TO_DELETE_PATHS=()
declare -a TO_DELETE_LABELS=()
declare -a PRESERVED_PATHS=()
declare -a PRESERVED_LABELS=()

# Dedupe helper — skip a path if already in the bucket.
contains() {
  local target="$1"
  shift
  for item in "$@"; do
    if [[ "$item" == "$target" ]]; then
      return 0
    fi
  done
  return 1
}

add_to_delete() {
  local path="$1"
  local label="$2"
  if [[ -e "$path" ]] && ! contains "$path" "${TO_DELETE_PATHS[@]:+${TO_DELETE_PATHS[@]}}"; then
    TO_DELETE_PATHS+=("$path")
    TO_DELETE_LABELS+=("$label")
  fi
}

add_preserved() {
  local path="$1"
  local label="$2"
  if [[ -e "$path" ]] && ! contains "$path" "${PRESERVED_PATHS[@]:+${PRESERVED_PATHS[@]}}"; then
    PRESERVED_PATHS+=("$path")
    PRESERVED_LABELS+=("$label")
  fi
}

# Files Vault writes inside the repo (gitignored — runtime state).
add_to_delete "$REPO_ROOT/node_modules"     "Dependencies + add-on libs (node_modules)"
add_to_delete "$REPO_ROOT/models"           "Local embedding model cache (~25 MB)"
add_to_delete "$REPO_ROOT/.port-runtime"    "Runtime port marker"
add_to_delete "$REPO_ROOT/api-keys.json"    "API keys"
add_to_delete "$REPO_ROOT/settings.json"    "Dashboard settings"
add_to_delete "$REPO_ROOT/.env.local"       "Local env (Discord token)"
add_to_delete "$REPO_ROOT/run.log"          "Launcher log"
add_to_delete "$REPO_ROOT/dist"             "Production build output"

# Per-user data directories (encrypted keys, personas, caches, logs, temp).
while IFS= read -r root; do
  add_to_delete "$root" "Per-user state ($(basename "$(dirname "$root")")/tusks-vault)"
done < <(vault_envpaths_roots)

OVERRIDE_ROOT="$(vault_config_override_root)"
if [[ -n "$OVERRIDE_ROOT" ]]; then
  add_to_delete "$OVERRIDE_ROOT" "Per-user config (TUSKS_VAULT_CONFIG_DIR override)"
fi

# User-owned lore folders — PRESERVE all candidates that exist.
add_preserved "$REPO_ROOT/Lore"                          "Legacy Lore/ folder"
add_preserved "$(dirname "$REPO_ROOT")/Tusks-Lore"       "Tusks-Lore (campaign data)"
CUSTOM_LORE="$(custom_lore_folder)"
if [[ -n "$CUSTOM_LORE" ]] && [[ -e "$CUSTOM_LORE" ]]; then
  add_preserved "$CUSTOM_LORE" "Custom lore folder (from settings.json)"
fi

# Guard C: scrub the deletion list of any path that overlaps a preserved
# path. Catches the edge case where a user configured loreFolderPath to
# somewhere inside the repo (e.g. <repo>/dist) — we'd rather skip the delete
# than nuke their lore.
declare -a SKIPPED_PATHS=()
declare -a SKIPPED_LABELS=()
declare -a SKIPPED_CONFLICTS=()
declare -a NEW_TO_DELETE_PATHS=()
declare -a NEW_TO_DELETE_LABELS=()
for i in "${!TO_DELETE_PATHS[@]}"; do
  d_path="${TO_DELETE_PATHS[$i]}"
  d_label="${TO_DELETE_LABELS[$i]}"
  # Normalise with realpath if available; otherwise leave as-is.
  d_resolved="$d_path"
  if command -v realpath >/dev/null 2>&1; then
    if r=$(realpath -- "$d_path" 2>/dev/null); then d_resolved="$r"; fi
  fi
  overlap=""
  for p_path in "${PRESERVED_PATHS[@]:+${PRESERVED_PATHS[@]}}"; do
    p_resolved="$p_path"
    if command -v realpath >/dev/null 2>&1; then
      if r=$(realpath -- "$p_path" 2>/dev/null); then p_resolved="$r"; fi
    fi
    if [[ "$d_resolved" == "$p_resolved" ]] || \
       [[ "$d_resolved" == "$p_resolved/"* ]] || \
       [[ "$p_resolved" == "$d_resolved/"* ]]; then
      overlap="$p_resolved"
      break
    fi
  done
  if [[ -n "$overlap" ]]; then
    SKIPPED_PATHS+=("$d_path")
    SKIPPED_LABELS+=("$d_label")
    SKIPPED_CONFLICTS+=("$overlap")
  else
    NEW_TO_DELETE_PATHS+=("$d_path")
    NEW_TO_DELETE_LABELS+=("$d_label")
  fi
done
TO_DELETE_PATHS=("${NEW_TO_DELETE_PATHS[@]:+${NEW_TO_DELETE_PATHS[@]}}")
TO_DELETE_LABELS=("${NEW_TO_DELETE_LABELS[@]:+${NEW_TO_DELETE_LABELS[@]}}")

# ─── print plan ─────────────────────────────────────────────────────────────

echo
echo "==============================================================="
echo "  Tusk's Vault — Uninstaller"
echo "==============================================================="
echo
echo "WILL DELETE (on this machine):"
if [[ ${#TO_DELETE_PATHS[@]} -eq 0 ]]; then
  echo "  (nothing — Vault doesn't appear to have created any state here yet)"
else
  for i in "${!TO_DELETE_PATHS[@]}"; do
    printf "  - %-44s %s\n" "${TO_DELETE_LABELS[$i]}" "${TO_DELETE_PATHS[$i]}"
  done
fi

if [[ ${#SKIPPED_PATHS[@]} -gt 0 ]]; then
  echo
  echo "SKIPPED (overlap with preserved path — safer to leave alone):"
  for i in "${!SKIPPED_PATHS[@]}"; do
    printf "  - %-44s %s\n" "${SKIPPED_LABELS[$i]}" "${SKIPPED_PATHS[$i]}"
    printf "       overlaps with: %s\n" "${SKIPPED_CONFLICTS[$i]}"
  done
fi

echo
echo "PRESERVED (your data — never touched):"
if [[ ${#PRESERVED_PATHS[@]} -eq 0 ]]; then
  echo "  (no user-owned lore folders detected)"
else
  for i in "${!PRESERVED_PATHS[@]}"; do
    printf "  - %-44s %s\n" "${PRESERVED_LABELS[$i]}" "${PRESERVED_PATHS[$i]}"
  done
fi

echo
echo "NOT TOUCHED (still on this machine, your call):"
echo "  - The repo at $REPO_ROOT"
echo "    Delete it yourself when you're sure you don't need it:"
echo "      rm -rf \"$REPO_ROOT\""
echo
echo "  - Small state files inside your preserved lore folder(s):"
echo "      clarifications.json, clarifications.embeddings.json,"
echo "      lore_gaps.json, logs/"
echo "    These were written by Vault but live next to YOUR documents,"
echo "    so the script refuses to reach in. Delete by hand for a total scrub."
echo
echo "CANNOT CLEAN AUTOMATICALLY (live elsewhere — do these yourself):"
echo "  - Your Discord bot registration at"
echo "      https://discord.com/developers/applications"
echo "    Find the app you created for the bot and delete it there."
echo
echo "  - Your LLM provider API keys (still active at the provider):"
echo "      Anthropic:  https://console.anthropic.com/settings/keys"
echo "      Google:     https://aistudio.google.com/app/apikey"
echo "      OpenAI:     https://platform.openai.com/api-keys"
echo "    Revoke any keys you generated for Vault so they can't be reused."
echo
echo "  - Browser state for http://localhost:3000"
echo "    (localStorage / cookies / cached assets). Clear via your"
echo "    browser's site settings for that origin."
echo
echo "  - Ollama itself (if you installed it for the Local LLMs add-on)."
echo "    Vault never installed it — use Ollama's own uninstaller."
echo

if [[ ${#TO_DELETE_PATHS[@]} -eq 0 ]]; then
  echo "Nothing to do. Exiting."
  exit 0
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN — no changes made. Re-run without --dry-run to actually delete."
  exit 0
fi

# ─── acknowledgement prompt (safety net #1) ─────────────────────────────────
# Printed AFTER the plan, BEFORE the final yes prompt. Forces the user to
# explicitly accept the risk and the usage contract. Any input other than
# the exact phrase exits cleanly with no changes.
if [[ $YES -ne 1 ]]; then
  echo
  echo "==============================================================="
  echo "  IMPORTANT — read this before continuing"
  echo "==============================================================="
  echo
  echo "This script permanently deletes the files listed above."
  echo "Deletion is IRREVERSIBLE — there is no trash, no undo."
  echo
  echo "It is SAFE to run, but only if you follow these rules:"
  echo
  echo "  1. Run this script from the root of your Tusk's Vault clone."
  echo "     (You already passed this check, or you wouldn't see this prompt.)"
  echo
  echo "  2. STOP the Vault dev server BEFORE proceeding."
  echo "     Close any run.bat / run.sh window. Press Ctrl+C in any"
  echo "     terminal still running 'npm run dev'."
  echo
  echo "  3. Do NOT modify this script before running it."
  echo "     If you suspect it has been tampered with, abort now and"
  echo "     re-download a clean copy from the official repo:"
  echo "       https://github.com/KochiTusker/Tusks-Vault"
  echo
  echo "  4. Review the WILL DELETE list above carefully."
  echo "     If ANYTHING looks unexpected, abort now."
  echo
  echo "If you follow these rules, the script will only delete:"
  echo "  - Files inside this repo that Vault wrote at runtime."
  echo "  - The per-user 'tusks-vault' state directory."
  echo "Your Tusks-Lore / Lore folders and your campaign documents"
  echo "will NEVER be touched."
  echo
  echo "If you do NOT follow the rules (run from the wrong place, edit"
  echo "the script, bypass the safety guards, or ignore an unexpected"
  echo "entry in the list above), you accept the risk of unintended"
  echo "data loss. The author is not liable in that case."
  echo
  echo "Safer previews + alternative paths:"
  echo "  --dry-run   Show the plan without changing anything."
  echo "  --manual    Print step-by-step manual uninstall instructions"
  echo "              and exit — skip this script entirely if you'd"
  echo "              rather remove every file by hand."
  echo
  echo "Type the exact phrase below to acknowledge and continue:"
  echo "    I understand and accept the risk"
  echo
  echo "Anything else (including pressing Enter or Ctrl+C) exits with"
  echo "NO changes made to your system."
  echo
  read -rp "Your response: " ack
  if [[ "$ack" != "I understand and accept the risk" ]]; then
    echo
    echo "Exited. Your computer is unchanged."
    echo
    exit 0
  fi

  # Second confirmation — separate step so a misplaced 'yes' doesn't trigger
  # deletion. The first acknowledgement was about the contract; this one is
  # about the specific list of paths.
  echo
  echo "Final confirmation. Type 'yes' to delete the items listed above,"
  echo "or anything else (including Enter) to exit without changes."
  echo
  read -rp "Proceed with deletion? " ans
  if [[ "$ans" != "yes" ]]; then
    echo
    echo "Exited. Your computer is unchanged."
    echo
    exit 0
  fi
fi

# ─── perform deletion ───────────────────────────────────────────────────────

echo
failures=0
for i in "${!TO_DELETE_PATHS[@]}"; do
  path="${TO_DELETE_PATHS[$i]}"
  printf "Removing %s... " "$path"
  if ! assert_safe_to_delete "$path"; then
    echo "REFUSED (guard tripped — see above)."
    failures=$((failures + 1))
    continue
  fi
  if rm -rf -- "$path"; then
    echo "done."
  else
    echo "FAILED."
    echo "  (Is the dev server still running? Stop it and re-run this script.)"
    failures=$((failures + 1))
  fi
done

echo
if [[ $failures -eq 0 ]]; then
  echo "Uninstall complete."
else
  echo "Uninstall finished with $failures failure(s) — see above."
fi
echo
echo "Your campaign data is intact at the paths listed under PRESERVED."
if [[ $failures -eq 0 ]]; then
  echo "To remove the repo itself: rm -rf \"$REPO_ROOT\""
fi
echo
echo "Don't forget the off-machine cleanup listed under CANNOT CLEAN AUTOMATICALLY."
echo

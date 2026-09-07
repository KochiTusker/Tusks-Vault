#!/usr/bin/env bash
# Tusk's Vault launcher for macOS and Linux.
# Equivalent to run.bat — checks Node, installs dependencies on first run,
# starts the server, and signals the browser auto-open. Keeps a final pause
# behaviour on error so users can read the message before the terminal closes.

set -o pipefail
cd "$(dirname "$0")"

cleanup_and_exit() {
  EXIT_CODE=$1
  echo ""
  echo " ===================================="
  if [ "$EXIT_CODE" = "0" ]; then
    echo "   Tusk's Vault exited cleanly."
    echo " ===================================="
  else
    echo "   Tusk's Vault exited with error code $EXIT_CODE."
    echo " ===================================="
    echo ""
    echo " Common causes and fixes:"
    echo ""
    echo " 1. PORT CONFLICT: another program is using ports 3000-3019."
    echo "    - Close other dev servers, or pick a different port:"
    echo "      open .env.local and add:  PORT=3500"
    echo ""
    echo " 2. MISSING PACKAGE / OUTDATED DEPENDENCIES: the error says"
    echo "    \"Cannot find package ...\" or \"ERR_MODULE_NOT_FOUND\"."
    echo "    Usually means new code was pulled but npm install never ran."
    echo "    - Force a re-install:"
    echo "        rm node_modules/.tv-lockfile-snapshot && ./run.sh"
    echo "      (the launcher detects the missing snapshot and re-installs)"
    echo "    - Or run directly:  npm install"
    echo ""
    echo " 3. CORRUPTED DEPENDENCIES:"
    echo "    - rm -rf node_modules package-lock.json"
    echo "    - Re-run ./run.sh"
    echo ""
    echo " 4. EMBEDDING MODEL DOWNLOAD FAILED (needs internet on first run):"
    echo "    - rm -rf models"
    echo "    - Re-run ./run.sh"
    echo ""
    echo " If none of these help, open an issue:"
    echo " https://github.com/KochiTusker/Tusks-Vault/issues"
  fi
  if [ -t 1 ]; then
    echo ""
    read -r -p " Press Enter to close this window. " _ || true
  fi
  exit "$EXIT_CODE"
}

cat <<'BANNER'

 ==============================================================

                   T U S K ' S    V A U L T

                                     _____
                                    /     \
                                    I     I
                                    I     I
                   .--.          ___I_____I___
                  /    \         I           I
                 : .--. :        I  .-----.  I
                  \____/         I  I     I  I
                   \  \          I  I  *  I  I
                    \  \         I  '-----'  I
                     \__\        I___________I
                   The Key          The Vault

            Thank you for downloading Tusk's Vault.
              May your lore be forever safe.

 ==============================================================

BANNER

# --- Refuse to run as root --------------------------------------------------
# A sudo'd launch creates root-owned node_modules; later non-sudo updates and
# add-on installs fail with permission-denied. Refuse early.
if [ "$(id -u)" = "0" ] || [ -n "${SUDO_USER:-}" ]; then
  echo " [X] Don't launch Tusk's Vault with sudo."
  echo ""
  echo "     Running as root makes node_modules root-owned, breaking future"
  echo "     updates and add-on installs that run as your normal user."
  echo "     Re-run without sudo:  ./run.sh"
  cleanup_and_exit 1
fi

# --- Pre-flight write check -------------------------------------------------
# Surfaces the read-only-mount / wrong-owner case with a clear remediation
# instead of letting npm fail cryptically further down.
if ! ( : > .tv-write-test ) 2>/dev/null; then
  echo " [X] Can't write to this folder: $(pwd)"
  echo ""
  echo "     Tusk's Vault needs to write node_modules/ here on first boot."
  echo "     Move the folder into your home directory and re-run:"
  echo "         mv \"$(pwd)\" ~/Tusks-Vault && cd ~/Tusks-Vault && ./run.sh"
  cleanup_and_exit 1
fi
rm -f .tv-write-test

# --- Node check ------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo " [X] Node.js is not installed."
  echo " Install from https://nodejs.org/ (or your package manager) and re-run."
  cleanup_and_exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
if [ -z "$NODE_MAJOR" ]; then
  echo " [X] Could not detect Node.js version. Try: node --version"
  cleanup_and_exit 1
fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo " [X] Your Node.js version is too old (v$NODE_MAJOR). Need v20+."
  cleanup_and_exit 1
fi
echo " [.] Node v$NODE_MAJOR detected."

# --- Dependency install: first run OR lockfile changed -------------------
# Snapshot package-lock.json into node_modules/.tv-lockfile-snapshot on
# every successful install. On subsequent boots, a mismatch means a git
# pull / merge / hand-edit changed package-lock.json since the last
# successful install — re-run npm install before launching so the user
# doesn't hit ERR_MODULE_NOT_FOUND on the next line. Migration-safe:
# a missing snapshot triggers a single re-verify install for users
# upgrading from an older launcher.
NEEDS_INSTALL=0
INSTALL_REASON=""
if [ ! -d node_modules ]; then
  NEEDS_INSTALL=1
  INSTALL_REASON="First run. Installing dependencies"
elif [ ! -f node_modules/.tv-lockfile-snapshot ]; then
  NEEDS_INSTALL=1
  INSTALL_REASON="First boot under this launcher. Re-verifying dependencies"
elif ! cmp -s package-lock.json node_modules/.tv-lockfile-snapshot; then
  NEEDS_INSTALL=1
  INSTALL_REASON="package-lock.json changed since last successful install. Updating dependencies"
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
  echo " [.] $INSTALL_REASON (~1 minute)..."
  echo ""
  # On a truly fresh clone (no node_modules) we use `npm ci` — it skips
  # dependency resolution and installs strictly from package-lock.json. That
  # makes the first-run install meaningfully faster AND more reproducible.
  # On a lockfile-changed-during-pull boot we fall back to `npm install` so a
  # merge that legitimately added packages still resolves them.
  #
  # --no-audit / --no-fund keep the output focused on real errors. Users can
  # always run `npm audit` themselves if they want a vuln report.
  if [ ! -d node_modules ]; then
    INSTALL_CMD=(npm ci --no-audit --no-fund)
  else
    INSTALL_CMD=(npm install --no-audit --no-fund)
  fi
  if ! "${INSTALL_CMD[@]}"; then
    echo ""
    echo " [X] Install failed. Scroll up for the error."
    echo "     If it mentions EACCES / permission denied, a previous run as"
    echo "     root may have left root-owned files. Fix with:"
    echo "         sudo chown -R \$USER:\$USER node_modules package-lock.json"
    echo "     Then re-run ./run.sh (without sudo)."
    cleanup_and_exit 1
  fi
  cp package-lock.json node_modules/.tv-lockfile-snapshot
  echo ""
fi

# --- Launch ----------------------------------------------------------------
export TUSKS_VAULT_OPEN_BROWSER=1
if [ ! -f .env.local ]; then
  echo " [i] No .env.local yet. The dashboard will guide you through setup."
  echo ""
fi
echo " [.] Starting Tusk's Vault. Close this window or press Ctrl+C to stop."
echo ""

# Restart loop: the server exits with code 42 when the in-app updater asks for
# a graceful restart (see src/server/util/updater.ts → scheduleRestart). When
# we see that, we re-verify dependencies (the update may have brought in a
# new lockfile) and relaunch. Only the post-update path goes through here;
# regular Ctrl+C or any other exit code falls through to cleanup_and_exit.
while true; do
  TUSKS_VAULT_OPEN_BROWSER=$TUSKS_VAULT_OPEN_BROWSER npm run start
  RUN_CODE=$?

  if [ "$RUN_CODE" != "42" ]; then
    cleanup_and_exit "$RUN_CODE"
  fi

  echo ""
  echo " [.] Graceful restart requested by the in-app updater. Reloading…"
  echo ""

  # Suppress the browser-open call on every relaunch; the user already has the
  # dashboard tab. The server still serves the dashboard at the same URL.
  export TUSKS_VAULT_OPEN_BROWSER=0

  # The update may have changed package-lock.json. Re-verify before relaunch
  # so the new server picks up any new deps. Same logic as the cold-boot path.
  if [ ! -f node_modules/.tv-lockfile-snapshot ] || ! cmp -s package-lock.json node_modules/.tv-lockfile-snapshot; then
    echo " [.] package-lock.json changed during update. Refreshing dependencies…"
    if ! npm install --no-audit --no-fund; then
      echo " [X] Post-update dependency refresh failed. The previous server is"
      echo "     gone; resolve the npm error above and re-launch run.sh manually."
      cleanup_and_exit 1
    fi
    cp package-lock.json node_modules/.tv-lockfile-snapshot
    echo ""
  fi
done

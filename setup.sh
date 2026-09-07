#!/usr/bin/env bash
# Tusk's Vault first-time setup script for macOS and Linux.
# Verifies the runtime prerequisites and installs npm dependencies. Idempotent
# — safe to re-run after a `git pull` to refresh dependencies.
#
# Permission-safe by design: refuses to run with sudo (because root-owned
# node_modules locks the regular user out of future updates) and verifies
# write access to the repo directory before invoking npm.
set -e

cd "$(dirname "$0")"

echo ""
echo " ====================================="
echo "   Tusk's Vault - first-time setup"
echo " ====================================="
echo ""

# --- Don't run as root / via sudo -------------------------------------------
# A `sudo ./setup.sh` creates root-owned node_modules / package-lock.json that
# the regular user can't write to later. Catch and refuse early so users don't
# discover the breakage three weeks later when they try to update.
if [ "$(id -u)" = "0" ] || [ -n "${SUDO_USER:-}" ]; then
  echo " [X] Don't run this script with sudo."
  echo ""
  echo "     Running as root makes node_modules root-owned, so later updates"
  echo "     and add-on installs (run as your regular user) will fail with"
  echo "     'permission denied' errors."
  echo ""
  echo "     Re-run as a normal user:"
  echo "         ./setup.sh"
  echo ""
  echo "     If the npm install genuinely needs to reach a system-protected"
  echo "     path, move the Tusk's Vault folder out of /opt, /usr, or any"
  echo "     other root-owned location into your home directory first."
  exit 1
fi

# --- Pre-flight write check -------------------------------------------------
# Catches the case where the user cloned into a path they can't write to
# (e.g. /opt, /usr/local, a read-only mount). npm install would fail with a
# cryptic EACCES — better to surface it with a clear remediation here.
WRITE_TEST=".tv-write-test"
if ! ( : > "$WRITE_TEST" ) 2>/dev/null; then
  echo " [X] Can't write to this folder: $(pwd)"
  echo ""
  echo "     npm install needs to create node_modules/ here. Most likely:"
  echo "       - The folder is read-only (mounted noexec, NFS without write,"
  echo "         or owned by another user)."
  echo "       - You cloned into a system-protected path like /opt or /usr."
  echo ""
  echo "     Fix: move the Tusk's Vault folder into your home directory:"
  echo "         mv \"$(pwd)\" ~/Tusks-Vault"
  echo "         cd ~/Tusks-Vault && ./setup.sh"
  exit 1
fi
rm -f "$WRITE_TEST"

# --- Node check -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo " [X] Node.js is not installed."
  echo ""
  echo " Tusk's Vault needs Node.js 20 or newer."
  echo " Install from: https://nodejs.org/   (or use your package manager:"
  echo "   macOS:  brew install node"
  echo "   Debian: sudo apt install nodejs npm"
  echo "   Fedora: sudo dnf install nodejs npm"
  echo "   Arch:   sudo pacman -S nodejs npm"
  echo " )"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")
if [ -z "$NODE_MAJOR" ]; then
  echo " [X] Could not detect Node.js version. Is Node installed correctly?"
  exit 1
fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo " [X] Your Node.js version is too old (v$NODE_MAJOR). Need v20+."
  echo "     Upgrade from: https://nodejs.org/"
  exit 1
fi
echo " [.] Node v$NODE_MAJOR detected."

# --- Git check (optional but recommended) -----------------------------------
if ! command -v git >/dev/null 2>&1; then
  echo " [!] Git is not installed. You'll be able to run Tusk's Vault, but the"
  echo "     in-app 'Check for updates' button won't work until you install Git."
else
  echo " [.] Git detected."
fi

# --- npm install ------------------------------------------------------------
# --no-audit --no-fund: quieter output. The audit warnings scare first-time
# users into thinking something broke; if a user wants to audit they can run
# `npm audit` themselves. --no-fund silences the "please fund this package"
# nags. Both flags have zero effect on actual dependency resolution.
if [ -d node_modules ]; then
  echo " [.] node_modules already present. Refreshing dependencies..."
  INSTALL_CMD=(npm install --no-audit --no-fund)
else
  echo " [.] Installing dependencies (first time, ~1 minute)..."
  # `npm ci` on a fresh clone — faster and stricter than `npm install`
  # because it skips resolution and uses package-lock.json verbatim.
  INSTALL_CMD=(npm ci --no-audit --no-fund)
fi
echo ""
if ! "${INSTALL_CMD[@]}"; then
  echo ""
  echo " [X] npm install failed."
  echo ""
  # Heuristic remediation based on the most common Linux/macOS failure modes.
  echo " Common causes:"
  echo "   - PERMISSION DENIED on node_modules: a previous run as root left"
  echo "     root-owned files. Fix:"
  echo "         sudo chown -R \$USER:\$USER node_modules package-lock.json"
  echo "     Then re-run ./setup.sh (without sudo)."
  echo "   - DISK FULL: check 'df -h .' has space."
  echo "   - NETWORK / REGISTRY UNREACHABLE: corporate firewall or VPN may be"
  echo "     blocking https://registry.npmjs.org/. Try 'npm ping'."
  exit 1
fi

echo ""
echo " ====================================="
echo "   Setup complete."
echo " ====================================="
echo ""
echo " Next steps:"
echo "   1. Run ./run.sh to start Tusk's Vault."
echo "   2. The dashboard auto-opens in your browser."
echo "   3. Add your LLM API key from the Settings page."
echo ""

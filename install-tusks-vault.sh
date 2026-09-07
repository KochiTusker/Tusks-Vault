#!/usr/bin/env bash
# ===========================================================================
#  Tusk's Vault - one-file installer for macOS and Linux
# ===========================================================================
#
#  The macOS/Linux twin of install-tusks-vault.bat, and deliberately the same
#  shape. After it finishes, the only thing the user ever needs again is
#  ./run.sh.
#
#  Design rules, in priority order:
#
#  1. NOTHING HAPPENS BEFORE THE USER HAS SEEN THE FULL PLAN. Every install
#     location, every download, and every system-wide change is printed and
#     confirmed once, up front. A user who declines has changed nothing.
#
#  2. It CLONES rather than downloading a tarball. The in-app updater runs
#     `git pull --ff-only`, so an archive install would produce a Vault that
#     can never update itself.
#
#  3. It reuses setup.sh for dependency installation instead of copying it.
#     That script already handles the failure modes worth explaining.
#
#  Usage:  bash install-tusks-vault.sh
# ===========================================================================

set -u

REPO_URL="https://github.com/KochiTusker/Tusks-Vault.git"
DEFAULT_DIR="$HOME/Tusks-Vault"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(uname -s)" = "Darwin" ]; then
  CONFIG_DIR="$HOME/Library/Preferences/tusks-vault/Config"
else
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tusks-vault/Config"
fi

echo
echo " =========================================="
echo "   Tusk's Vault - installer"
echo " =========================================="
echo

# --- Already inside a clone? -------------------------------------------------
if [ -f "$SCRIPT_DIR/package.json" ] && [ -f "$SCRIPT_DIR/server.ts" ]; then
  echo " [i] You are already inside a Tusk's Vault folder."
  echo "     To start it, run ./run.sh from here instead."
  echo
  exit 0
fi

# --- Refuse to run as root ---------------------------------------------------
# A root-owned clone and node_modules locks the regular user out of every
# future update - the same trap setup.sh already guards against.
if [ "$(id -u)" -eq 0 ]; then
  echo " [X] Don't run this with sudo."
  echo "     It would create a root-owned install that your normal user cannot"
  echo "     update. Run it as yourself."
  echo
  exit 1
fi

# --- What is already here? ---------------------------------------------------
NEED_GIT=1
NEED_NODE=1
NODE_MAJOR=""

command -v git >/dev/null 2>&1 && NEED_GIT=""
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")"
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then NEED_NODE=""; fi
fi

# --- Prerequisite guidance ---------------------------------------------------
# Named per platform and printed rather than executed. On macOS we offer to run
# brew because it is a per-user package manager the user already opted into; on
# Linux the right command varies per distribution, so we name it and stop.
install_prereq() {
  friendly="$1"
  pkg="$2"
  url="$3"

  echo
  echo " [.] Installing $friendly ..."
  echo

  if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    # Shown, then confirmed, then run — the plan above promises exactly this,
    # and a system-wide change is worth a second look even after that consent.
    echo "     This installer can run:"
    echo
    echo "         brew install $pkg"
    echo
    printf "  Run that now? [Y/n]: "
    read -r reply
    case "$reply" in
      [Nn]*)
        echo
        echo "     No problem. Install $friendly from: $url"
        echo "     Then run this installer again."
        echo
        exit 1
        ;;
    esac
    echo
    if brew install "$pkg"; then
      echo
      echo " [.] $friendly installed."
      return 0
    fi
    echo
    echo " [X] Installing $friendly did not complete."
  else
    case "$(uname -s)" in
      Linux)
        echo "     Install it with your package manager, for example:"
        echo "       Debian/Ubuntu:  sudo apt install $pkg"
        echo "       Fedora:         sudo dnf install $pkg"
        echo "       Arch:           sudo pacman -S $pkg"
        ;;
      *)
        echo "     Install it from: $url"
        ;;
    esac
  fi

  echo
  echo "     Or download it from: $url"
  echo "     Then run this installer again."
  echo
  exit 1
}

# --- Where should it go? -----------------------------------------------------
# macOS gets a native folder chooser; elsewhere typing a path is the only
# portable option, so the menu adapts rather than offering a dead entry.
choose_location() {
  while true; do
    echo " Where should Tusk's Vault be installed?"
    echo
    echo "    [1] $DEFAULT_DIR"
    echo "        (recommended)"
    if [ "$(uname -s)" = "Darwin" ]; then
      echo "    [2] Browse for a folder..."
    fi
    echo "    [3] Type a path"
    echo "    [Q] Quit"
    echo
    printf "  Choose [1]: "
    read -r choice
    [ -z "$choice" ] && choice=1

    case "$choice" in
      [Qq]*) exit 0 ;;
      1) TARGET="$DEFAULT_DIR"; return ;;
      2)
        if [ "$(uname -s)" != "Darwin" ]; then
          echo; echo " [i] Pick 1, 3 or Q."; echo; continue
        fi
        picked="$(osascript -e 'try' -e 'POSIX path of (choose folder with prompt "Choose a folder to install Tusk'"'"'s Vault into")' -e 'end try' 2>/dev/null)"
        if [ -z "$picked" ]; then
          echo; echo " [i] Nothing chosen."; echo; continue
        fi
        TARGET="${picked%/}/Tusks-Vault"
        return
        ;;
      3)
        printf "  Full path: "
        read -r typed
        if [ -z "$typed" ]; then echo; continue; fi
        # Expand a leading ~ by hand: read does not do it for us.
        case "$typed" in "~"*) typed="$HOME${typed#\~}" ;; esac
        TARGET="$typed"
        return
        ;;
      *) echo; echo " [i] Pick 1, 3 or Q."; echo ;;
    esac
  done
}

REUSE_EXISTING=""

while true; do
  choose_location
  TARGET="${TARGET%/}"

  case "$TARGET" in
    /usr/*|/opt/*|/bin/*|/sbin/*|/System/*|/Library/*)
      echo
      echo " [X] That is a system folder. npm cannot write there without root,"
      echo "     and Vault does not need root. Pick somewhere under your home"
      echo "     folder instead."
      echo
      continue
      ;;
  esac

  if [ -f "$TARGET/package.json" ] && [ -f "$TARGET/server.ts" ]; then
    echo
    echo " [i] Tusk's Vault is already installed there."
    echo
    printf "  Start the existing install? [Y/n]: "
    read -r reuse
    case "$reuse" in [Nn]*) echo; continue ;; esac
    REUSE_EXISTING=1
    break
  fi

  if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
    echo
    echo " [X] That folder already exists and is not empty. Choose an empty or"
    echo "     new folder so nothing of yours is overwritten."
    echo
    continue
  fi

  break
done

if [ -z "$REUSE_EXISTING" ]; then
  # ---------------------------------------------------------------------------
  #  Show the whole plan, then ask once
  # ---------------------------------------------------------------------------
  echo
  echo " =========================================="
  echo "   What this will do"
  echo " =========================================="
  echo
  echo "  Tusk's Vault will be installed to:"
  echo "    $TARGET"
  echo
  echo "  Downloaded into that folder:"
  echo "    - The Tusk's Vault program files       (a few MB, from GitHub)"
  echo "    - node_modules/                        (~200 MB of libraries)"
  echo "    - models/                              (~25 MB, on first start - the"
  echo "                                            offline text-matching model)"
  echo
  echo "  Saved outside that folder:"
  echo "    - $CONFIG_DIR"
  echo "      (your settings and your encrypted API keys)"
  echo

  if [ -n "$NEED_NODE" ] || [ -n "$NEED_GIT" ]; then
    echo "  Also installed, because it is missing:"
    [ -n "$NEED_NODE" ] && echo "    - Node.js (LTS)"
    [ -n "$NEED_GIT" ]  && echo "    - Git"
    echo "    You will be shown the command and asked before anything runs."
  else
    echo "  Node.js v$NODE_MAJOR and Git are already installed - nothing"
    echo "  system-wide will be changed."
  fi

  echo
  echo "  Not done: nothing is installed globally by npm, no service is"
  echo "  registered, and no data leaves your machine during setup."
  echo
  echo "  To remove it later: delete the folder above, and the settings folder."
  echo
  printf "  Continue? [Y/n]: "
  read -r go
  case "$go" in
    [Nn]*)
      echo
      echo " Nothing has been changed."
      echo
      exit 0
      ;;
  esac

  # --- Prerequisites ---------------------------------------------------------
  [ -n "$NEED_GIT" ]  && install_prereq "Git" "git" "https://git-scm.com/"
  [ -n "$NEED_NODE" ] && install_prereq "Node.js" "node" "https://nodejs.org/"

  # Re-verify rather than trust the package manager's exit code.
  command -v git >/dev/null 2>&1 || { echo; echo " [X] Git is still not available. Open a new terminal and run this installer again."; echo; exit 1; }
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "")"
  if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
    echo
    echo " [X] Node.js 20 or newer is still not available. Open a new terminal"
    echo "     and run this installer again."
    echo
    exit 1
  fi
  echo
  echo " [.] Node v$NODE_MAJOR and Git are ready."

  # --- Download --------------------------------------------------------------
  echo
  echo " [.] Downloading Tusk's Vault into $TARGET ..."
  echo
  if ! git clone "$REPO_URL" "$TARGET"; then
    echo
    echo " [X] Download failed. The usual causes are no internet connection, or"
    echo "     a network blocking github.com."
    echo
    exit 1
  fi

  # `git clone` reports success for a repository with no commits, which leaves a
  # folder containing nothing but .git. Verify the files we are about to depend
  # on actually arrived, so the failure is named here rather than surfacing as
  # "setup.sh: No such file or directory" two steps later.
  if [ ! -f "$TARGET/run.sh" ]; then
    echo
    echo " [X] The download completed but arrived empty - the repository has no"
    echo "     published release yet."
    echo
    echo "     Nothing was installed. Check for a release at:"
    echo "       https://github.com/KochiTusker/Tusks-Vault"
    echo
    rm -rf "$TARGET"
    exit 1
  fi

  # --- Dependencies, via the repo's own first-time setup ---------------------
  echo
  echo " [.] Installing dependencies. This takes about a minute."
  echo
  chmod +x "$TARGET/setup.sh" "$TARGET/run.sh" 2>/dev/null || true
  if ! (cd "$TARGET" && ./setup.sh); then
    echo
    echo " [X] Dependency installation did not finish. The messages above say"
    echo "     why. Fix the cause, then run ./setup.sh in:"
    echo "       $TARGET"
    echo
    exit 1
  fi

  # --- What just happened ----------------------------------------------------
  echo
  echo " =========================================="
  echo "   Installed"
  echo " =========================================="
  echo
  echo "  Program:   $TARGET"
  echo "  Settings:  $CONFIG_DIR"
  echo
  echo "  To start Tusk's Vault from now on:"
  echo "    cd \"$TARGET\" && ./run.sh"
  echo
  echo "  It opens at http://localhost:3000 in your browser."
  echo
  echo "  For the Foundry module: start Vault, then in Foundry go to"
  echo "  Settings -> Game Settings -> Module Settings -> Tusk's Vault -> Connect."
  echo
  printf "  Start it now? [Y/n]: "
  read -r start_now
  case "$start_now" in [Nn]*) echo; exit 0 ;; esac
fi

echo
echo " [.] Starting Tusk's Vault. Your browser will open by itself."
echo
cd "$TARGET" || exit 1
chmod +x ./run.sh 2>/dev/null || true
exec ./run.sh

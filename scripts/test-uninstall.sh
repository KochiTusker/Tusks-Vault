#!/usr/bin/env bash
# Thorough automated test harness for uninstall.ps1 and uninstall.sh.
#
# Builds fake Vault clones in /tmp, runs the uninstallers against them with
# scripted input (including the acknowledgement prompt), and asserts the
# expected outcomes. NEVER touches the real Vault install or your home dir.
#
# Run from anywhere:  bash scripts/test-uninstall.sh
#
# Exits 0 if every test passes, non-zero if any fail. Each test prints
#   [PASS] / [FAIL] <description>
# so you can scan the output quickly.

set -uo pipefail

# Resolve the repo root (where uninstall.{ps1,sh} live).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PS1_PATH="$REPO_ROOT/uninstall.ps1"
SH_PATH="$REPO_ROOT/uninstall.sh"

# Test sandbox under /tmp — every fixture lands inside this dir so we can
# wipe it without affecting anything else.
SANDBOX="$(mktemp -d -t vault-uninstall-test-XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

# Pretty-print a test result.
report() {
  local outcome="$1"; shift
  local desc="$*"
  if [[ "$outcome" == "PASS" ]]; then
    echo "[PASS] $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] $desc"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_DETAILS+=("$desc")
  fi
}

# Build a realistic fake Vault clone at the given path. Mimics what a user
# would have on disk after running `git clone && npm install && npm run dev`
# for a while.
make_fake_vault() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/package.json" <<EOF
{ "name": "tusks-vault", "version": "0.1.0" }
EOF
  echo "// fake server.ts" > "$dir/server.ts"
  mkdir -p "$dir/node_modules/some-pkg"
  echo "fake dep" > "$dir/node_modules/some-pkg/index.js"
  mkdir -p "$dir/models"
  echo "fake model" > "$dir/models/minilm.bin"
  echo "fake keys" > "$dir/api-keys.json"
  echo "{}" > "$dir/settings.json"
  echo "DISCORD_TOKEN=fake" > "$dir/.env.local"
  echo "fake log" > "$dir/run.log"
  mkdir -p "$dir/dist"
  echo "fake dist" > "$dir/dist/index.html"
  echo "3000" > "$dir/.port-runtime"
  # Copy the real uninstall scripts in.
  cp "$PS1_PATH" "$dir/uninstall.ps1"
  cp "$SH_PATH" "$dir/uninstall.sh"
  chmod +x "$dir/uninstall.sh"
}

# Build a fake Lore/ folder with user-authored content inside the repo to
# verify the preserve logic keeps it.
make_fake_lore() {
  local dir="$1"
  mkdir -p "$dir/Lore"
  echo "Player's homebrew notes — must not be deleted" > "$dir/Lore/notes.md"
  mkdir -p "$dir/Lore/Sessions"
  echo "Session 1 chronicle" > "$dir/Lore/Sessions/session-01.md"
}

# Build a sibling Tusks-Lore folder next to the repo.
make_fake_sibling_lore() {
  local repo_dir="$1"
  local parent
  parent="$(dirname "$repo_dir")"
  mkdir -p "$parent/Tusks-Lore"
  echo "Campaign documents - must not be deleted" > "$parent/Tusks-Lore/lore.md"
}

# Run the bash uninstaller in a sub-shell with a controlled HOME so the
# env-paths resolution targets a sandbox dir, not the user's real home.
run_sh_uninstall() {
  local cwd="$1"
  shift
  local stdin_data="$1"
  shift
  local fake_home="$SANDBOX/home"
  mkdir -p "$fake_home/.local/share" "$fake_home/.config" "$fake_home/.cache" "$fake_home/.local/state"
  # Drop a fake per-user state to exercise the env-paths cleanup path.
  mkdir -p "$fake_home/.local/share/tusks-vault"
  echo "{}" > "$fake_home/.local/share/tusks-vault/personas.user.json"
  (
    cd "$cwd"
    HOME="$fake_home" \
      XDG_DATA_HOME="$fake_home/.local/share" \
      XDG_CONFIG_HOME="$fake_home/.config" \
      XDG_CACHE_HOME="$fake_home/.cache" \
      XDG_STATE_HOME="$fake_home/.local/state" \
      TMPDIR="$SANDBOX/tmp" \
      bash "$cwd/uninstall.sh" "$@" <<< "$stdin_data" 2>&1
  )
}

# ─── T1: Guard A — script outside a Vault repo refuses ────────────────────
test_guard_a_outside_repo() {
  local d="$SANDBOX/t1-outside"
  mkdir -p "$d"
  cp "$SH_PATH" "$d/uninstall.sh"
  chmod +x "$d/uninstall.sh"
  local out exit_code
  out=$(bash "$d/uninstall.sh" --dry-run 2>&1)
  exit_code=$?
  if [[ $exit_code -eq 2 ]] && [[ "$out" == *"doesn't look like a Tusk's Vault clone"* ]]; then
    report PASS "T1: refuses to run outside a Vault clone (exit 2 + clear error)"
  else
    report FAIL "T1: should have refused; got exit=$exit_code, output: $out"
  fi
}

# ─── T2: Guard A — wrong package.json name refuses ────────────────────────
test_guard_a_wrong_name() {
  local d="$SANDBOX/t2-wrongname"
  mkdir -p "$d"
  echo '{ "name": "evil-project" }' > "$d/package.json"
  echo "// stub" > "$d/server.ts"
  cp "$SH_PATH" "$d/uninstall.sh"
  chmod +x "$d/uninstall.sh"
  local out exit_code
  out=$(bash "$d/uninstall.sh" --dry-run 2>&1)
  exit_code=$?
  if [[ $exit_code -eq 2 ]] && [[ "$out" == *"name is 'evil-project'"* ]]; then
    report PASS "T2: refuses when package.json name is not 'tusks-vault'"
  else
    report FAIL "T2: should have refused on wrong name; exit=$exit_code, output: $out"
  fi
}

# ─── T3: Guard A — missing server.ts refuses ──────────────────────────────
test_guard_a_no_server() {
  local d="$SANDBOX/t3-noserver"
  mkdir -p "$d"
  echo '{ "name": "tusks-vault" }' > "$d/package.json"
  cp "$SH_PATH" "$d/uninstall.sh"
  chmod +x "$d/uninstall.sh"
  local out exit_code
  out=$(bash "$d/uninstall.sh" --dry-run 2>&1)
  exit_code=$?
  if [[ $exit_code -eq 2 ]] && [[ "$out" == *"server.ts"* ]]; then
    report PASS "T3: refuses when server.ts is missing (mentions the file)"
  else
    report FAIL "T3: should have refused on missing server.ts; exit=$exit_code"
  fi
}

# ─── T4: in-repo dry-run shows expected paths ─────────────────────────────
test_dry_run_in_repo() {
  local d="$SANDBOX/t4-real"
  make_fake_vault "$d"
  local out
  out=$(run_sh_uninstall "$d" "" --dry-run)
  local ok=1
  for needle in "node_modules" "models" "api-keys.json" "settings.json" ".env.local" "run.log" "dist" "DRY RUN"; do
    if [[ "$out" != *"$needle"* ]]; then
      ok=0
      report FAIL "T4: dry-run output missing expected '$needle'"
      break
    fi
  done
  # Verify nothing was actually deleted.
  for f in node_modules models api-keys.json settings.json .env.local run.log dist .port-runtime; do
    if [[ ! -e "$d/$f" ]]; then
      ok=0
      report FAIL "T4: dry-run deleted $f (it should not have)"
      break
    fi
  done
  [[ $ok -eq 1 ]] && report PASS "T4: dry-run lists expected paths, deletes nothing"
}

# ─── T5: empty Vault (no runtime state) — Nothing to do ───────────────────
test_empty_vault() {
  local d="$SANDBOX/t5-empty"
  mkdir -p "$d"
  echo '{ "name": "tusks-vault" }' > "$d/package.json"
  echo "// stub" > "$d/server.ts"
  cp "$SH_PATH" "$d/uninstall.sh"
  chmod +x "$d/uninstall.sh"
  # Use an EMPTY fake home so no per-user state exists either.
  local empty_home="$SANDBOX/t5-home-empty"
  mkdir -p "$empty_home"
  local out exit_code
  out=$(cd "$d" && HOME="$empty_home" XDG_DATA_HOME="$empty_home/.local/share" \
        XDG_CONFIG_HOME="$empty_home/.config" XDG_CACHE_HOME="$empty_home/.cache" \
        XDG_STATE_HOME="$empty_home/.local/state" TMPDIR="$SANDBOX/empty-tmp" \
        bash uninstall.sh --dry-run 2>&1)
  exit_code=$?
  if [[ $exit_code -eq 0 ]] && [[ "$out" == *"Nothing to do"* ]]; then
    report PASS "T5: empty Vault prints 'Nothing to do' and exits 0"
  else
    report FAIL "T5: empty Vault should print 'Nothing to do'; got exit=$exit_code"
  fi
}

# ─── T6: Lore folder shows in PRESERVED ───────────────────────────────────
test_preserves_lore() {
  local d="$SANDBOX/t6-lore"
  make_fake_vault "$d"
  make_fake_lore "$d"
  local out
  out=$(run_sh_uninstall "$d" "" --dry-run)
  if [[ "$out" == *"PRESERVED"* ]] && [[ "$out" == *"Lore/ folder"* ]]; then
    report PASS "T6: in-repo Lore/ folder appears under PRESERVED"
  else
    report FAIL "T6: Lore/ folder should appear under PRESERVED"
  fi
}

# ─── T7: sibling Tusks-Lore preserved ─────────────────────────────────────
test_preserves_sibling_lore() {
  local d="$SANDBOX/t7-sibling/Tusks-Vault"
  make_fake_vault "$d"
  make_fake_sibling_lore "$d"
  local out
  out=$(run_sh_uninstall "$d" "" --dry-run)
  if [[ "$out" == *"Tusks-Lore (campaign data)"* ]]; then
    report PASS "T7: sibling Tusks-Lore appears under PRESERVED"
  else
    report FAIL "T7: sibling Tusks-Lore should appear under PRESERVED"
  fi
}

# ─── T8: custom loreFolderPath inside repo triggers SKIPPED ───────────────
test_custom_lore_in_repo() {
  local d="$SANDBOX/t8-custom-in-repo"
  make_fake_vault "$d"
  # Point loreFolderPath at the dist/ dir (inside the repo).
  cat > "$d/settings.json" <<EOF
{ "loreFolderPath": "$d/dist" }
EOF
  local out
  out=$(run_sh_uninstall "$d" "" --dry-run)
  if [[ "$out" == *"SKIPPED"* ]] && [[ "$out" == *"overlap with preserved"* ]]; then
    report PASS "T8: custom loreFolderPath inside repo triggers SKIPPED block"
  else
    report FAIL "T8: SKIPPED block missing when loreFolderPath overlaps a delete target"
  fi
}

# ─── T9: custom loreFolderPath outside repo preserves but doesn't skip ────
test_custom_lore_outside_repo() {
  local d="$SANDBOX/t9-custom-outside/Tusks-Vault"
  local externLore="$SANDBOX/t9-custom-outside/my-lore"
  make_fake_vault "$d"
  mkdir -p "$externLore"
  echo "external lore" > "$externLore/lore.md"
  cat > "$d/settings.json" <<EOF
{ "loreFolderPath": "$externLore" }
EOF
  local out
  out=$(run_sh_uninstall "$d" "" --dry-run)
  if [[ "$out" == *"Custom lore folder (from settings.json)"* ]]; then
    report PASS "T9: external loreFolderPath appears under PRESERVED"
  else
    report FAIL "T9: external loreFolderPath should appear under PRESERVED"
  fi
}

# ─── T10: acknowledgement prompt — wrong phrase exits cleanly ─────────────
test_ack_wrong_phrase_exits() {
  local d="$SANDBOX/t10-ack-wrong"
  make_fake_vault "$d"
  local out exit_code
  out=$(run_sh_uninstall "$d" "yes")
  exit_code=$?
  if [[ $exit_code -eq 0 ]] && [[ "$out" == *"Your computer is unchanged"* ]]; then
    # Verify nothing was actually deleted.
    if [[ -d "$d/node_modules" ]] && [[ -f "$d/api-keys.json" ]]; then
      report PASS "T10: wrong acknowledgement phrase exits cleanly, no files deleted"
    else
      report FAIL "T10: wrong acknowledgement exited 0 but files WERE deleted"
    fi
  else
    report FAIL "T10: should exit 0 with 'Your computer is unchanged'; got exit=$exit_code"
  fi
}

# ─── T11: empty input at acknowledgement exits cleanly ────────────────────
test_ack_empty_exits() {
  local d="$SANDBOX/t11-ack-empty"
  make_fake_vault "$d"
  local out exit_code
  out=$(run_sh_uninstall "$d" "")
  exit_code=$?
  if [[ $exit_code -eq 0 ]] && [[ "$out" == *"Your computer is unchanged"* ]] && [[ -d "$d/node_modules" ]]; then
    report PASS "T11: empty input at acknowledgement exits cleanly, no deletion"
  else
    report FAIL "T11: empty input should abort cleanly; exit=$exit_code, files exist? $([[ -d $d/node_modules ]] && echo yes || echo NO)"
  fi
}

# ─── T12: acknowledged but 'no' at final yes prompt exits cleanly ─────────
test_final_no_exits() {
  local d="$SANDBOX/t12-final-no"
  make_fake_vault "$d"
  local out exit_code
  out=$(run_sh_uninstall "$d" $'I understand and accept the risk\nno')
  exit_code=$?
  if [[ $exit_code -eq 0 ]] && [[ "$out" == *"Your computer is unchanged"* ]] && [[ -d "$d/node_modules" ]]; then
    report PASS "T12: 'no' at final prompt exits cleanly, no files deleted"
  else
    report FAIL "T12: 'no' at final prompt should abort; exit=$exit_code"
  fi
}

# ─── T13: full happy path — both prompts accepted, files actually go ──────
test_full_deletion_happy_path() {
  local d="$SANDBOX/t13-happy"
  make_fake_vault "$d"
  make_fake_lore "$d"
  make_fake_sibling_lore "$d"
  local out exit_code
  out=$(run_sh_uninstall "$d" $'I understand and accept the risk\nyes')
  exit_code=$?
  local errors=()
  # Should-be-deleted things:
  [[ -e "$d/node_modules" ]]   && errors+=("node_modules survived")
  [[ -e "$d/models" ]]         && errors+=("models survived")
  [[ -e "$d/api-keys.json" ]]  && errors+=("api-keys.json survived")
  [[ -e "$d/settings.json" ]]  && errors+=("settings.json survived")
  [[ -e "$d/.env.local" ]]     && errors+=(".env.local survived")
  [[ -e "$d/run.log" ]]        && errors+=("run.log survived")
  [[ -e "$d/dist" ]]           && errors+=("dist survived")
  [[ -e "$d/.port-runtime" ]]  && errors+=(".port-runtime survived")
  # Must-be-preserved things:
  [[ ! -e "$d/Lore" ]]                                   && errors+=("Lore/ deleted!")
  [[ ! -e "$d/Lore/notes.md" ]]                          && errors+=("Lore/notes.md deleted!")
  [[ ! -e "$(dirname "$d")/Tusks-Lore" ]]                && errors+=("sibling Tusks-Lore deleted!")
  [[ ! -e "$(dirname "$d")/Tusks-Lore/lore.md" ]]        && errors+=("Tusks-Lore content deleted!")
  # Repo source files (untouched by uninstall):
  [[ ! -e "$d/package.json" ]]                           && errors+=("package.json deleted!")
  [[ ! -e "$d/server.ts" ]]                              && errors+=("server.ts deleted!")
  [[ ! -e "$d/uninstall.sh" ]]                           && errors+=("uninstall.sh deleted itself!")

  if [[ ${#errors[@]} -eq 0 ]] && [[ $exit_code -eq 0 ]]; then
    report PASS "T13: full happy path deletes exactly Vault state, preserves lore + repo source"
  else
    report FAIL "T13: happy path issues: ${errors[*]} (exit=$exit_code)"
  fi
}

# ─── T14: TUSKS_VAULT_CONFIG_DIR override is honoured ─────────────────────
test_config_dir_override() {
  local d="$SANDBOX/t14-override"
  make_fake_vault "$d"
  local override_root="$SANDBOX/t14-override-data/tusks-vault/config"
  mkdir -p "$override_root"
  echo "{}" > "$override_root/keys.enc"
  local out
  out=$(cd "$d" && TUSKS_VAULT_CONFIG_DIR="$override_root" bash uninstall.sh --dry-run 2>&1)
  if [[ "$out" == *"$SANDBOX/t14-override-data/tusks-vault"* ]] || [[ "$out" == *"$override_root"* ]]; then
    report PASS "T14: TUSKS_VAULT_CONFIG_DIR override appears in deletion plan"
  else
    report FAIL "T14: env override not honoured. Output: $out"
  fi
}

# ─── T15: deleting already-missing paths is graceful ──────────────────────
test_idempotent_run() {
  local d="$SANDBOX/t15-idempotent"
  make_fake_vault "$d"
  local out1 out2 exit2
  out1=$(run_sh_uninstall "$d" $'I understand and accept the risk\nyes')
  # Second run should print "Nothing to do" — everything's already gone.
  # Need a fresh empty home for the second run since the first one wiped the
  # fake user dir.
  local empty_home="$SANDBOX/t15-home-empty"
  mkdir -p "$empty_home"
  out2=$(cd "$d" && HOME="$empty_home" XDG_DATA_HOME="$empty_home/.local/share" \
         XDG_CONFIG_HOME="$empty_home/.config" XDG_CACHE_HOME="$empty_home/.cache" \
         XDG_STATE_HOME="$empty_home/.local/state" TMPDIR="$SANDBOX/t15-tmp" \
         bash uninstall.sh --dry-run 2>&1)
  exit2=$?
  if [[ $exit2 -eq 0 ]] && [[ "$out2" == *"Nothing to do"* ]]; then
    report PASS "T15: re-run after deletion is graceful ('Nothing to do')"
  else
    report FAIL "T15: re-run should be a no-op; got exit=$exit2"
  fi
}

# ─── T17a: --manual flag prints all 7 steps from inside a repo ───────────
test_manual_flag_inside_repo() {
  local d="$SANDBOX/t17a-manual-inside"
  make_fake_vault "$d"
  local out exit_code
  out=$(bash "$d/uninstall.sh" --manual 2>&1)
  exit_code=$?
  # Must succeed (exit 0), print all 7 STEP markers, and NOT have touched any
  # files (manual mode is informational only).
  local step_count
  step_count=$(echo "$out" | grep -c "^STEP")
  if [[ $exit_code -eq 0 ]] && [[ $step_count -eq 7 ]] && [[ -e "$d/node_modules" ]]; then
    report PASS "T17a: --manual from inside repo prints 7 steps, deletes nothing"
  else
    report FAIL "T17a: --manual unexpected: exit=$exit_code, steps=$step_count, files exist=$([[ -e $d/node_modules ]] && echo yes || echo NO)"
  fi
}

# ─── T17b: --manual flag works from OUTSIDE any Vault clone ───────────────
# Critical property: Guard A should be bypassed when --manual is set, so a
# user who has already deleted the repo (or never had one) can still get the
# instructions.
test_manual_flag_outside_repo() {
  local d="$SANDBOX/t17b-manual-outside"
  mkdir -p "$d"
  cp "$SH_PATH" "$d/uninstall.sh"
  chmod +x "$d/uninstall.sh"
  local out exit_code
  out=$(bash "$d/uninstall.sh" --manual 2>&1)
  exit_code=$?
  local step_count
  step_count=$(echo "$out" | grep -c "^STEP")
  if [[ $exit_code -eq 0 ]] && [[ $step_count -eq 7 ]]; then
    report PASS "T17b: --manual works outside any Vault clone (bypasses Guard A)"
  else
    report FAIL "T17b: --manual from outside repo unexpected: exit=$exit_code, steps=$step_count"
  fi
}

# ─── PowerShell tests ─────────────────────────────────────────────────────
# Mirror a subset of the bash tests for the .ps1 implementation. Only runs
# when `powershell` is on PATH (i.e. on Windows or with PS Core installed).
PS_AVAILABLE=0
if command -v powershell.exe >/dev/null 2>&1; then
  PS_AVAILABLE=1
  PS_CMD="powershell.exe"
elif command -v powershell >/dev/null 2>&1; then
  PS_AVAILABLE=1
  PS_CMD="powershell"
elif command -v pwsh >/dev/null 2>&1; then
  PS_AVAILABLE=1
  PS_CMD="pwsh"
fi

# Convert /tmp/x to Windows form when running PS on Windows.
winpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi
}

# Run the PS uninstaller and capture output. Stdin data is piped in for
# the acknowledgement + final-yes prompts.
run_ps_uninstall() {
  local cwd_unix="$1"; shift
  local stdin_data="$1"; shift
  local cwd_win
  cwd_win="$(winpath "$cwd_unix")"
  echo "$stdin_data" | "$PS_CMD" -NoProfile -ExecutionPolicy Bypass \
    -Command "Set-Location -LiteralPath '$cwd_win'; & '$cwd_win\\uninstall.ps1' $*" 2>&1
}

# ─── T17 (PS): Guard A — outside repo refuses ─────────────────────────────
test_ps_guard_a_outside() {
  [[ $PS_AVAILABLE -ne 1 ]] && return 0
  local d="$SANDBOX/t17-ps-outside"
  mkdir -p "$d"
  cp "$PS1_PATH" "$d/uninstall.ps1"
  local out exit_code
  out=$(run_ps_uninstall "$d" "" -DryRun)
  exit_code=$?
  if [[ "$out" == *"doesn't look like a Tusk's Vault clone"* ]]; then
    report PASS "T17 (PS): refuses to run outside a Vault clone"
  else
    report FAIL "T17 (PS): should have refused. Output: $out"
  fi
}

# ─── T18 (PS): in-repo dry-run lists expected paths ───────────────────────
test_ps_dry_run() {
  [[ $PS_AVAILABLE -ne 1 ]] && return 0
  local d="$SANDBOX/t18-ps-dryrun"
  make_fake_vault "$d"
  local out
  out=$(run_ps_uninstall "$d" "" -DryRun)
  local ok=1
  for needle in "node_modules" "models" "api-keys.json" "DRY RUN"; do
    if [[ "$out" != *"$needle"* ]]; then
      ok=0
      report FAIL "T18 (PS): dry-run missing expected '$needle'"
      break
    fi
  done
  for f in node_modules models api-keys.json settings.json; do
    if [[ ! -e "$d/$f" ]]; then
      ok=0
      report FAIL "T18 (PS): dry-run deleted $f"
      break
    fi
  done
  [[ $ok -eq 1 ]] && report PASS "T18 (PS): dry-run lists expected paths, deletes nothing"
}

# ─── T19 (PS): wrong acknowledgement phrase exits cleanly ─────────────────
test_ps_ack_wrong() {
  [[ $PS_AVAILABLE -ne 1 ]] && return 0
  local d="$SANDBOX/t19-ps-ack-wrong"
  make_fake_vault "$d"
  local out
  out=$(run_ps_uninstall "$d" "yes")
  if [[ "$out" == *"Your computer is unchanged"* ]] && [[ -d "$d/node_modules" ]]; then
    report PASS "T19 (PS): wrong acknowledgement exits cleanly, no deletion"
  else
    report FAIL "T19 (PS): wrong acknowledgement should abort. Files still present? $([[ -d $d/node_modules ]] && echo yes || echo NO)"
  fi
}

# ─── T20 (PS): full happy path deletes Vault state, preserves Lore ────────
test_ps_manual_flag() {
  [[ $PS_AVAILABLE -ne 1 ]] && return 0
  # Test from outside any repo to also verify Guard A bypass.
  local d="$SANDBOX/t-ps-manual"
  mkdir -p "$d"
  cp "$PS1_PATH" "$d/uninstall.ps1"
  local out
  out=$(run_ps_uninstall "$d" "" -Manual)
  local step_count
  step_count=$(echo "$out" | grep -c "^STEP")
  if [[ $step_count -eq 7 ]]; then
    report PASS "T-PS-MANUAL: -Manual prints 7 steps, works outside a Vault clone"
  else
    report FAIL "T-PS-MANUAL: expected 7 STEP lines, got $step_count"
  fi
}

test_ps_happy_path() {
  [[ $PS_AVAILABLE -ne 1 ]] && return 0
  local d="$SANDBOX/t20-ps-happy"
  make_fake_vault "$d"
  make_fake_lore "$d"
  make_fake_sibling_lore "$d"
  local out
  out=$(run_ps_uninstall "$d" $'I understand and accept the risk\nyes')
  local errors=()
  [[ -e "$d/node_modules" ]]                       && errors+=("node_modules survived")
  [[ -e "$d/api-keys.json" ]]                      && errors+=("api-keys.json survived")
  [[ -e "$d/settings.json" ]]                      && errors+=("settings.json survived")
  [[ ! -e "$d/Lore/notes.md" ]]                    && errors+=("Lore deleted!")
  [[ ! -e "$(dirname "$d")/Tusks-Lore/lore.md" ]]  && errors+=("Tusks-Lore deleted!")
  [[ ! -e "$d/package.json" ]]                     && errors+=("package.json deleted!")
  [[ ! -e "$d/server.ts" ]]                        && errors+=("server.ts deleted!")
  [[ ! -e "$d/uninstall.ps1" ]]                    && errors+=("uninstall.ps1 deleted itself!")
  if [[ ${#errors[@]} -eq 0 ]]; then
    report PASS "T20 (PS): full happy path deletes Vault state, preserves lore + repo source"
  else
    report FAIL "T20 (PS): ${errors[*]}"
  fi
}

# ─── T16: --yes flag bypasses both prompts ────────────────────────────────
test_yes_flag_bypasses_prompts() {
  local d="$SANDBOX/t16-yes-flag"
  make_fake_vault "$d"
  local out exit_code
  # No stdin at all — would hang on a read if the prompt fired.
  out=$(run_sh_uninstall "$d" "" --yes)
  exit_code=$?
  # Should have actually deleted things (no acknowledgement prompt blocked it).
  if [[ $exit_code -eq 0 ]] && [[ ! -e "$d/node_modules" ]] && [[ ! -e "$d/api-keys.json" ]]; then
    report PASS "T16: --yes flag skips both prompts and proceeds to delete"
  else
    report FAIL "T16: --yes flag should bypass prompts and delete; exit=$exit_code"
  fi
}

# ─── run them all ─────────────────────────────────────────────────────────
echo "==============================================================="
echo "  Tusk's Vault uninstaller — automated test harness"
echo "  Sandbox: $SANDBOX"
echo "==============================================================="
echo

test_guard_a_outside_repo
test_guard_a_wrong_name
test_guard_a_no_server
test_dry_run_in_repo
test_empty_vault
test_preserves_lore
test_preserves_sibling_lore
test_custom_lore_in_repo
test_custom_lore_outside_repo
test_ack_wrong_phrase_exits
test_ack_empty_exits
test_final_no_exits
test_full_deletion_happy_path
test_config_dir_override
test_idempotent_run
test_yes_flag_bypasses_prompts
test_manual_flag_inside_repo
test_manual_flag_outside_repo

# PowerShell mirror tests (only run if a PowerShell interpreter is on PATH)
if [[ $PS_AVAILABLE -eq 1 ]]; then
  echo
  echo "--- PowerShell uninstaller tests (PS interpreter: $PS_CMD) ---"
  test_ps_guard_a_outside
  test_ps_dry_run
  test_ps_ack_wrong
  test_ps_happy_path
  test_ps_manual_flag
else
  echo
  echo "--- Skipping PowerShell tests (no powershell/pwsh on PATH) ---"
fi

echo
echo "==============================================================="
echo "  Results: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "==============================================================="
if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "Failed tests:"
  for d in "${FAIL_DETAILS[@]}"; do
    echo "  - $d"
  done
  exit 1
fi
exit 0

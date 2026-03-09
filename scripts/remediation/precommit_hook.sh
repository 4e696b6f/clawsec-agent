#!/bin/bash
# precommit_hook.sh — ClawSec Remediation: Install pre-commit secret scanning hook
# Tier 1 (Auto): copies file + chmod +x, no system changes
# Exit: 0=applied, 1=already_done, 2=error
# Output: JSON to stdout

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${PWD}"
HOOK_SRC="$SCRIPT_DIR/precommit-scan.sh"
HOOK_DEST="$TARGET_DIR/.git/hooks/pre-commit"

# ── Check: already installed? ─────────────────────────────────────────────────
if [[ -x "$HOOK_DEST" ]]; then
  echo '{"exit_code": 1, "output": "Pre-commit hook already installed and executable"}'
  exit 0
fi

# ── Validate: git repo? ───────────────────────────────────────────────────────
if [[ ! -d "$TARGET_DIR/.git" ]]; then
  echo '{"exit_code": 2, "output": "No .git directory found — cannot install hook outside a git repository"}'
  exit 2
fi

# ── Validate: source script exists? ──────────────────────────────────────────
if [[ ! -f "$HOOK_SRC" ]]; then
  echo "{\"exit_code\": 2, \"output\": \"Hook source not found: $HOOK_SRC\"}"
  exit 2
fi

# ── Apply: copy hook and make executable ─────────────────────────────────────
mkdir -p "$TARGET_DIR/.git/hooks" 2>/dev/null
cp "$HOOK_SRC" "$HOOK_DEST" 2>/dev/null
if [[ $? -ne 0 ]]; then
  echo '{"exit_code": 2, "output": "Failed to copy hook script — check permissions"}'
  exit 2
fi

chmod +x "$HOOK_DEST" 2>/dev/null
if [[ $? -ne 0 ]]; then
  echo '{"exit_code": 2, "output": "Failed to make hook executable — check permissions"}'
  exit 2
fi

echo '{"exit_code": 0, "output": "Pre-commit secret scanning hook installed at .git/hooks/pre-commit"}'
exit 0

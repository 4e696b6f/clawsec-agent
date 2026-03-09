#!/bin/bash
# env_gitignore.sh — ClawSec Remediation: Add .env to .gitignore
# Tier 1 (Auto): additive-only, no data loss, fully reversible
# Exit: 0=applied, 1=already_done, 2=error
# Output: JSON to stdout (server.py reads exit_code and output fields)

# cwd = TARGET_DIR (set by server.py before invocation)
TARGET_DIR="${PWD}"

# ── Check: any .env files present? ───────────────────────────────────────────
ENV_FILES=$(find "$TARGET_DIR" -maxdepth 4 \( -name ".env" -o -name ".env.*" \) \
  ! -name "*.example" ! -name "*.template" ! -name "*.sample" 2>/dev/null)

if [[ -z "$ENV_FILES" ]]; then
  echo '{"exit_code": 1, "output": "No .env files found — nothing to protect"}'
  exit 0
fi

# ── Check: already covered by .gitignore? ────────────────────────────────────
if [[ -f "$TARGET_DIR/.gitignore" ]]; then
  if grep -qE '^\s*\.env' "$TARGET_DIR/.gitignore" 2>/dev/null; then
    echo '{"exit_code": 1, "output": ".env entries already present in .gitignore"}'
    exit 0
  fi
fi

# ── Apply: append .env entries to .gitignore (create if absent) ──────────────
GITIGNORE="$TARGET_DIR/.gitignore"
{
  echo ""
  echo "# ClawSec: Protect credentials from accidental commit"
  echo ".env"
  echo ".env.*"
  echo "!.env.example"
  echo "!.env.template"
  echo "!.env.sample"
} >> "$GITIGNORE" 2>/dev/null

if [[ $? -ne 0 ]]; then
  echo '{"exit_code": 2, "output": "Failed to write to .gitignore — check file permissions"}'
  exit 2
fi

echo '{"exit_code": 0, "output": "Added .env and .env.* entries to .gitignore (with .env.example exception)"}'
exit 0

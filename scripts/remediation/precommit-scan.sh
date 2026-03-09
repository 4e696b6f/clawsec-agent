#!/bin/bash
# precommit-scan.sh — ClawSec Pre-commit Secret Scanner Hook
# Installed to .git/hooks/pre-commit by precommit_hook.sh remediation
# Contract: standalone, no dependency on ClawSec path after installation
# Exit: 0=clean, 1=secrets detected (blocks commit)

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get staged files (only text files, skip binary/deleted)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)

if [[ -z "$STAGED_FILES" ]]; then
  exit 0  # Nothing staged
fi

FOUND_SECRETS=0
FOUND_DETAILS=()

# ── Secret patterns to detect ────────────────────────────────────────────────
declare -A PATTERNS=(
  ["AWS Access Key"]="AKIA[0-9A-Z]{16}"
  ["AWS Secret Key"]="[Aa][Ww][Ss][_-]?[Ss][Ee][Cc][Rr][Ee][Tt][_-]?[Kk][Ee][Yy]\s*[=:]\s*['\"]?[A-Za-z0-9/+]{40}"
  ["Generic API Key"]="[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]\s*[=:]\s*['\"]?[A-Za-z0-9_\-]{20,}"
  ["Generic Secret"]="[Ss][Ee][Cc][Rr][Ee][Tt][_-]?[Kk][Ee][Yy]\s*[=:]\s*['\"]?[A-Za-z0-9_\-]{16,}"
  ["Private Key Header"]="-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY"
  ["Password Assignment"]="[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*[=:]\s*['\"]?[^'\"\s]{8,}"
  ["Token Assignment"]="[Tt][Oo][Kk][Ee][Nn]\s*[=:]\s*['\"]?[A-Za-z0-9_\-\.]{20,}"
  ["Anthropic API Key"]="sk-ant-[A-Za-z0-9_\-]{40,}"
  ["OpenAI API Key"]="sk-[A-Za-z0-9]{48}"
  ["GitHub Token"]="gh[pousr]_[A-Za-z0-9]{36}"
  ["Telegram Bot Token"]="[0-9]{8,10}:[A-Za-z0-9_\-]{35}"
)

# ── Scan staged diff content ──────────────────────────────────────────────────
DIFF_CONTENT=$(git diff --cached 2>/dev/null)

for PATTERN_NAME in "${!PATTERNS[@]}"; do
  PATTERN="${PATTERNS[$PATTERN_NAME]}"
  if echo "$DIFF_CONTENT" | grep -qPE "^\+.*${PATTERN}" 2>/dev/null; then
    FOUND_SECRETS=1
    FOUND_DETAILS+=("$PATTERN_NAME")
  fi
done

# ── Scan staged file names for sensitive names ────────────────────────────────
for FILE in $STAGED_FILES; do
  BASENAME=$(basename "$FILE")
  case "$BASENAME" in
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|*.jks|id_rsa|id_dsa|id_ecdsa|id_ed25519)
      if [[ "$BASENAME" != *.example && "$BASENAME" != *.template && "$BASENAME" != *.sample ]]; then
        FOUND_SECRETS=1
        FOUND_DETAILS+=("Sensitive file: $FILE")
      fi
      ;;
  esac
done

# ── Report and block if secrets found ────────────────────────────────────────
if [[ $FOUND_SECRETS -eq 1 ]]; then
  echo -e "${RED}[ClawSec] SECRET DETECTED — Commit blocked${NC}"
  echo ""
  echo "The following potential secrets were found in staged changes:"
  for detail in "${FOUND_DETAILS[@]}"; do
    echo -e "  ${YELLOW}•${NC} $detail"
  done
  echo ""
  echo "To proceed if this is a false positive:"
  echo "  git commit --no-verify   (bypasses all hooks — use with caution)"
  echo ""
  echo "To fix: Remove the secret and use environment variables or a secrets manager."
  exit 1
fi

exit 0

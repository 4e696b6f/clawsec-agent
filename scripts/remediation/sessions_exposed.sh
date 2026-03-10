#!/usr/bin/env bash
# Remediation: sessions_exposed
# Tier:  approval — chmod on potentially active session files
# Scope: OpenClaw canonical ~/.openclaw/agents/<agentId>/sessions/*.jsonl
#        Legacy fallback ~/.openclaw/sessions/*.jsonl — both checked
# Exit:  0=applied, 1=already_done, 2=error
#
# Contract: outputs JSON to stdout {"exit_code": N, "output": "..."}
# cwd is set to $TARGET_DIR by server.py before running this script

set -euo pipefail

TARGET_BASE="${TARGET_DIR:-${HOME}/.openclaw}"

# Check both known session locations
EXPOSED_COUNT=0
for SESS_DIR in "${TARGET_BASE}/sessions" "${TARGET_BASE}/agents"; do
  if [[ -d "$SESS_DIR" ]]; then
    COUNT=$(find "$SESS_DIR" -name "*.jsonl" -perm /o=r 2>/dev/null | wc -l)
    EXPOSED_COUNT=$(( EXPOSED_COUNT + COUNT ))
  fi
done

if [[ "$EXPOSED_COUNT" -eq 0 ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 1, 'output': 'already_done: no world-readable session files found'}))"
  exit 1
fi

# Apply chmod 600 on all world-readable .jsonl files
FIXED=0
ERRORS=0
for SESS_DIR in "${TARGET_BASE}/sessions" "${TARGET_BASE}/agents"; do
  if [[ -d "$SESS_DIR" ]]; then
    while IFS= read -r -d '' f; do
      if chmod 600 "$f" 2>/dev/null; then
        FIXED=$(( FIXED + 1 ))
      else
        ERRORS=$(( ERRORS + 1 ))
      fi
    done < <(find "$SESS_DIR" -name "*.jsonl" -perm /o=r -print0 2>/dev/null)
  fi
done

# Verify
REMAINING=0
for SESS_DIR in "${TARGET_BASE}/sessions" "${TARGET_BASE}/agents"; do
  if [[ -d "$SESS_DIR" ]]; then
    COUNT=$(find "$SESS_DIR" -name "*.jsonl" -perm /o=r 2>/dev/null | wc -l)
    REMAINING=$(( REMAINING + COUNT ))
  fi
done

if [[ "$REMAINING" -eq 0 ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 0, 'output': 'OK: ${FIXED} session file(s) fixed \u2192 chmod 600'}))"
  exit 0
else
  python3 -c "import json; print(json.dumps({'exit_code': 2, 'output': 'ERROR: ${REMAINING} file(s) still world-readable after fix (${ERRORS} chmod errors)'}))"
  exit 2
fi

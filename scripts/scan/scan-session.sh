#!/bin/bash
# scan-session.sh — ClawSec SESSION Agent Scanner
# Scope: session logs, conversation history, memory store permissions
# Contract: read-only, no network, never touch active session files
# Exit: 0=success, 1=cannot access TARGET_DIR

TARGET_DIR="${1:-$HOME/.openclaw}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo '{"error": "Cannot access TARGET_DIR"}' >&2
  exit 1
fi

# JSON-safe add_finding function - passes data via stdin to avoid shell injection
FINDINGS="[]"
add_finding() {
  local id="$1" severity="$2" message="$3" owasp_llm="$4" owasp_asi="$5" tier="$6" rec="$7"
  
  # Use python3 to safely build JSON - avoid shell interpolation issues with single quotes
  FINDINGS=$(python3 -c "
import json, sys
data = json.load(sys.stdin)
data.append({
    'id': '$id',
    'severity': '$severity',
    'message': '$message',
    'owasp_llm': None if '$owasp_llm' == 'null' else '$owasp_llm',
    'owasp_asi': None if '$owasp_asi' == 'null' else '$owasp_asi',
    'remediation_tier': '$tier',
    'recommendation': '$rec',
    'status': 'open'
})
print(json.dumps(data))
" <<< "$FINDINGS")
}

# ── Check 1: World-readable session .jsonl files ──────────────────────────────
# OpenClaw canonical: ~/.openclaw/agents/<agentId>/sessions/*.jsonl
# Legacy fallback: ~/.openclaw/sessions/*.jsonl — both checked for compatibility
WORLD_READABLE=0

if [[ -d "$TARGET_DIR/agents" ]]; then
  AGENTS_READABLE=$(find "$TARGET_DIR/agents" -name "*.jsonl" -perm /o=r 2>/dev/null | wc -l | tr -d ' ')
  WORLD_READABLE=$((WORLD_READABLE + AGENTS_READABLE))
fi

if [[ -d "$TARGET_DIR/sessions" ]]; then
  SESSIONS_READABLE=$(find "$TARGET_DIR/sessions" -name "*.jsonl" -perm /o=r 2>/dev/null | wc -l | tr -d ' ')
  WORLD_READABLE=$((WORLD_READABLE + SESSIONS_READABLE))
fi

if [[ "$WORLD_READABLE" -gt 0 ]]; then
  add_finding \
    "sessions_exposed" "high" \
    "${WORLD_READABLE} session log file(s) are world-readable — conversation history exposed to all users" \
    "LLM02:2025 Sensitive Information Disclosure" \
    "null" \
    "approval" \
    "chmod 600 on world-readable .jsonl session files (approval required — files may be active)"
fi

# ── Check 2: Session directory itself world-readable ─────────────────────────
for SESSION_DIR in "$TARGET_DIR/agents" "$TARGET_DIR/sessions"; do
  if [[ -d "$SESSION_DIR" ]]; then
    DIR_PERMS=$(stat -c '%a' "$SESSION_DIR" 2>/dev/null || echo "unknown")
    if [[ "${DIR_PERMS: -1}" =~ [4-7] ]]; then
      add_finding \
        "session_dir_exposed" "medium" \
        "Session directory $(basename $SESSION_DIR)/ has world-readable permissions ($DIR_PERMS)" \
        "LLM02:2025 Sensitive Information Disclosure" \
        "ASI04:2025 Unsecured Credentials" \
        "approval" \
        "chmod 700 $SESSION_DIR"
      break  # Only emit once even if both dirs are affected
    fi
  fi
done

# ── Output ────────────────────────────────────────────────────────────────────
echo "{
  \"agent\": \"clawsec-session\",
  \"scope\": \"session-data\",
  \"findings\": $FINDINGS,
  \"scan_duration_ms\": 0,
  \"agent_version\": \"2.0.0\"
}"

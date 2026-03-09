#!/bin/bash
# scan-perm.sh — ClawSec PERMISSION Agent Scanner
# Scope: filesystem permissions for agent identity files
# Contract: read-only, no network, output JSON to stdout
# Exit: 0=success, 1=cannot access TARGET_DIR

TARGET_DIR="${1:-$HOME/.openclaw}"
WORKSPACE="$TARGET_DIR/workspace"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo '{"error": "Cannot access TARGET_DIR"}' >&2
  exit 1
fi

FINDINGS="[]"
add_finding() {
  local id="$1" severity="$2" message="$3" owasp_llm="$4" owasp_asi="$5" tier="$6" rec="$7"
  FINDINGS=$(echo "$FINDINGS" | python3 -c "
import json, sys
findings = json.load(sys.stdin)
findings.append({
  'id': '$id',
  'severity': '$severity',
  'message': '$message',
  'owasp_llm': $([ '$owasp_llm' = 'null' ] && echo 'null' || echo \"\\\"$owasp_llm\\\"\"),
  'owasp_asi': $([ '$owasp_asi' = 'null' ] && echo 'null' || echo \"\\\"$owasp_asi\\\"\"),
  'remediation_tier': '$tier',
  'recommendation': '$rec',
  'status': 'open'
})
print(json.dumps(findings))
")
}

# ── Check 1: SOUL.md permissions ─────────────────────────────────────────────
SOUL_PATH="$WORKSPACE/SOUL.md"
if [[ -f "$SOUL_PATH" ]]; then
  SOUL_PERMS=$(stat -c '%a' "$SOUL_PATH" 2>/dev/null || echo "unknown")
  if [[ "$SOUL_PERMS" != "444" ]]; then
    add_finding \
      "soul_writable" "critical" \
      "SOUL.md permissions are $SOUL_PERMS — agent identity can be overwritten" \
      "LLM07:2025 System Prompt Leakage" \
      "ASI01:2025 Goal Hijacking" \
      "auto" \
      "chmod 444 $SOUL_PATH"
  fi
else
  add_finding \
    "soul_missing" "high" \
    "SOUL.md not found — agent has no identity anchor" \
    "LLM07:2025 System Prompt Leakage" \
    "ASI01:2025 Goal Hijacking" \
    "never" \
    "Create SOUL.md in $WORKSPACE with agent identity definition"
fi

# ── Check 2: CONSTRAINTS.md permissions ──────────────────────────────────────
CONSTRAINTS_PATH="$WORKSPACE/CONSTRAINTS.md"
if [[ -f "$CONSTRAINTS_PATH" ]]; then
  C_PERMS=$(stat -c '%a' "$CONSTRAINTS_PATH" 2>/dev/null || echo "unknown")
  if [[ "$C_PERMS" != "444" ]]; then
    add_finding \
      "constraints_writable" "critical" \
      "CONSTRAINTS.md permissions are $C_PERMS — security constraints can be removed" \
      "LLM07:2025 System Prompt Leakage" \
      "ASI01:2025 Goal Hijacking" \
      "auto" \
      "chmod 444 $CONSTRAINTS_PATH"
  fi
fi

# ── Check 3: Session file world-readability ───────────────────────────────────
WORLD_READABLE_SESSIONS=$(find "$TARGET_DIR/agents" -name "*.jsonl" -perm /o=r 2>/dev/null | wc -l)
if [[ "$WORLD_READABLE_SESSIONS" -gt 0 ]]; then
  add_finding \
    "sessions_exposed" "high" \
    "${WORLD_READABLE_SESSIONS} session log(s) are world-readable" \
    "LLM02:2025 Sensitive Information Disclosure" \
    "null" \
    "approval" \
    "chmod 600 on world-readable session .jsonl files"
fi

# ── Check 4: Workspace directory permissions ──────────────────────────────────
if [[ -d "$WORKSPACE" ]]; then
  WS_PERMS=$(stat -c '%a' "$WORKSPACE" 2>/dev/null || echo "unknown")
  # World-readable if last digit >= 4 (others can read)
  if [[ "${WS_PERMS: -1}" -ge 4 ]]; then
    add_finding \
      "workspace_world_readable" "medium" \
      "Workspace directory permissions $WS_PERMS — readable by all users" \
      "LLM02:2025 Sensitive Information Disclosure" \
      "ASI05:2025 Excessive Permissions" \
      "approval" \
      "chmod 750 $WORKSPACE"
  fi
fi

# ── Check 5: SOUL.md recently modified ───────────────────────────────────────
OPENCLAW_JSON="$TARGET_DIR/openclaw.json"
if [[ -f "$SOUL_PATH" && -f "$OPENCLAW_JSON" ]]; then
  # If SOUL.md is newer than openclaw.json, flag for review
  if [[ "$SOUL_PATH" -nt "$OPENCLAW_JSON" ]]; then
    SOUL_MTIME=$(stat -c '%Y' "$SOUL_PATH" 2>/dev/null)
    SOUL_MTIME_H=$(date -d "@$SOUL_MTIME" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "recently")
    add_finding \
      "soul_recently_modified" "high" \
      "SOUL.md was modified at $SOUL_MTIME_H — verify identity integrity" \
      "LLM07:2025 System Prompt Leakage" \
      "ASI01:2025 Goal Hijacking" \
      "never" \
      "Review SOUL.md content and verify no unauthorized changes"
  fi
fi

# ── Output ────────────────────────────────────────────────────────────────────
echo "{
  \"agent\": \"clawsec-perm\",
  \"scope\": \"filesystem-permissions\",
  \"findings\": $FINDINGS,
  \"scan_duration_ms\": 0,
  \"agent_version\": \"2.0.0\"
}"

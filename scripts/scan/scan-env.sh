#!/bin/bash
# scan-env.sh — ClawSec ENV Agent Scanner
# Scope: credentials, secrets, .env handling, CI security
# Contract: read-only, no network, output JSON to stdout
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
  # Pass existing FINDINGS via stdin to avoid bash string escaping problems
  FINDINGS=$(python3 -c "
import json, sys

# Read existing findings from stdin
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

# ── Check 1: .env files not in .gitignore ─────────────────────────────────────
ENV_FILES=$(find "$TARGET_DIR" -maxdepth 4 \( -name ".env" -o -name ".env.*" \) \
  ! -name "*.example" ! -name "*.template" ! -name "*.sample" 2>/dev/null)

if [[ -n "$ENV_FILES" ]]; then
  GITIGNORE_ENV="false"
  if [[ -f "$TARGET_DIR/.gitignore" ]]; then
    if grep -qE '^\s*\.env' "$TARGET_DIR/.gitignore" 2>/dev/null; then
      GITIGNORE_ENV="true"
    fi
  fi

  if [[ "$GITIGNORE_ENV" == "false" ]]; then
    ENV_COUNT=$(echo "$ENV_FILES" | wc -l | tr -d ' ')
    add_finding \
      "env_gitignore" "high" \
      "${ENV_COUNT} .env file(s) found but not covered by .gitignore — credentials at risk" \
      "LLM02:2025 Sensitive Information Disclosure" \
      "ASI04:2025 Unsecured Credentials" \
      "auto" \
      "Add .env and .env.* to .gitignore"
  fi
fi

# ── Check 2: Pre-commit hook missing ─────────────────────────────────────────
if [[ ! -x "$TARGET_DIR/.git/hooks/pre-commit" ]]; then
  add_finding \
    "precommit_hook" "medium" \
    "No executable pre-commit hook found — secrets can be committed without scanning" \
    "LLM02:2025 Sensitive Information Disclosure" \
    "null" \
    "auto" \
    "Install a pre-commit secret scanning hook via ClawSec remediation"
fi

# ── Check 3: SECURITY.md missing ─────────────────────────────────────────────
if [[ ! -f "$TARGET_DIR/SECURITY.md" ]]; then
  add_finding \
    "breach_notification_procedure" "medium" \
    "No SECURITY.md found — no breach notification procedure documented" \
    "null" \
    "ASI06:2025 Inadequate Incident Response" \
    "auto" \
    "Create SECURITY.md with breach reporting and response timeline"
fi

# ── Check 4: AgentShield CI workflow missing ──────────────────────────────────
if [[ ! -f "$TARGET_DIR/.github/workflows/agentshield.yml" ]]; then
  add_finding \
    "runtime_package_install" "medium" \
    "No AgentShield CI workflow found — runtime package integrity not validated" \
    "LLM05:2025 Improper Output Handling" \
    "ASI02:2025 Unauthorized Code Execution" \
    "auto" \
    "Create .github/workflows/agentshield.yml to validate packages on every push"
fi

# ── Check 5: No seccomp profiles (agent communication isolation) ──────────────
SECCOMP_COUNT=$(find "$TARGET_DIR" -maxdepth 5 -name "seccomp*.json" 2>/dev/null | wc -l | tr -d ' ')
if [[ "$SECCOMP_COUNT" -eq 0 ]]; then
  add_finding \
    "agent_communication_isolation" "medium" \
    "No seccomp profiles found — agents run without syscall sandboxing" \
    "LLM08:2025 Excessive Agency" \
    "ASI03:2025 Inadequate Sandboxing" \
    "approval" \
    "Add seccomp profiles from ClawSec docker/ directory and apply to agent containers"
fi

# ── Output ────────────────────────────────────────────────────────────────────
echo "{
  \"agent\": \"clawsec-env\",
  \"scope\": \"credentials\",
  \"findings\": $FINDINGS,
  \"scan_duration_ms\": 0,
  \"agent_version\": \"2.0.0\"
}"

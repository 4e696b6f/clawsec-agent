#!/usr/bin/env bash
# scan-environment.sh — ClawSec 2.0 unified scanner
#
# Contract: read-only, no network, no eval, no rm, no curl, no wget
# Input:    $1 = TARGET_DIR (default: ~/.openclaw)
# Output:   JSON to stdout (ScanOutput format v1)
# Exit:     0 = success, 1 = TARGET_DIR not accessible
#
# Dependencies: stat, find, grep, wc  (required)
#               jq                    (optional — python3 fallback used if absent)
#               ss / netstat          (optional — skipped gracefully if absent)

set -euo pipefail

TARGET_DIR="${1:-${HOME}/.openclaw}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo '{"error":"TARGET_DIR not accessible"}' >&2
  exit 1
fi

# ── jq helper — build JSON arrays even without jq installed ──────────────────
# We use python3 as the universal fallback for JSON construction.
# python3 is the only runtime dependency we rely on unconditionally.

json_array_from_lines() {
  # Reads lines from stdin, outputs a JSON array string
  python3 -c "
import sys, json
lines = [l.rstrip() for l in sys.stdin if l.strip()]
print(json.dumps(lines))
"
}

json_bool() {
  # Converts shell true/false string to JSON boolean
  [[ "$1" == "true" ]] && echo "true" || echo "false"
}

# ── Domain 1: Identity (SOUL.md, CONSTRAINTS.md) ─────────────────────────────

SOUL_FILE="${TARGET_DIR}/workspace/SOUL.md"
CONSTRAINTS_FILE="${TARGET_DIR}/workspace/CONSTRAINTS.md"

if [[ -f "$SOUL_FILE" ]]; then
  SOUL_PERMS=$(stat -c '%a' "$SOUL_FILE" 2>/dev/null || echo "unknown")
else
  SOUL_PERMS="missing"
fi

if [[ -f "$CONSTRAINTS_FILE" ]]; then
  CONSTRAINTS_PERMS=$(stat -c '%a' "$CONSTRAINTS_FILE" 2>/dev/null || echo "unknown")
else
  CONSTRAINTS_PERMS="missing"
fi

# ── Domain 2: Credentials (.env, gitignore, pre-commit) ──────────────────────

ENV_FILES=$(
  find "$TARGET_DIR" -maxdepth 3 \
    \( -name ".env" -o -name ".env.*" \) \
    ! -name "*.example" ! -name "*.template" ! -name "*.sample" \
    2>/dev/null | json_array_from_lines
)

GITIGNORE_ENV="false"
if [[ -f "${TARGET_DIR}/.gitignore" ]]; then
  grep -qE '^\s*\.env' "${TARGET_DIR}/.gitignore" 2>/dev/null \
    && GITIGNORE_ENV="true"
fi

PRECOMMIT="false"
if [[ -x "${TARGET_DIR}/.git/hooks/pre-commit" ]]; then
  PRECOMMIT="true"
fi

# ── Domain 3: Network (port binding, gateway) ─────────────────────────────────

SERVER_BINDING="offline"
if command -v ss &>/dev/null; then
  SS_OUT=$(ss -tlnp 2>/dev/null || true)
  if echo "$SS_OUT" | grep -q "0\.0\.0\.0:3001\|:::3001"; then
    SERVER_BINDING="exposed"
  elif echo "$SS_OUT" | grep -q ":3001"; then
    SERVER_BINDING="localhost"
  fi
elif command -v netstat &>/dev/null; then
  NS_OUT=$(netstat -tlnp 2>/dev/null || true)
  if echo "$NS_OUT" | grep -q "0\.0\.0\.0:3001"; then
    SERVER_BINDING="exposed"
  elif echo "$NS_OUT" | grep -q ":3001"; then
    SERVER_BINDING="localhost"
  fi
fi

GATEWAY_BINDING="unknown"
OPENCLAW_CONFIG="${TARGET_DIR}/openclaw.json"
if [[ -f "$OPENCLAW_CONFIG" ]]; then
  BIND_VAL=$(python3 -c "
import json, sys
try:
    d = json.load(open('${OPENCLAW_CONFIG}'))
    print(d.get('gateway', {}).get('bind', 'unknown'))
except Exception as e:
    print('unknown')
" 2>/dev/null || echo "unknown")
  case "$BIND_VAL" in
    "127.0.0.1"|"localhost"|"::1") GATEWAY_BINDING="loopback" ;;
    "0.0.0.0"|"*"|"::")           GATEWAY_BINDING="any" ;;
    "unknown")                    GATEWAY_BINDING="unknown" ;;
    *)                            GATEWAY_BINDING="loopback" ;;  # explicit local IP assumed safe
  esac
fi

# ── Domain 4: Sessions (.jsonl permissions) ───────────────────────────────────

SESSIONS_READABLE="none"
for SESS_DIR in "${TARGET_DIR}/sessions" "${TARGET_DIR}/agents"; do
  if [[ -d "$SESS_DIR" ]]; then
    WORLD_READABLE=$(find "$SESS_DIR" -name "*.jsonl" -perm /o=r 2>/dev/null | wc -l)
    if [[ "$WORLD_READABLE" -gt 0 ]]; then
      SESSIONS_READABLE="world_readable"
      break
    else
      SESSIONS_READABLE="protected"
    fi
  fi
done

# ── Domain 5: Config & CI ─────────────────────────────────────────────────────

SECURITY_MD="false"
if [[ -f "${TARGET_DIR}/SECURITY.md" ]] || \
   [[ -f "${TARGET_DIR}/workspace/clawsec/SECURITY.md" ]]; then
  SECURITY_MD="true"
fi

AGENTSHIELD="false"
if [[ -f "${TARGET_DIR}/.github/workflows/agentshield.yml" ]]; then
  AGENTSHIELD="true"
fi

MCP_SERVERS=$(
  CLAUDE_CONFIG="${HOME}/.config/claude/claude_desktop_config.json"
  if [[ -f "$CLAUDE_CONFIG" ]]; then
    python3 -c "
import json
try:
    d = json.load(open('${CLAUDE_CONFIG}'))
    servers = list(d.get('mcpServers', {}).keys())
    import json as j
    print(j.dumps(servers))
except Exception:
    print('[]')
" 2>/dev/null || echo "[]"
  else
    echo "[]"
  fi
)

DOCKER_COMPOSE="false"
find "$TARGET_DIR" -maxdepth 3 -name "docker-compose*.yml" 2>/dev/null \
  | grep -q . && DOCKER_COMPOSE="true" || true

SECCOMP_PROFILES=$(
  find "$TARGET_DIR" -maxdepth 4 -name "seccomp*.json" 2>/dev/null \
  | json_array_from_lines
)

GITHUB_ACTIONS=$(
  if [[ -d "${TARGET_DIR}/.github/workflows" ]]; then
    find "${TARGET_DIR}/.github/workflows" -name "*.yml" -o -name "*.yaml" 2>/dev/null \
    | xargs -I{} basename {} 2>/dev/null | json_array_from_lines
  else
    echo "[]"
  fi
)

PYTHON_MIDDLEWARE="false"
if [[ -f "${TARGET_DIR}/middleware/security_middleware.py" ]] || \
   [[ -f "${TARGET_DIR}/workspace/clawsec/middleware/security_middleware.py" ]]; then
  PYTHON_MIDDLEWARE="true"
fi

# ── Risk Emission ─────────────────────────────────────────────────────────────

RISKS="[]"

add_risk() {
  # Usage: add_risk <id> <severity> <message> <owasp>
  local id="$1" severity="$2" message="$3" owasp="$4"
  RISKS=$(python3 -c "
import json, sys
risks = json.loads('''${RISKS}''')
risks.append({
    'id':       '${id}',
    'severity': '${severity}',
    'message':  '${message}',
    'owasp':    '${owasp}'
})
print(json.dumps(risks))
")
}

# Domain 1: Identity
if [[ "$SOUL_PERMS" != "444" && "$SOUL_PERMS" != "missing" && "$SOUL_PERMS" != "unknown" ]]; then
  add_risk "soul_writable" "critical" \
    "SOUL.md permissions ${SOUL_PERMS} — expected 444 (read-only)" \
    "LLM07:2025 System Prompt Leakage / ASI01:2025 Goal Hijacking"
fi

if [[ "$CONSTRAINTS_PERMS" != "444" && "$CONSTRAINTS_PERMS" != "missing" && "$CONSTRAINTS_PERMS" != "unknown" ]]; then
  add_risk "constraints_writable" "critical" \
    "CONSTRAINTS.md permissions ${CONSTRAINTS_PERMS} — expected 444 (read-only)" \
    "LLM07:2025 System Prompt Leakage / ASI01:2025 Goal Hijacking"
fi

# Domain 2: Credentials
if [[ "$ENV_FILES" != "[]" && "$GITIGNORE_ENV" == "false" ]]; then
  add_risk "env_gitignore" "high" \
    ".env files found but not excluded from git — credentials at risk" \
    "LLM02:2025 Sensitive Information Disclosure / ASI04:2025 Unsecured Credentials"
fi

if [[ "$PRECOMMIT" == "false" ]]; then
  add_risk "precommit_hook" "medium" \
    "No executable pre-commit hook installed — secrets can be committed without scanning" \
    "LLM02:2025 Sensitive Information Disclosure"
fi

# Domain 3: Network
if [[ "$SERVER_BINDING" == "exposed" ]]; then
  add_risk "server_exposed" "high" \
    "ClawSec backend bound to 0.0.0.0:3001 — accessible from LAN, not just localhost" \
    "ASI05:2025 Excessive Permissions"
fi

if [[ "$GATEWAY_BINDING" == "any" ]]; then
  add_risk "gateway_exposed" "high" \
    "OpenClaw gateway not restricted to loopback — gateway API reachable from network" \
    "LLM06:2025 Excessive Agency / ASI05:2025 Excessive Permissions"
fi

# Domain 4: Sessions
if [[ "$SESSIONS_READABLE" == "world_readable" ]]; then
  add_risk "sessions_exposed" "high" \
    "Session log files are world-readable — conversation history exposed" \
    "LLM02:2025 Sensitive Information Disclosure"
fi

# Domain 5: Config & CI
if [[ "$SECURITY_MD" == "false" ]]; then
  add_risk "breach_notification_procedure" "medium" \
    "SECURITY.md missing — no breach notification procedure documented" \
    "ASI06:2025 Inadequate Incident Response"
fi

if [[ "$SECCOMP_PROFILES" == "[]" ]]; then
  add_risk "agent_communication_isolation" "medium" \
    "No seccomp profiles found — agent sandboxing not verifiable" \
    "LLM08:2025 Excessive Agency / ASI03:2025 Inadequate Sandboxing"
fi

if [[ "$AGENTSHIELD" == "false" ]]; then
  add_risk "runtime_package_install" "medium" \
    "No AgentShield CI workflow found — runtime package integrity not validated" \
    "LLM05:2025 Improper Output Handling / ASI02:2025 Unauthorized Code Execution"
fi

# ── Output ────────────────────────────────────────────────────────────────────

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - <<PYEOF
import json, sys

output = {
    "version": "1",
    "timestamp": "${TIMESTAMP}",
    "project_root": "${TARGET_DIR}",
    "detected": {
        "env_files":              ${ENV_FILES},
        "mcp_servers":            ${MCP_SERVERS},
        "docker_compose":         ${DOCKER_COMPOSE},
        "seccomp_profiles":       ${SECCOMP_PROFILES},
        "security_md":            ${SECURITY_MD},
        "python_middleware":       ${PYTHON_MIDDLEWARE},
        "github_actions":         ${GITHUB_ACTIONS},
        "agentshield_workflow":   ${AGENTSHIELD},
        "gitignore_env":          ${GITIGNORE_ENV},
        "precommit_hook":         ${PRECOMMIT},
        "server_binding":         "${SERVER_BINDING}",
        "soul_permissions":       "${SOUL_PERMS}",
        "constraints_permissions":"${CONSTRAINTS_PERMS}",
        "gateway_binding":        "${GATEWAY_BINDING}",
        "sessions_readable":      "${SESSIONS_READABLE}"
    },
    "risks": ${RISKS}
}

print(json.dumps(output, indent=2))
PYEOF

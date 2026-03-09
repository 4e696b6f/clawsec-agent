#!/bin/bash
# scan-config.sh — ClawSec CONFIG Agent Scanner
# Scope: openclaw.json configuration, gateway auth, MCP server exposure
# Contract: read-only, no network, output JSON to stdout
# Exit: 0=success, 1=cannot access TARGET_DIR

TARGET_DIR="${1:-$HOME/.openclaw}"

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

OPENCLAW_JSON="$TARGET_DIR/openclaw.json"

# Skip all checks if openclaw.json doesn't exist
if [[ ! -f "$OPENCLAW_JSON" ]]; then
  echo "{
  \"agent\": \"clawsec-config\",
  \"scope\": \"configuration\",
  \"findings\": [],
  \"scan_duration_ms\": 0,
  \"agent_version\": \"2.0.0\"
}"
  exit 0
fi

# ── Check 1: Gateway auth disabled ───────────────────────────────────────────
AUTH_STATUS=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    gw = d.get('gateway', {})
    auth = gw.get('auth', {})
    # Check various auth config patterns
    if isinstance(auth, dict):
        enabled = auth.get('enabled', auth.get('required', True))
        mode = auth.get('mode', 'unknown')
        if enabled is False or mode in ('none', 'disabled', 'off'):
            print('disabled')
        else:
            print('enabled')
    elif auth is False or auth == 'none':
        print('disabled')
    else:
        print('enabled')
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [[ "$AUTH_STATUS" == "disabled" ]]; then
  add_finding \
    "gateway_binding" "high" \
    "OpenClaw gateway authentication is disabled — unauthenticated API access possible" \
    "LLM08:2025 Excessive Agency" \
    "ASI03:2025 Inadequate Sandboxing" \
    "never" \
    "Enable gateway auth in openclaw.json (gateway.auth.enabled: true) — requires restart"
fi

# ── Check 2: MCP servers with external exposure ───────────────────────────────
MCP_EXPOSED=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    mcp = d.get('mcpServers', {})
    exposed = []
    for name, cfg in mcp.items():
        if isinstance(cfg, dict):
            if cfg.get('external', False) or cfg.get('expose', False) or cfg.get('public', False):
                exposed.append(name)
            # Also flag servers with non-loopback bind addresses
            bind = cfg.get('bind', cfg.get('host', '127.0.0.1'))
            if bind not in ('127.0.0.1', 'localhost', '::1', ''):
                if name not in exposed:
                    exposed.append(name)
    if exposed:
        print(','.join(exposed))
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null || echo "")

if [[ -n "$MCP_EXPOSED" ]]; then
  MCP_COUNT=$(echo "$MCP_EXPOSED" | tr ',' '\n' | wc -l | tr -d ' ')
  add_finding \
    "mcp_servers_exposed" "medium" \
    "${MCP_COUNT} MCP server(s) configured with external exposure: $MCP_EXPOSED" \
    "LLM08:2025 Excessive Agency" \
    "null" \
    "never" \
    "Review MCP server config in openclaw.json — remove external/expose flags or restrict bind address"
fi

# ── Check 3: openclaw.json world-readable ────────────────────────────────────
JSON_PERMS=$(stat -c '%a' "$OPENCLAW_JSON" 2>/dev/null || echo "unknown")
if [[ "${JSON_PERMS: -1}" =~ [4-7] ]]; then
  add_finding \
    "config_world_readable" "medium" \
    "openclaw.json is world-readable ($JSON_PERMS) — configuration details exposed" \
    "LLM02:2025 Sensitive Information Disclosure" \
    "ASI05:2025 Excessive Permissions" \
    "never" \
    "chmod 640 $OPENCLAW_JSON (owner+group read, no world read)"
fi

# ── Output ────────────────────────────────────────────────────────────────────
echo "{
  \"agent\": \"clawsec-config\",
  \"scope\": \"configuration\",
  \"findings\": $FINDINGS,
  \"scan_duration_ms\": 0,
  \"agent_version\": \"2.0.0\"
}"

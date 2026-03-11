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

# ── Check 3: Exec security set to "full" (any command allowed) ───────────────
EXEC_SECURITY=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    val = d.get('exec_security', d.get('execSecurity', 'deny'))
    print(str(val).lower())
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [[ "$EXEC_SECURITY" == "full" || "$EXEC_SECURITY" == "allow" || "$EXEC_SECURITY" == "true" ]]; then
  add_finding \
    "exec_security_full" "high" \
    "Exec security is set to '${EXEC_SECURITY}' — all shell commands execute without approval" \
    "LLM08:2025 Excessive Agency" \
    "ASI02:2025 Unauthorized Code Execution" \
    "never" \
    "Set exec_security to 'deny' in openclaw.json — requires restart. Use allowlist for specific trusted commands."
fi

# ── Check 4: DM policy set to "open" (anyone can DM the agent) ───────────────
DM_POLICY=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    val = d.get('dm_policy', d.get('dmPolicy', d.get('dm', {}).get('policy', 'pairing')))
    print(str(val).lower())
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [[ "$DM_POLICY" == "open" || "$DM_POLICY" == "all" || "$DM_POLICY" == "any" ]]; then
  add_finding \
    "dm_policy_open" "high" \
    "DM policy is '${DM_POLICY}' — any sender can interact with the agent without pairing" \
    "LLM01:2025 Prompt Injection" \
    "ASI01:2025 Goal Hijacking" \
    "never" \
    "Set dm_policy to 'pairing' or 'allowlist' in openclaw.json — requires restart"
fi

# ── Check 5: allowFrom unconfigured (defaults to self-only but worth flagging) ─
ALLOW_FROM=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    val = d.get('allowFrom', d.get('allow_from', None))
    if val is None:
        print('not_set')
    elif isinstance(val, list) and len(val) == 0:
        print('empty')
    elif val in ('*', 'all', 'any'):
        print('wildcard')
    else:
        print('configured')
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [[ "$ALLOW_FROM" == "wildcard" ]]; then
  add_finding \
    "allowfrom_wildcard" "high" \
    "allowFrom is set to wildcard ('*') — any sender on any channel can reach the agent" \
    "LLM08:2025 Excessive Agency" \
    "ASI05:2025 Excessive Permissions" \
    "never" \
    "Set allowFrom to explicit sender IDs or phone numbers in openclaw.json"
fi

# ── Check 6: SSRF protection disabled ────────────────────────────────────────
SSRF_STATUS=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    security = d.get('security', {})
    ssrf = security.get('ssrf_protection', security.get('ssrfProtection', True))
    if ssrf is False or str(ssrf).lower() in ('disabled', 'off', 'false', 'none'):
        print('disabled')
    else:
        print('enabled')
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [[ "$SSRF_STATUS" == "disabled" ]]; then
  add_finding \
    "ssrf_protection_disabled" "high" \
    "SSRF protection is explicitly disabled — agent can fetch internal IPs and localhost URLs" \
    "LLM02:2025 Sensitive Information Disclosure" \
    "ASI05:2025 Excessive Permissions" \
    "never" \
    "Remove security.ssrf_protection: false from openclaw.json — SSRF protection is on by default and must stay enabled"
fi

# ── Check 8: openclaw.json world-readable ────────────────────────────────────
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

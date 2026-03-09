#!/bin/bash
# scan-net.sh — ClawSec NETWORK Agent Scanner
# Scope: port binding, gateway exposure, network configuration
# Contract: read-only, no network requests, output JSON to stdout
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

# ── Check 1: Server binding (port 3001) ───────────────────────────────────────
# ss -tlnp is read-only — lists local sockets, no network traffic
SERVER_BINDING="offline"
if command -v ss >/dev/null 2>&1; then
  SS_OUTPUT=$(ss -tlnp 2>/dev/null | grep ':3001' || true)
  if [[ -n "$SS_OUTPUT" ]]; then
    if echo "$SS_OUTPUT" | grep -qE '(0\.0\.0\.0|:::)'; then
      SERVER_BINDING="exposed"
    else
      SERVER_BINDING="localhost"
    fi
  fi
elif command -v netstat >/dev/null 2>&1; then
  NS_OUTPUT=$(netstat -tlnp 2>/dev/null | grep ':3001' || true)
  if [[ -n "$NS_OUTPUT" ]]; then
    if echo "$NS_OUTPUT" | grep -qE '0\.0\.0\.0'; then
      SERVER_BINDING="exposed"
    else
      SERVER_BINDING="localhost"
    fi
  fi
fi

if [[ "$SERVER_BINDING" == "exposed" ]]; then
  add_finding \
    "server_exposed" "high" \
    "ClawSec backend is bound to 0.0.0.0:3001 — accessible from LAN, not just localhost" \
    "null" \
    "ASI05:2025 Excessive Permissions" \
    "approval" \
    "Set OPENCLAW_HOST=127.0.0.1 in environment and restart server.py"
fi

# ── Check 2: Gateway binding in openclaw.json ─────────────────────────────────
OPENCLAW_JSON="$TARGET_DIR/openclaw.json"
GATEWAY_BINDING="unknown"

if [[ -f "$OPENCLAW_JSON" ]]; then
  GATEWAY_BINDING=$(python3 -c "
import json, sys
try:
    with open('$OPENCLAW_JSON') as f:
        d = json.load(f)
    bind = d.get('gateway', {}).get('bind', 'unknown')
    if bind in ('127.0.0.1', 'localhost', '::1'):
        print('loopback')
    elif bind == 'unknown':
        print('unknown')
    else:
        print('any')
except Exception as e:
    print('unknown')
" 2>/dev/null || echo "unknown")
fi

if [[ "$GATEWAY_BINDING" == "any" ]]; then
  add_finding \
    "gateway_exposed" "critical" \
    "OpenClaw gateway is not bound to loopback — gateway API is reachable from network" \
    "LLM06:2025 Excessive Agency" \
    "ASI05:2025 Excessive Permissions" \
    "never" \
    "Set gateway.bind to 127.0.0.1 in openclaw.json — requires service restart (operator decision)"
fi

# ── Output ────────────────────────────────────────────────────────────────────
echo "{
  \"agent\": \"clawsec-net\",
  \"scope\": \"network-exposure\",
  \"findings\": $FINDINGS,
  \"scan_duration_ms\": 0,
  \"agent_version\": \"2.0.0\"
}"

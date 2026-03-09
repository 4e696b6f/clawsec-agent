#!/usr/bin/env bash
# Remediation: gateway_exposed
# Tier:  approval — patches openclaw.json gateway.bind to 127.0.0.1
# Scope: ~/.openclaw/openclaw.json
# Exit:  0=applied, 1=already_done, 2=error
#
# Contract: outputs JSON to stdout {"exit_code": N, "output": "..."}
# cwd is set to $TARGET_DIR by server.py before running this script
#
# NOTE: Safe for OpenClaw channels — Telegram, WhatsApp, Slack etc. connect via
#       external webhooks/polling TO the channel provider, not via LAN-direct.
#       Binding 0.0.0.0 → 127.0.0.1 only blocks unauthorized LAN access.
#       After apply: run `openclaw gateway restart` to activate the change.

set -euo pipefail

CONFIG="${TARGET_DIR:-${HOME}/.openclaw}/openclaw.json"

if [[ ! -f "$CONFIG" ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 2, 'output': 'ERROR: openclaw.json not found: ${CONFIG}'}))"
  exit 2
fi

# Read current gateway.bind value
CURRENT=$(python3 -c "
import json, sys
try:
    d = json.load(open('${CONFIG}'))
    print(d.get('gateway', {}).get('bind', 'unknown'))
except Exception as e:
    print('unknown')
" 2>/dev/null || echo "unknown")

if [[ "$CURRENT" == "127.0.0.1" ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 1, 'output': 'already_done: gateway already bound to 127.0.0.1'}))"
  exit 1
fi

# Backup before patching
BACKUP="${CONFIG}.bak.$(date +%Y%m%d_%H%M%S)"
cp "$CONFIG" "$BACKUP"

# Patch gateway.bind using python3 (no jq dependency)
RESULT=$(python3 -c "
import json, sys
config_path = '${CONFIG}'
current = '${CURRENT}'
try:
    with open(config_path) as f:
        d = json.load(f)
    d.setdefault('gateway', {})['bind'] = '127.0.0.1'
    with open(config_path, 'w') as f:
        json.dump(d, f, indent=2)
    print(json.dumps({
        'exit_code': 0,
        'output': 'OK: gateway.bind set to 127.0.0.1 (was: ' + current + ') \u2014 Run: openclaw gateway restart\nNOTE: Channel connections (Telegram, WhatsApp etc.) reconnect automatically.'
    }))
except Exception as e:
    print(json.dumps({'exit_code': 2, 'output': 'ERROR: ' + str(e)}))
    sys.exit(2)
" 2>/dev/null)

echo "$RESULT"

# Parse exit_code from result to set shell exit status
EXIT_CODE=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('exit_code',2))" <<< "$RESULT" 2>/dev/null || echo "2")
exit "$EXIT_CODE"

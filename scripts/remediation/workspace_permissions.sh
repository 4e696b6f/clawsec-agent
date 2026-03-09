#!/usr/bin/env bash
# Remediation: workspace_permissions
# Tier:  approval — chmod on workspace directory
# Scope: ~/.openclaw/workspace/
# Exit:  0=applied, 1=already_done, 2=error
#
# Contract: outputs JSON to stdout {"exit_code": N, "output": "..."}
# cwd is set to $TARGET_DIR by server.py before running this script

set -euo pipefail

WORKSPACE="${TARGET_DIR:-${HOME}/.openclaw}/workspace"

if [[ ! -d "$WORKSPACE" ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 2, 'output': 'ERROR: workspace directory not found: ${WORKSPACE}'}))"
  exit 2
fi

CURRENT_PERMS=$(stat -c '%a' "$WORKSPACE" 2>/dev/null || echo "unknown")

# 750 = rwxr-x--- (owner: full, group: read+exec, others: nothing)
if [[ "$CURRENT_PERMS" == "750" || "$CURRENT_PERMS" == "700" ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 1, 'output': 'already_done: workspace already ${CURRENT_PERMS} (at or stricter than 750)'}))"
  exit 1
fi

chmod 750 "$WORKSPACE"

VERIFY=$(stat -c '%a' "$WORKSPACE" 2>/dev/null || echo "unknown")
if [[ "$VERIFY" == "750" ]]; then
  python3 -c "import json; print(json.dumps({'exit_code': 0, 'output': 'OK: workspace permissions changed ${CURRENT_PERMS} \u2192 750'}))"
  exit 0
else
  python3 -c "import json; print(json.dumps({'exit_code': 2, 'output': 'ERROR: chmod failed, workspace is still ${VERIFY}'}))"
  exit 2
fi

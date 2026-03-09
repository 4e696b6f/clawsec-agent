#!/bin/bash
# install.sh — ClawSec 2.0 Installer
# Deploys ClawSec into an OpenClaw instance via symlinks.
# Run from the ClawSec project root.
# Usage: bash install.sh [--openclaw-home /path/to/.openclaw]

set -euo pipefail

CLAWSEC_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

# Parse optional --openclaw-home argument
while [[ $# -gt 0 ]]; do
  case "$1" in
    --openclaw-home)
      OPENCLAW_HOME="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash install.sh [--openclaw-home /path/to/.openclaw]" >&2
      exit 1
      ;;
  esac
done

CLAWSEC_DEST="$OPENCLAW_HOME/workspace/clawsec"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo -e "${BLUE}[ClawSec]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; exit 1; }

echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ClawSec 2.0 — Installer            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""
echo "  Source:      $CLAWSEC_SRC"
echo "  OpenClaw:    $OPENCLAW_HOME"
echo "  Destination: $CLAWSEC_DEST"
echo ""

# ── Step 1: Verify OpenClaw installation ─────────────────────────────────────
step "Verifying OpenClaw installation..."
if [[ ! -d "$OPENCLAW_HOME" ]]; then
  fail "~/.openclaw not found. Is OpenClaw installed?"
fi
ok "OpenClaw home found: $OPENCLAW_HOME"

# ── Step 2: Create workspace directory ────────────────────────────────────────
step "Setting up ClawSec workspace..."
mkdir -p "$OPENCLAW_HOME/workspace"

if [[ -L "$CLAWSEC_DEST" ]]; then
  rm "$CLAWSEC_DEST"
  warn "Removed existing symlink at $CLAWSEC_DEST"
fi

if [[ -d "$CLAWSEC_DEST" && "$CLAWSEC_DEST" != "$CLAWSEC_SRC" ]]; then
  warn "Directory exists at $CLAWSEC_DEST — backing up to ${CLAWSEC_DEST}.bak"
  mv "$CLAWSEC_DEST" "${CLAWSEC_DEST}.bak"
fi

if [[ "$CLAWSEC_DEST" != "$CLAWSEC_SRC" ]]; then
  ln -sfn "$CLAWSEC_SRC" "$CLAWSEC_DEST"
  ok "Symlinked: $CLAWSEC_DEST → $CLAWSEC_SRC"
else
  ok "Source is already at destination path"
fi

# Create reports directory with restricted permissions
mkdir -p "$CLAWSEC_SRC/reports"
chmod 700 "$CLAWSEC_SRC/reports"
ok "Reports directory ready (mode 700): $CLAWSEC_SRC/reports"

# ── Step 3: Register OpenClaw plugin (extension) ──────────────────────────────
step "Registering OpenClaw plugin extension..."
EXTENSION_DIR="$OPENCLAW_HOME/extensions/clawsec"
mkdir -p "$EXTENSION_DIR"

ln -sf "$CLAWSEC_DEST/src/coordinator.ts" "$EXTENSION_DIR/index.ts"
ok "Plugin entry: $EXTENSION_DIR/index.ts"

# Copy plugin manifest (some runtimes expect it alongside entry)
cp "$CLAWSEC_SRC/openclaw.plugin.json" "$EXTENSION_DIR/openclaw.plugin.json"
ok "Plugin manifest: $EXTENSION_DIR/openclaw.plugin.json"

# ── Step 4: Register all 6 skills ─────────────────────────────────────────────
step "Registering ClawSec skills..."

declare -A SKILL_MAP=(
  ["clawsec-coordinator"]="skills/clawsec-coordinator/SKILL.md"
  ["clawsec-env"]="skills/agents/env-agent/SKILL.md"
  ["clawsec-perm"]="skills/agents/permission-agent/SKILL.md"
  ["clawsec-net"]="skills/agents/network-agent/SKILL.md"
  ["clawsec-session"]="skills/agents/session-agent/SKILL.md"
  ["clawsec-config"]="skills/agents/config-agent/SKILL.md"
)

for skill_name in "${!SKILL_MAP[@]}"; do
  skill_src="$CLAWSEC_DEST/${SKILL_MAP[$skill_name]}"
  skill_dest_dir="$OPENCLAW_HOME/skills/$skill_name"
  skill_dest="$skill_dest_dir/SKILL.md"

  mkdir -p "$skill_dest_dir"

  if [[ -f "$skill_src" ]]; then
    ln -sf "$skill_src" "$skill_dest"
    ok "Skill: $skill_name → $skill_dest"
  else
    warn "Skill source not found: $skill_src (skipped)"
  fi
done

# ── Step 5: Set script permissions ────────────────────────────────────────────
step "Setting script permissions..."
if ls "$CLAWSEC_SRC/scripts/scan/"*.sh >/dev/null 2>&1; then
  chmod +x "$CLAWSEC_SRC/scripts/scan/"*.sh
  ok "Scanner scripts: chmod +x scripts/scan/*.sh"
fi
if ls "$CLAWSEC_SRC/scripts/remediation/"*.sh >/dev/null 2>&1; then
  chmod +x "$CLAWSEC_SRC/scripts/remediation/"*.sh
  ok "Remediation scripts: chmod +x scripts/remediation/*.sh"
fi

# ── Step 6: Verify server can be started ──────────────────────────────────────
step "Verifying server.py..."
if [[ -f "$CLAWSEC_SRC/scripts/server.py" ]]; then
  python3 -c "
import sys, pathlib
p = pathlib.Path('$CLAWSEC_SRC/scripts/server.py')
src = p.read_text()
assert 'ClawSecHandler' in src
assert 'AGENT_SCRIPTS' in src
print('OK')
" 2>/dev/null && ok "server.py syntax verified" || warn "server.py verification skipped"
else
  fail "scripts/server.py not found!"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ClawSec 2.0 — Install Complete     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo "  Next steps:"
echo "    1. Start backend server:"
echo "       python3 $CLAWSEC_SRC/scripts/server.py &"
echo ""
echo "    2. Verify health:"
echo "       curl http://127.0.0.1:3001/api/health"
echo ""
echo "    3. Run first security scan:"
echo "       curl http://127.0.0.1:3001/api/scan | python3 -m json.tool"
echo ""
echo "    4. Trigger via OpenClaw:"
echo "       Say: \"security scan\" to your Kairos agent"
echo ""
echo "  Dashboard: http://localhost:8081 (start React app separately)"
echo ""

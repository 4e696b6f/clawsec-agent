#!/usr/bin/env bash
# install.sh — ClawSec 2.0 Installer
#
# Deploys ClawSec into an OpenClaw instance.
# Files are COPIED (never symlinked) so OpenClaw's realpath() check passes.
#
# Usage:
#   bash install.sh [--openclaw-home /path/to/.openclaw]
#
# Idempotent: safe to run multiple times.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

CLAWSEC_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-${HOME}/.openclaw}"
CLAWSEC_BACKEND_PORT="${OPENCLAW_PORT:-3001}"
CLAWSEC_BACKEND_HOST="${OPENCLAW_HOST:-127.0.0.1}"

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

INSTALL_DIR="${OPENCLAW_HOME}/workspace/clawsec"

# ── Colour helpers ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

step()  { echo -e "\n${BLUE}[ClawSec]${NC} $1"; }
ok()    { echo -e "  ${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
skip()  { echo -e "  ${CYAN}[SKIP]${NC} $1 (already done)"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $1"; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ClawSec 2.0 — Installer                ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Source:      ${CLAWSEC_SRC}"
echo "  OpenClaw:    ${OPENCLAW_HOME}"
echo "  Destination: ${INSTALL_DIR}"
echo ""

# ── Step 1: Verify OpenClaw ───────────────────────────────────────────────────

step "Verifying OpenClaw installation..."

if [[ ! -d "${OPENCLAW_HOME}" ]]; then
  fail "~/.openclaw not found. Is OpenClaw installed? Expected: ${OPENCLAW_HOME}"
fi
ok "OpenClaw home found: ${OPENCLAW_HOME}"

# ── Step 2: Install ClawSec into workspace (copy, not symlink) ───────────────
# Why copy: OpenClaw's skill-loader calls realpath() on every loaded file.
# Symlinks that resolve outside the configured root are silently skipped.
# Copying ensures the realpath() is always within ~/.openclaw/.

step "Installing ClawSec into workspace (copy)..."

mkdir -p "${OPENCLAW_HOME}/workspace"

if [[ -d "${INSTALL_DIR}" ]]; then
  if [[ "${INSTALL_DIR}" == "${CLAWSEC_SRC}" ]]; then
    ok "Already installed at destination (same path)"
  else
    skip "Workspace directory already exists: ${INSTALL_DIR}"
    echo "         To force reinstall: rm -rf ${INSTALL_DIR} && bash install.sh"
  fi
else
  cp -r "${CLAWSEC_SRC}" "${INSTALL_DIR}"
  ok "Copied ClawSec to: ${INSTALL_DIR}"
fi

# Create reports directory with restricted permissions
mkdir -p "${INSTALL_DIR}/reports"
chmod 700 "${INSTALL_DIR}/reports"
ok "Reports directory ready (mode 700): ${INSTALL_DIR}/reports"

# ── Step 3: Copy skills (COPY, never symlink) ─────────────────────────────────
# Skills are installed under the normalized flat OpenClaw naming scheme:
#   ~/.openclaw/skills/<skill-name>/SKILL.md
#
# Source layout (repo)              →  Target layout (OpenClaw)
# skills/clawsec-coordinator/SKILL.md  →  skills/clawsec-coordinator/SKILL.md
# skills/agents/env-agent/SKILL.md     →  skills/clawsec-env/SKILL.md
# skills/agents/permission-agent/SKILL.md → skills/clawsec-perm/SKILL.md
# skills/agents/network-agent/SKILL.md    → skills/clawsec-net/SKILL.md
# skills/agents/session-agent/SKILL.md    → skills/clawsec-session/SKILL.md
# skills/agents/config-agent/SKILL.md     → skills/clawsec-config/SKILL.md

step "Installing skills..."

# Array entries: "target-skill-name:relative-source-path"
SKILL_MAP=(
  "clawsec-coordinator:skills/clawsec-coordinator/SKILL.md"
  "clawsec-env:skills/agents/env-agent/SKILL.md"
  "clawsec-perm:skills/agents/permission-agent/SKILL.md"
  "clawsec-net:skills/agents/network-agent/SKILL.md"
  "clawsec-session:skills/agents/session-agent/SKILL.md"
  "clawsec-config:skills/agents/config-agent/SKILL.md"
)

# Also try normalized paths (skills/clawsec-*/SKILL.md) as fallback
SKILL_MAP_NORMALIZED=(
  "clawsec-env:skills/clawsec-env/SKILL.md"
  "clawsec-perm:skills/clawsec-perm/SKILL.md"
  "clawsec-net:skills/clawsec-net/SKILL.md"
  "clawsec-session:skills/clawsec-session/SKILL.md"
  "clawsec-config:skills/clawsec-config/SKILL.md"
)

install_skill() {
  local skill_name="$1"
  local src_rel="$2"
  local src="${INSTALL_DIR}/${src_rel}"
  local dest_dir="${OPENCLAW_HOME}/skills/${skill_name}"
  local dest="${dest_dir}/SKILL.md"

  if [[ ! -f "$src" ]]; then
    return 1  # Source not found — caller tries fallback
  fi

  # Remove any existing symlink (legacy installs used ln -s)
  if [[ -L "$dest" ]]; then
    rm "$dest"
  fi

  mkdir -p "$dest_dir"
  cp "$src" "$dest"
  return 0
}

SKILLS_OK=0
SKILLS_FAIL=0

for entry in "${SKILL_MAP[@]}"; do
  skill_name="${entry%%:*}"
  skill_src="${entry#*:}"

  if install_skill "$skill_name" "$skill_src"; then
    ok "Skill installed: ${skill_name}"
    SKILLS_OK=$(( SKILLS_OK + 1 ))
  else
    # Try normalized path as fallback
    NORMALIZED_SRC=""
    for norm_entry in "${SKILL_MAP_NORMALIZED[@]}"; do
      if [[ "${norm_entry%%:*}" == "$skill_name" ]]; then
        NORMALIZED_SRC="${norm_entry#*:}"
        break
      fi
    done

    if [[ -n "$NORMALIZED_SRC" ]] && install_skill "$skill_name" "$NORMALIZED_SRC"; then
      ok "Skill installed (normalized path): ${skill_name}"
      SKILLS_OK=$(( SKILLS_OK + 1 ))
    else
      warn "Skill source not found — skipped: ${skill_name} (checked ${skill_src})"
      SKILLS_FAIL=$(( SKILLS_FAIL + 1 ))
    fi
  fi
done

if [[ $SKILLS_FAIL -gt 0 ]]; then
  warn "${SKILLS_FAIL} skill(s) could not be installed. Run from the ClawSec repo root."
else
  ok "All ${SKILLS_OK} skills installed"
fi

# ── Step 4: Copy plugin extension (COPY, never symlink) ──────────────────────

step "Installing OpenClaw plugin extension..."

EXTENSION_DIR="${OPENCLAW_HOME}/extensions/clawsec"
mkdir -p "${EXTENSION_DIR}"

# Remove legacy symlink if present
if [[ -L "${EXTENSION_DIR}/index.ts" ]]; then
  rm "${EXTENSION_DIR}/index.ts"
  warn "Removed legacy symlink: ${EXTENSION_DIR}/index.ts"
fi

cp "${INSTALL_DIR}/src/coordinator.ts" "${EXTENSION_DIR}/index.ts"
ok "Plugin entry: ${EXTENSION_DIR}/index.ts"

cp "${INSTALL_DIR}/openclaw.plugin.json" "${EXTENSION_DIR}/openclaw.plugin.json"
ok "Plugin manifest: ${EXTENSION_DIR}/openclaw.plugin.json"

# Copy tsconfig so OpenClaw's TS loader can resolve module settings
if [[ -f "${INSTALL_DIR}/tsconfig.json" ]]; then
  cp "${INSTALL_DIR}/tsconfig.json" "${EXTENSION_DIR}/tsconfig.json"
  ok "tsconfig.json: ${EXTENSION_DIR}/tsconfig.json"
fi

# ── Step 5: Set script permissions ────────────────────────────────────────────

step "Setting script permissions..."

[[ -f "${INSTALL_DIR}/scripts/scan-environment.sh" ]] && \
  chmod +x "${INSTALL_DIR}/scripts/scan-environment.sh" && \
  ok "chmod +x scripts/scan-environment.sh"

if ls "${INSTALL_DIR}/scripts/scan/"*.sh &>/dev/null 2>&1; then
  chmod +x "${INSTALL_DIR}/scripts/scan/"*.sh
  ok "chmod +x scripts/scan/*.sh"
fi

if ls "${INSTALL_DIR}/scripts/remediation/"*.sh &>/dev/null 2>&1; then
  chmod +x "${INSTALL_DIR}/scripts/remediation/"*.sh
  ok "chmod +x scripts/remediation/*.sh"
fi

# ── Step 6: Set SOUL.md + CONSTRAINTS.md immutable (444) ──────────────────────

step "Securing identity files..."

for identity_file in \
  "${OPENCLAW_HOME}/workspace/SOUL.md" \
  "${OPENCLAW_HOME}/workspace/CONSTRAINTS.md"; do

  if [[ -f "$identity_file" ]]; then
    current_perms=$(stat -c '%a' "$identity_file" 2>/dev/null || echo "unknown")
    if [[ "$current_perms" != "444" ]]; then
      chmod 444 "$identity_file"
      ok "chmod 444: $(basename $identity_file) (was ${current_perms})"
    else
      skip "$(basename $identity_file) already 444"
    fi
  fi
done

# ── Step 7: Port-check before backend start ───────────────────────────────────

step "Checking port ${CLAWSEC_BACKEND_PORT}..."

PORT_STATUS="free"
if command -v python3 &>/dev/null; then
  PORT_STATUS=$(python3 - <<PYEOF
import socket, json, sys

host = "${CLAWSEC_BACKEND_HOST}"
port = ${CLAWSEC_BACKEND_PORT}

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(1)
result = sock.connect_ex((host, port))
sock.close()

if result != 0:
    print("free")
    sys.exit(0)

# Port occupied — check if it's our own ClawSec server
try:
    import urllib.request
    url = f"http://{host}:{port}/api/health"
    with urllib.request.urlopen(url, timeout=2) as r:
        data = json.loads(r.read())
        if data.get("status") == "ok":
            print("self")
            sys.exit(0)
except Exception:
    pass

print("other")
PYEOF
)
fi

case "$PORT_STATUS" in
  "free")
    ok "Port ${CLAWSEC_BACKEND_PORT} is available"
    ;;
  "self")
    skip "ClawSec backend already running on ${CLAWSEC_BACKEND_HOST}:${CLAWSEC_BACKEND_PORT}"
    ;;
  "other")
    warn "Port ${CLAWSEC_BACKEND_PORT} is occupied by another process"
    warn "Fix: lsof -ti:${CLAWSEC_BACKEND_PORT} | xargs kill -9"
    warn "Then re-run: python3 ${INSTALL_DIR}/scripts/server.py &"
    ;;
esac

# ── Step 8: Verify server.py ──────────────────────────────────────────────────

step "Verifying server.py..."

if [[ ! -f "${INSTALL_DIR}/scripts/server.py" ]]; then
  fail "scripts/server.py not found in ${INSTALL_DIR}"
fi

python3 -c "
import ast, sys
src = open('${INSTALL_DIR}/scripts/server.py').read()
try:
    ast.parse(src)
    print('syntax_ok')
except SyntaxError as e:
    print(f'syntax_error: {e}')
    sys.exit(1)
" | grep -q "syntax_ok" && ok "server.py syntax OK" || fail "server.py has syntax errors"

# ── Step 9: Patch openclaw.json (enable plugin) ───────────────────────────────

step "Patching openclaw.json to enable ClawSec plugin..."

OPENCLAW_JSON="${OPENCLAW_HOME}/openclaw.json"
if [[ -f "$OPENCLAW_JSON" ]]; then
  if command -v python3 &>/dev/null; then
    PATCH_RESULT=$(python3 - <<PYEOF
import json, sys

path = "${OPENCLAW_JSON}"
try:
    with open(path) as f:
        config = json.load(f)
except Exception as e:
    print(f"error: {e}")
    sys.exit(1)

# Idempotent: only patch if not already enabled
plugins = config.setdefault("plugins", {})
entries = plugins.setdefault("entries", {})

if entries.get("clawsec", {}).get("enabled") is True:
    print("already_enabled")
    sys.exit(0)

entries["clawsec"] = {"enabled": True}

with open(path, "w") as f:
    json.dump(config, f, indent=2)

print("patched")
PYEOF
)
    case "$PATCH_RESULT" in
      "patched")         ok "openclaw.json: clawsec plugin enabled" ;;
      "already_enabled") skip "openclaw.json: clawsec plugin already enabled" ;;
      error*)            warn "openclaw.json patch failed: ${PATCH_RESULT}" ;;
    esac
  else
    warn "python3 not available — openclaw.json not patched (manual step required)"
  fi
else
  warn "openclaw.json not found at ${OPENCLAW_JSON} — plugin auto-activation skipped"
  warn "Manual: add {\"plugins\": {\"entries\": {\"clawsec\": {\"enabled\": true}}}} to openclaw.json"
fi

# ── Step 10: TypeScript check (optional) ─────────────────────────────────────

step "TypeScript validation (optional)..."

if command -v npx &>/dev/null && [[ -f "${INSTALL_DIR}/tsconfig.json" ]]; then
  TS_RESULT=$(cd "${INSTALL_DIR}" && npx tsc --noEmit 2>&1 || true)
  if [[ -z "$TS_RESULT" ]]; then
    ok "TypeScript: no errors"
  else
    warn "TypeScript issues detected (non-blocking):"
    echo "$TS_RESULT" | head -10 | while IFS= read -r line; do
      echo "    $line"
    done
  fi
else
  skip "npx not available or tsconfig.json missing — TypeScript check skipped"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ClawSec 2.0 — Install Complete         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Start backend server:"
echo "       python3 ${INSTALL_DIR}/scripts/server.py &"
echo ""
echo "  2. Verify health:"
echo "       curl http://127.0.0.1:${CLAWSEC_BACKEND_PORT}/api/health"
echo "       # Expected: {\"status\": \"ok\", \"version\": \"2.0.0\"}"
echo ""
echo "  3. Restart OpenClaw gateway (required for plugin + skills to load):"
echo "       openclaw gateway restart"
echo "       # Note: Gateway restart briefly interrupts agent availability"
echo ""
echo "  4. Verify plugin loaded:"
echo "       grep -i 'clawsec' ~/.openclaw/logs/openclaw-\$(date +%Y-%m-%d).log"
echo "       # Expected: [CLAWSEC] ClawSec 2.0 plugin registered"
echo ""
echo "  5. Trigger first security scan:"
echo "       Say: \"security scan\" to your Kairos agent"
echo "       OR:  curl http://127.0.0.1:${CLAWSEC_BACKEND_PORT}/api/scan | python3 -m json.tool"
echo ""
echo "  6. Dashboard (after build):"
echo "       cd ${INSTALL_DIR} && npm install --prefix src/ && npm run build --prefix src/"
echo "       npx serve -s src/dist -l 8081"
echo "       # Dashboard: http://localhost:8081"
echo ""

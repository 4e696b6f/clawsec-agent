# ClawSec 2.0 — Install Guide

## Quick Install

```bash
# From the cloned repository root:
bash install.sh

# With custom OpenClaw home:
bash install.sh --openclaw-home /path/to/.openclaw
```

The installer handles everything: workspace copy, skills, extension, permissions, and plugin activation.

---

## What install.sh Does

**Important:** All files are **copied** (not symlinked).
OpenClaw's skill-loader calls `realpath()` on every loaded file and silently skips
any path that resolves outside its configured root. Symlinks pointing to `/tmp/` or
other locations outside `~/.openclaw/` would be skipped without error.

### Steps performed:

| Step | Action |
|------|--------|
| 1 | Verify `~/.openclaw/` exists |
| 2 | **Copy** ClawSec to `~/.openclaw/workspace/clawsec/` (no symlinks) |
| 3 | **Copy** 6 skills to `~/.openclaw/skills/<skill-name>/SKILL.md` |
| 4 | **Copy** plugin to `~/.openclaw/extensions/clawsec/index.ts` |
| 5 | `chmod +x` all scanner + remediation scripts |
| 6 | `chmod 444` SOUL.md + CONSTRAINTS.md (immutable identity files) |
| 7 | Port-check: verify port 3001 is free (or already ours) |
| 8 | Validate `server.py` syntax |
| 9 | Patch `openclaw.json` to enable the ClawSec plugin (idempotent) |
| 10 | Optional: TypeScript validation via `npx tsc --noEmit` |

---

## After Install

```bash
# 1. Start backend
python3 ~/.openclaw/workspace/clawsec/scripts/server.py &

# 2. Verify health
curl http://127.0.0.1:3001/api/health
# Expected: {"status": "ok", "version": "2.0.0"}

# 3. Restart OpenClaw gateway (required for plugin + skills to load)
openclaw gateway restart

# 4. Verify plugin loaded
grep -i 'clawsec' ~/.openclaw/logs/openclaw-$(date +%Y-%m-%d).log
# Expected: [CLAWSEC] ClawSec 2.0 plugin registered

# 5. Verify all 6 skills loaded (no "Skipping skill path" in log)
grep -i 'skill' ~/.openclaw/logs/openclaw-$(date +%Y-%m-%d).log | grep -i clawsec

# 6. Run first scan
curl http://127.0.0.1:3001/api/scan | python3 -m json.tool
```

---

## Dashboard (React)

```bash
cd ~/.openclaw/workspace/clawsec

# Install dependencies and build
npm install --prefix src/
npm run build --prefix src/

# Serve
npx serve -s src/dist -l 8081
# Dashboard: http://localhost:8081
```

For development (live-reload + API proxy):
```bash
npm run dev --prefix src/
```

---

## Installed File Layout

```
~/.openclaw/
├── workspace/
│   └── clawsec/                        ← ClawSec runtime root (COPY from repo)
│       ├── openclaw.plugin.json
│       ├── src/
│       │   ├── coordinator.ts          ← OpenClaw plugin + coordinator logic
│       │   ├── clawsec-ops-center.jsx  ← Dashboard React component
│       │   ├── main.jsx                ← Vite entry point
│       │   ├── index.html              ← Vite HTML template
│       │   ├── package.json            ← npm build config
│       │   └── vite.config.js
│       ├── scripts/
│       │   ├── scan-environment.sh     ← Unified 5-domain scanner
│       │   ├── server.py               ← HTTP backend (127.0.0.1:3001)
│       │   ├── scan/
│       │   │   ├── scan-env.sh
│       │   │   ├── scan-perm.sh
│       │   │   ├── scan-net.sh
│       │   │   ├── scan-session.sh
│       │   │   └── scan-config.sh
│       │   └── remediation/
│       │       ├── env_gitignore.sh
│       │       ├── precommit_hook.sh
│       │       ├── breach_notification_procedure.sh
│       │       └── runtime_package_install.sh
│       ├── skills/
│       │   ├── clawsec-coordinator/SKILL.md   ← canonical
│       │   ├── clawsec-env/SKILL.md           ← canonical (normalized)
│       │   ├── clawsec-perm/SKILL.md          ← canonical
│       │   ├── clawsec-net/SKILL.md           ← canonical
│       │   ├── clawsec-session/SKILL.md       ← canonical
│       │   ├── clawsec-config/SKILL.md        ← canonical
│       │   └── agents/                        ← legacy source layout (backup)
│       ├── reports/                           ← gitignored, chmod 700
│       └── docker/
│
├── skills/
│   ├── clawsec-coordinator/SKILL.md    ← COPIED by install.sh
│   ├── clawsec-env/SKILL.md            ← COPIED (NOT symlinked)
│   ├── clawsec-perm/SKILL.md
│   ├── clawsec-net/SKILL.md
│   ├── clawsec-session/SKILL.md
│   └── clawsec-config/SKILL.md
│
└── extensions/
    └── clawsec/
        ├── index.ts                    ← COPIED from src/coordinator.ts
        ├── openclaw.plugin.json        ← COPIED
        └── tsconfig.json              ← COPIED (CommonJS module resolution)
```

---

## Troubleshooting

### Skills not loading (`Skipping skill path that resolves outside its configured root`)
This happens when skills are symlinks pointing outside `~/.openclaw/`.
**Fix:** Re-run `bash install.sh` — it removes legacy symlinks and copies files.

### Plugin not loaded (no `[CLAWSEC]` in logs)
1. Check the extension was copied (not symlinked): `ls -la ~/.openclaw/extensions/clawsec/`
2. Verify `openclaw.json` has plugin enabled: `grep -A3 '"clawsec"' ~/.openclaw/openclaw.json`
3. Restart gateway: `openclaw gateway restart`

### Port 3001 already in use
```bash
# Check who's using it:
lsof -i :3001

# Kill if it's a stale ClawSec process:
lsof -ti:3001 | xargs kill -9

# Start fresh:
python3 ~/.openclaw/workspace/clawsec/scripts/server.py &
```

### Dashboard shows 404
The dashboard needs to be built first:
```bash
npm install --prefix ~/.openclaw/workspace/clawsec/src/
npm run build --prefix ~/.openclaw/workspace/clawsec/src/
npx serve -s ~/.openclaw/workspace/clawsec/src/dist -l 8081
```

---

## Re-install / Update

```bash
# Remove existing installation
rm -rf ~/.openclaw/workspace/clawsec
rm -rf ~/.openclaw/skills/clawsec-*
rm -rf ~/.openclaw/extensions/clawsec

# Re-run installer
bash /path/to/clawsec-repo/install.sh
```

---

## Key Differences from v1.0

| Aspect | v1.0 | v2.0 |
|--------|------|------|
| Installation | Symlinks (broken by realpath check) | **File copies** (OpenClaw-compatible) |
| Architecture | Monolithic scanner | 5 isolated sub-agents |
| Scan execution | Sequential | Parallel (all agents simultaneously) |
| Skills layout | `skills/agents/env-agent/` | `skills/clawsec-env/` (flat, canonical) |
| Extension loading | Symlink → failed | Copy → works |
| Port handling | Crash on conflict | Graceful detect + skip/error |
| Unified scanner | Missing | `scripts/scan-environment.sh` |
| Build system | None | Vite + React |
| OWASP coverage | LLM10 + ASI | LLM10 + ASI + OpenClaw-specific |
| Remediation | Manual + auto | Tiered (auto/approval/never) |

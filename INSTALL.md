# ClawSec 2.0 — File Structure & Install Guide

## Complete File Structure

```
~/.openclaw/workspace/clawsec/          ← ClawSec runtime root
│
├── openclaw.plugin.json                ← OpenClaw plugin manifest
│
├── src/
│   └── coordinator.ts                  ← OpenClaw plugin + coordinator logic
│
├── skills/
│   ├── clawsec-coordinator/
│   │   └── SKILL.md                    ← Gateway agent orchestrator skill
│   └── agents/
│       ├── env-agent/SKILL.md          ← Credentials sub-agent
│       ├── permission-agent/SKILL.md   ← Filesystem perms sub-agent
│       ├── network-agent/SKILL.md      ← Network exposure sub-agent
│       ├── session-agent/SKILL.md      ← Session data sub-agent
│       └── config-agent/SKILL.md       ← Config security sub-agent
│
├── scripts/
│   ├── server.py                       ← HTTP backend (127.0.0.1:3001)
│   ├── scan/
│   │   ├── scan-env.sh                 ← ENV agent bash scanner
│   │   ├── scan-perm.sh                ← PERM agent bash scanner
│   │   ├── scan-net.sh                 ← NET agent bash scanner
│   │   ├── scan-session.sh             ← SESSION agent bash scanner
│   │   └── scan-config.sh              ← CONFIG agent bash scanner
│   └── remediation/
│       ├── env_gitignore.sh
│       ├── precommit_hook.sh
│       ├── breach_notification_procedure.sh
│       └── runtime_package_install.sh
│
├── reports/                            ← gitignored
│   ├── last-scan.json
│   └── scan-YYYYMMDD_HHMMSS.json
│
└── docker/
    ├── seccomp-agent.json
    └── docker-compose.security.yml

~/.openclaw/skills/clawsec-coordinator/ ← OpenClaw skill registry
└── SKILL.md                            → symlink to skills/clawsec-coordinator/SKILL.md

~/.openclaw/skills/clawsec-env/
└── SKILL.md                            → symlink to skills/agents/env-agent/SKILL.md

(etc. for all 5 sub-agent skills)

~/.openclaw/extensions/clawsec/         ← OpenClaw plugin auto-discovery
└── index.ts                            → symlink to src/coordinator.ts
```

## Install Steps

```bash
# 1. Clone into workspace
git clone https://github.com/4e696b6f/clawsec \
  ~/.openclaw/workspace/clawsec

# 2. Register plugin with OpenClaw
mkdir -p ~/.openclaw/extensions/clawsec
ln -sf ~/.openclaw/workspace/clawsec/src/coordinator.ts \
       ~/.openclaw/extensions/clawsec/index.ts
cp ~/.openclaw/workspace/clawsec/openclaw.plugin.json \
   ~/.openclaw/extensions/clawsec/

# 3. Register all skills
for skill in clawsec-coordinator clawsec-env clawsec-perm clawsec-net clawsec-session clawsec-config; do
  mkdir -p ~/.openclaw/skills/$skill
done
ln -sf ~/.openclaw/workspace/clawsec/skills/clawsec-coordinator/SKILL.md \
       ~/.openclaw/skills/clawsec-coordinator/SKILL.md
ln -sf ~/.openclaw/workspace/clawsec/skills/agents/env-agent/SKILL.md \
       ~/.openclaw/skills/clawsec-env/SKILL.md
ln -sf ~/.openclaw/workspace/clawsec/skills/agents/permission-agent/SKILL.md \
       ~/.openclaw/skills/clawsec-perm/SKILL.md
ln -sf ~/.openclaw/workspace/clawsec/skills/agents/network-agent/SKILL.md \
       ~/.openclaw/skills/clawsec-net/SKILL.md
ln -sf ~/.openclaw/workspace/clawsec/skills/agents/session-agent/SKILL.md \
       ~/.openclaw/skills/clawsec-session/SKILL.md
ln -sf ~/.openclaw/workspace/clawsec/skills/agents/config-agent/SKILL.md \
       ~/.openclaw/skills/clawsec-config/SKILL.md

# 4. Make scripts executable
chmod +x ~/.openclaw/workspace/clawsec/scripts/scan/*.sh
chmod +x ~/.openclaw/workspace/clawsec/scripts/remediation/*.sh

# 5. Start backend
python3 ~/.openclaw/workspace/clawsec/scripts/server.py &

# 6. Verify
curl http://127.0.0.1:3001/api/health
# → {"status": "ok", "version": "2.0.0"}

# 7. Test individual agent
curl http://127.0.0.1:3001/api/agent/clawsec-perm/scan
# → SubAgentResult JSON
```

## Key Differences from v1.0

| Aspect | v1.0 | v2.0 |
|--------|------|------|
| Architecture | Monolithic scanner | 5 isolated sub-agents |
| Scan execution | Sequential | Parallel (all agents simultaneously) |
| Agent role | Trigger only | Real orchestrator (Gateway) |
| Scope isolation | None | Each agent has defined scope |
| OpenClaw integration | Skill only | Skill + lifecycle-hook plugin |
| OWASP coverage | LLM10 + ASI | LLM10 + ASI + OpenClaw-specific |
| Remediation | Manual + auto | Tiered (auto/approval/never) |
| Heartbeat | Not implemented | Delta scan, alert on new findings only |
| Changelog | None | Auto-append on every remediation |
| SOUL.md protection | scan only | Active protection via before_tool_call hook |

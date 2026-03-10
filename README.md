# ClawSec 2.0

Autonomous multi-agent security scanner for **OpenClaw** (Claude-based agent runtime).

> **Disclaimer:** ClawSec 2.0 is built for OpenClaw and tested on OpenClaw. It is not a general-purpose security tool. If you're not running OpenClaw, most checks will not apply.

---

## What it does

ClawSec runs 5 isolated security sub-agents in parallel, maps every finding to [OWASP LLM Top 10 v2.0](https://owasp.org/www-project-top-10-for-large-language-model-applications/) and [OWASP ASI 2025](https://owasp.org/www-project-autonomous-agent-security-initiative/), and auto-applies safe remediations.

```
Kairos Coordinator
    ├── clawsec-env      → Credentials, .env files, secrets
    ├── clawsec-perm     → Filesystem permissions, SOUL.md
    ├── clawsec-net      → Port binding, gateway exposure, CORS
    ├── clawsec-session  → Session logs, memory stores
    └── clawsec-config   → openclaw.json, MCP servers, auth config
```

**Risk score:** `30 × critical + 15 × high + 5 × medium`, capped at 100. Green ≤20, Yellow ≤50, Red >50.

**Remediation tiers:**
- **Tier 1 — auto:** Additive, reversible fixes applied immediately (`.gitignore`, pre-commit hook, `SECURITY.md`, `chmod 444 SOUL.md`)
- **Tier 2 — approval:** Changes requiring a service restart or touching active data (confirmed via Telegram)
- **Tier 3 — advisory:** Network/gateway config — operator decision only, never auto-applied

---

## Requirements

- Linux (tested on Raspberry Pi OS / Fedora)
- Python 3.10+
- Node.js 18+ and npm (for dashboard)
- OpenClaw installed at `~/.openclaw`
- Optional: external notifier integration (Telegram or other channels can be added in your deployment)

---

## Installation

```bash
git clone https://github.com/4e696b6f/clawsec-agent
cd clawsec-agent

# Full install (workspace + plugin + skills + systemd)
bash install.sh
```

`install.sh` copies all files to `~/.openclaw/workspace/clawsec/`, installs the plugin to `~/.openclaw/extensions/clawsec/`, copies skills, sets up systemd services, and builds the dashboard.

**Plugin-only** (if you already have workspace/scripts elsewhere):

```bash
openclaw plugins install ./Clawsec2.0
# Then copy skills and run server.py manually
```

---

## Running

**Backend (required):**
```bash
python3 scripts/server.py
# Listens on 127.0.0.1:3001
```

**Dashboard (optional):**
```bash
cd dashboard && npm install && npm run build && npm run preview
# Opens at http://localhost:8081
```

Or via systemd (installed automatically if you have sudo):
```bash
sudo systemctl start clawsec
sudo systemctl start clawsec-dashboard@$(whoami)
```

**Run a scan:**
```bash
curl http://127.0.0.1:3001/api/scan
```

**Apply a remediation (requires auth token):**
```bash
TOKEN=$(cat ~/.openclaw/workspace/clawsec/.clawsec_token)
curl -X POST http://127.0.0.1:3001/api/apply/env_gitignore \
  -H "X-ClawSec-Token: $TOKEN"
```

**Dashboard:** Paste the token in Config → Auth token. Token is trimmed automatically; use base or apply token.

**Health check:**
```bash
curl http://127.0.0.1:3001/api/health
# {"status": "ok", "version": "2.0.0", ...}
```

---

## OpenClaw plugin & skill

ClawSec installs as an OpenClaw plugin with bundled skills. Trigger it via chat:

> "security scan" · "sicherheitsscan" · "security check" · "fix security" · "clawsec"

**Plugin features:**
- **Tools:** `clawsec_scan`, `clawsec_apply` (opt-in: add to `agents.list[].tools.allow` or `tools.allow`)
- **Command:** `/clawsec-scan` — instant scan without AI
- **CLI:** `openclaw clawsec-scan`, `openclaw clawsec-status`
- **Gateway RPC:** `clawsec.scan`, `clawsec.status`
- **Heartbeat:** optional background scans (config: `heartbeatIntervalSeconds`)
- **Prompt injection:** high risk score injected into agent context when > threshold

---

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Version + system hash |
| `/api/scan` | GET | Run full scan (all 5 agents) |
| `/api/heartbeat` | GET | Lightweight status ping |
| `/api/last-report` | GET | Cached result of last scan |
| `/api/reports` | GET | List all saved reports |
| `/api/reports/<file>` | GET | Fetch a specific report |
| `/api/apply/<id>` | POST | Apply remediation (token required) |
| `/api/config/<key>` | POST | Edit config file (token required) |

Auth tokens are auto-generated on first start:
- `~/.openclaw/workspace/clawsec/.clawsec_token` (base token)
- `~/.openclaw/workspace/clawsec/.clawsec_token.apply` (scoped apply token)
- `~/.openclaw/workspace/clawsec/.clawsec_token.config` (scoped config token)

---

## Auth flow test

Verify Apply auth (server must be running):

```bash
python3 scripts/tests/test_apply_auth.py
# Expected: All auth flow tests passed.
```

## Security regression check

Run the policy/allowlist drift check:

```bash
python3 scripts/tests/test_policy_consistency.py
```

This validates that scanner check IDs, remediation allowlists, and policy tiers stay in sync.

Verify install parity (repo files vs deployed files in `~/.openclaw`):

```bash
python3 scripts/tests/check_deployment_parity.py
```

---

## Security properties

- Backend binds to `127.0.0.1` only — no LAN exposure by default
- CORS restricted to explicit trusted origins (`http://127.0.0.1:8081`, `http://localhost:8081` by default)
- All `subprocess` calls use `shell=False`
- `checkId` validated against regex `^[a-z_]{1,64}$` + explicit allowlist
- `reports/` is gitignored and created with `chmod 700`
- `SOUL.md` and `CONSTRAINTS.md` are set to `chmod 444` (immutable)
- Auth token uses `hmac.compare_digest` for timing-safe comparison
- Operational logs never include token values or token previews

---

## OWASP coverage

| Check | OWASP LLM | OWASP ASI |
|---|---|---|
| `env_gitignore` | LLM02 Sensitive Information Disclosure | ASI04 Unsecured Credentials |
| `precommit_hook` | LLM02 Sensitive Information Disclosure | — |
| `breach_notification_procedure` | — | ASI06 Inadequate Incident Response |
| `runtime_package_install` | LLM05 Improper Output Handling | ASI02 Unauthorized Code Execution |
| `agent_communication_isolation` | LLM08 Excessive Agency | ASI03 Inadequate Sandboxing |
| `server_exposed` | — | ASI05 Excessive Permissions |
| `soul_writable` | LLM07 System Prompt Leakage | ASI01 Goal Hijacking |
| `gateway_exposed` | LLM08 Excessive Agency | ASI05 Excessive Permissions |
| `sessions_exposed` | LLM02 Sensitive Information Disclosure | — |
| `exec_security_full` | LLM08 Excessive Agency | ASI02 Unauthorized Code Execution |
| `dm_policy_open` | LLM01 Prompt Injection | ASI01 Goal Hijacking |
| `allowfrom_wildcard` | LLM08 Excessive Agency | ASI05 Excessive Permissions |
| `ssrf_protection_disabled` | LLM02 Sensitive Information Disclosure | ASI05 Excessive Permissions |
| `session_isolation` | LLM02 Sensitive Information Disclosure | ASI03 Inadequate Sandboxing |

Checks 10–13 map the [trust.openclaw.ai](https://trust.openclaw.ai) "Verify Your Setup" checklist — ClawSec automates the full official OpenClaw security verification.

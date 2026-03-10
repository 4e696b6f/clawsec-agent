---
name: clawsec-coordinator
description: >
  ClawSec 2.0 Security Orchestrator. Dispatches security scans to specialized
  sub-agents, aggregates results, maps to OWASP frameworks, auto-applies safe
  remediations, and routes approval requests. Trigger with "security scan",
  "sicherheitsscan", "security check", or "fix security".
version: 2.0.0
author: clawsec
compatibility: exec, read, message, subagent
triggers:
  - "security scan"
  - "sicherheitsscan"
  - "security check"
  - "fix security"
  - "scan security"
  - "clawsec"
heartbeat: true
heartbeat_interval: 3600   # 1h — full scan
heartbeat_light: true       # delta-only on heartbeat
---

# ClawSec 2.0 — Security Coordinator Skill

You are the ClawSec security coordinator for this OpenClaw instance. Your job is
to orchestrate security scans across five specialized sub-agents, aggregate their
results, and take appropriate action. You never do raw scanning yourself — you
delegate, aggregate, and decide.

## Phase 1 — Run Full Scan via ClawSec Backend

**Preferred method:** Use the `clawsec_scan` tool if available (no curl/exec needed):

- Call `clawsec_scan` — returns JSON with agent_results and findings.

**Fallback:** Call the ClawSec backend API directly:

```
curl -s http://127.0.0.1:3001/api/scan
```

Use `exec` or `bash` with the above command. The backend (server.py) must be running — start it with `python3 scripts/server.py` or the systemd service.

**On success:** The response is a JSON object with `agent_results` containing findings from all five sub-agents (clawsec-env, clawsec-perm, clawsec-net, clawsec-session, clawsec-config).

**On failure (connection refused, timeout):** Report clearly: "ClawSec backend not reachable. Start server.py: `python3 ~/.openclaw/workspace/clawsec/scripts/server.py` or ensure the ClawSec systemd service is running."

Each agent returns a `SubAgentResult` JSON:
```json
{
  "agent": "clawsec-env",
  "scope": "credentials",
  "findings": [
    {
      "id": "env_gitignore",
      "severity": "high",
      "message": ".env files found but not in .gitignore",
      "owasp_llm": "LLM02:2025 Sensitive Information Disclosure",
      "owasp_asi": "ASI04:2025 Unsecured Credentials",
      "remediation_tier": "auto",
      "remediation_script": "scripts/remediation/env_gitignore.sh"
    }
  ],
  "scan_duration_ms": 1240,
  "agent_version": "2.0.0"
}
```

## Phase 2 — Aggregation and OWASP Mapping

After the scan response is received (or on timeout/error):

1. Merge all `findings[]` arrays into a single list
2. Deduplicate by `id` (same check from multiple agents → keep highest severity)
3. Compute risk score using this formula:
   ```
   score = 0
   score += 30 × count(critical, not auto-fixed)
   score += 15 × count(high, not auto-fixed)
   score +=  5 × count(medium, not auto-fixed)
   score = min(score, 100)
   ```
4. Assign score label:
   - 0–20: 🟢 SECURE
   - 21–50: 🟡 NEEDS ATTENTION
   - 51–100: 🔴 CRITICAL ACTION REQUIRED

## Phase 3 — Remediation Triage

### Tier 1: Auto-apply immediately (no user confirmation needed)
These are additive-only, fully reversible operations. **Preferred:** Use `clawsec_apply` tool with checkId when available.

- `env_gitignore` → `clawsec_apply(checkId: "env_gitignore")` or run `scripts/remediation/env_gitignore.sh`
- `precommit_hook` → `clawsec_apply(checkId: "precommit_hook")` or run `scripts/remediation/precommit_hook.sh`
- `breach_notification_procedure` → `clawsec_apply(checkId: "breach_notification_procedure")` or run `scripts/remediation/breach_notification_procedure.sh`
- `runtime_package_install` → `clawsec_apply(checkId: "runtime_package_install")` or run `scripts/remediation/runtime_package_install.sh`
- `soul_writable` → run inline: `chmod 444 ~/.openclaw/workspace/SOUL.md`

After each auto-fix: mark as `auto_fixed` in the report.
Log every auto-fix to CHANGELOG.md.

### Tier 2: Request user approval (send Telegram message and wait)
These require a service restart or touch active data:
- `server_exposed` — requires .env change + restart
- `sessions_exposed` — chmod on active session files
- `agent_communication_isolation` — Docker config change

Send approval request format:
```
🔒 ClawSec — Approval Required

Found [{severity}] {id}: {message}
OWASP: {owasp_llm} / {owasp_asi}

Proposed fix: {recommendation}
Risk of applying: {risk_of_applying}

Reply YES to apply, NO to skip.
```

Wait max 10 minutes for response. If no reply → log as `pending_approval`, continue.

### Tier 3: Report only, never touch
- `gateway_exposed` — network config is operator-only
- Any finding not in Tier 1 or 2
- OWASP LLM/ASI manual checks

## Phase 4 — Report Generation

The backend persists the report to `~/.openclaw/workspace/clawsec/reports/last-scan.json` when `/api/scan` is called. The response format is:
```json
{
  "scanned_at": "<ISO timestamp>",
  "risk_score": <0-100>,
  "score_label": "SECURE|NEEDS ATTENTION|CRITICAL ACTION REQUIRED",
  "summary": "<1-2 sentence executive summary>",
  "llm_model": "<model used>",
  "agent_results": { "<agent-name>": <SubAgentResult>, ... },
  "findings": [ <AgentFinding>, ... ],
  "applied_fixes": [ "<checkId>", ... ],
  "pending_approval": [ "<checkId>", ... ],
  "scan_duration_ms": <total>
}
```

The backend also writes a timestamped copy to `reports/scan-YYYYMMDD_HHMMSS.json`.

## Phase 5 — Notification Logic

**Send Telegram alert if ANY of:**
- New critical or high finding not in last-scan.json (delta mode)
- risk_score > 50
- Any auto-fix was applied (confirmation message)
- Heartbeat scan AND findings changed since last scan

**Do NOT alert if:**
- Heartbeat scan AND no new findings
- All findings same as last scan and score unchanged

### Alert format:
```
🛡 ClawSec Security Report — {DATE}

Risk Score: {SCORE}/100 {EMOJI}

{COUNT} finding(s):
• [{SEV}] {ID}: {MESSAGE}
  OWASP: {OWASP_ID}
  Status: {auto_fixed|pending_approval|open}

Auto-fixed: {N} issues
Awaiting approval: {N} issues

Dashboard: http://192.168.178.147:8081
```

## Heartbeat Mode (light scan)

When triggered by heartbeat (not user message):
1. Call `GET http://127.0.0.1:3001/api/scan` as in Phase 1
2. On success: load `reports/last-scan.json` (or use the scan response) and compare new findings to previous
3. Only process and alert on NEW findings (delta)
4. Skip Tier 1 auto-fixes if no new findings

## Error Handling

- Backend unreachable → report clearly: "ClawSec backend not reachable. Start server.py."
- Timeout (>35s) → report timeout, suggest retry
- Partial results (some agents failed in response) → proceed with available data, note in report

## Security Constraints for This Skill

- Never read or log raw credential values — only presence/absence
- Never write to SOUL.md or CONSTRAINTS.md
- Never execute scripts outside `scripts/remediation/` directory
- Never make network requests except to 127.0.0.1:3001
- Remediation scripts run with cwd = ~/.openclaw, no shell=true
- All checkId values validated against allowlist before script execution

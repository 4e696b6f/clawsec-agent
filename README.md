# ClawSec 2.0 — Technical Specification

**Version:** 2.0.0
**Date:** 2026-03-09
**Status:** Development

---

## 1. Overview

ClawSec 2.0 shifts from a manual security checklist dashboard to an **autonomous, agent-native security scanner** for OpenClaw. 
The system scans the environment, maps findings to OWASP frameworks, auto-applies safe remediations, and integrates directly into the [USER-BOT] agent runtime as a skill.

### Design Principles

1. **Autonomous by default** — scan, analyze, fix without user input where safe
2. **OWASP-grounded** — every finding maps to LLM Top 10 v2.0 or ASI 2025
3. **Agent-native** — Kairos is the orchestrator, no separate LLM call needed
4. **Least privilege remediation** — tiered approval model; never auto-delete or restart
5. **Security of the scanner itself** — backend on loopback-only, CORS-restricted

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Kairos Agent Runtime                   │
│  ~/.openclaw/skills/clawsec/SKILL.md                   │
│  ─ Trigger: "security scan", heartbeat, on-change      │
│  ─ Model: claude-sonnet-4-6 (security reasoning)       │
│  ─ Output: Telegram alert + report file                │
└──────────────────────┬──────────────────────────────────┘
                       │ invokes
                       ▼
┌─────────────────────────────────────────────────────────┐
│             scan-environment.sh                         │
│  Collects raw facts — no LLM, no network, read-only    │
│  Output: JSON to stdout                                 │
└──────────────────────┬──────────────────────────────────┘
                       │ raw JSON
                       ▼
┌─────────────────────────────────────────────────────────┐
│             server.py  (127.0.0.1:3001)                │
│  /api/health       GET → version ping                  │
│  /api/scan         GET → runs scan-environment.sh      │
│  /api/checks       GET → auto-fixable check IDs        │
│  /api/apply/:id    POST → runs remediation script      │
│  /api/last-report  GET → cached reports/last-scan.json │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (same-host only)
                       ▼
┌─────────────────────────────────────────────────────────┐
│             React Dashboard  (port 8081)               │
│  useServer.js  → polls backend, stores scanData        │
│  useAudit.js   → syncFromScan() auto-updates checklist │
│  ScanResults   → risk chips with OWASP labels          │
│  SecurityDashboard → score ring, per-category view     │
└─────────────────────────────────────────────────────────┘
```

---

## 3. TypeScript Interfaces

### 3.1 Scan Output (from `scan-environment.sh`)

```typescript
/** Raw output from scan-environment.sh */
interface ScanOutput {
  version: "1";
  timestamp: string;           // ISO 8601
  project_root: string;

  detected: {
    // Standard checks
    env_files: string[];        // .env paths found
    mcp_servers: string[];      // MCP server names from config
    docker_compose: boolean;
    seccomp_profiles: string[]; // seccomp JSON profile paths
    security_md: boolean;
    python_middleware: boolean;
    github_actions: string[];   // workflow filenames
    agentshield_workflow: boolean;
    gitignore_env: boolean;
    precommit_hook: boolean;    // .git/hooks/pre-commit exists + executable

    // OpenClaw-specific (v2.0)
    server_binding: "exposed" | "localhost" | "offline";
    soul_permissions: string;   // e.g. "444", "664", "missing", "unknown"
    gateway_binding: "loopback" | "any" | "unknown";
    sessions_readable: "protected" | "world_readable" | "none";
  };

  risks: ScanRisk[];
}

interface ScanRisk {
  id: CheckId;
  severity: Severity;
  message: string;
  owasp?: string;   // e.g. "ASI05:2025 Excessive Permissions"
}
```

### 3.2 Check IDs

```typescript
/** All check IDs known to the system */
type CheckId =
  // Standard checks
  | "env_gitignore"
  | "precommit_hook"
  | "breach_notification_procedure"
  | "runtime_package_install"
  | "agent_communication_isolation"
  // OpenClaw-specific (v2.0)
  | "server_exposed"
  | "soul_writable"
  | "gateway_exposed"
  | "sessions_exposed"
  // OWASP LLM framework checks (manual)
  | `llm${string}`
  // OWASP ASI framework checks (manual)
  | `asi${string}`;

/** Check IDs that have automated remediation scripts */
type AutoFixableCheckId =
  | "env_gitignore"
  | "precommit_hook"
  | "breach_notification_procedure"
  | "agent_communication_isolation"
  | "runtime_package_install";

/** Check IDs that the bash scanner evaluates automatically */
type ScanCoveredCheckId =
  | "env_gitignore"
  | "precommit_hook"
  | "breach_notification_procedure"
  | "runtime_package_install"
  | "agent_communication_isolation";

type Severity = "critical" | "high" | "medium" | "low" | "info";
```

### 3.3 Audit State (localStorage)

```typescript
/** Persisted audit state in localStorage key "openclaw-audit" */
interface AuditState {
  framework: FrameworkId | null;
  startedAt: string | null;   // ISO 8601
  checked: CheckId[];         // IDs that are passing (checked off)
  findings: Record<CheckId, Finding>;
}

type FrameworkId = "custom" | "asi" | "llm";

interface Finding {
  fixedAt?: string;
  notes?: string;
}

const INITIAL_AUDIT: AuditState = {
  framework: null,
  startedAt: null,
  checked: [],
  findings: {},
};
```

### 3.4 Audit Report (export format)

```typescript
/** Signed audit report for export / sharing */
interface AuditReport {
  audit_id: string;            // "audit_2026-03-09T..."
  timestamp: string;
  framework: FrameworkId;
  started_at: string;
  summary: {
    total_checks: number;
    passed: number;
    open: number;
    score_percentage: number;  // 0-100
    severity_breakdown: Record<Severity, { passed: number; open: number }>;
  };
  checks: ReportCheck[];
  signature: {
    hash: `sha256:${string}`;
    signed_at: string;
  };
}

interface ReportCheck {
  check_id: CheckId;
  label: string;
  framework: FrameworkId | "custom";
  severity: Severity;
  status: "PASSED" | "OPEN";
  finding?: Finding;
}
```

### 3.5 Server API Types

```typescript
/** GET /api/health */
interface HealthResponse {
  status: "ok";
  version: string;  // e.g. "1.1"
}

/** GET /api/scan → ScanOutput (see 3.1) */

/** GET /api/checks */
interface ChecksResponse {
  auto_fixable: AutoFixableCheckId[];
}

/** GET /api/last-report → ScanOutput | ErrorResponse */

/** POST /api/apply/:checkId */
interface ApplyResponse {
  success: boolean;
  already_done: boolean;
  check_id: CheckId;
  output: string;      // stdout + stderr, max 1000 chars
  exit_code: number;   // 0=applied, 1=already_done, 2+=error
}

interface ErrorResponse {
  error: string;
}
```

### 3.6 Kairos Skill — Agent Security Report

```typescript
/** Structured security report produced by Kairos via ClawSec skill */
interface AgentSecurityReport {
  scanned_at: string;           // ISO 8601
  risk_score: number;           // 0-100, see scoring formula
  summary: string;              // 1-2 sentence executive summary
  llm_model: string;            // e.g. "claude-sonnet-4-6"

  findings: AgentFinding[];
  applied_fixes: AutoFixableCheckId[];
  pending_approval: CheckId[];  // need Piki's approval before fixing
  scan_raw: ScanOutput;
}

interface AgentFinding {
  id: CheckId;
  severity: Severity;
  message: string;
  owasp_llm: string | null;    // e.g. "LLM02:2025 Sensitive Information Disclosure"
  owasp_asi: string | null;    // e.g. "ASI04:2025 Unsecured Credentials"
  status: "open" | "auto_fixed" | "needs_approval" | "false_positive";
  recommendation: string;
}
```

### 3.7 React Hook Return Types

```typescript
/** useAudit() return type */
interface UseAuditReturn {
  audit: AuditState;
  checkedSet: ReadonlySet<CheckId>;
  setFramework: (framework: FrameworkId) => void;
  toggleCheck: (id: CheckId) => void;
  resetAudit: () => void;
  syncFromScan: (riskIds: ReadonlySet<CheckId>, coveredIds: ReadonlySet<CheckId>) => void;
  getAuditJSON: (checks: Check[]) => Promise<AuditReport>;
}

/** useServer() return type */
interface UseServerReturn {
  serverOnline: boolean;
  scanning: boolean;
  scanData: ScanOutput | null;
  autoFixable: AutoFixableCheckId[];
  applyFix: (checkId: AutoFixableCheckId) => Promise<void>;
  applyStatus: Record<CheckId, ApplyStatus>;
  triggerScan: () => Promise<void>;
}

type ApplyStatus = "idle" | "applying" | "success" | "already_done" | `error: ${string}`;

/** useScan() return type (localStorage-based, legacy) */
interface UseScanReturn {
  scanData: ScanOutput | null;
  isRisk: (checkId: CheckId) => boolean;
  clearScan: () => void;
}
```

### 3.8 Check Definition (from checks.js / checks-asi.js / checks-llm.js)

```typescript
interface Check {
  id: CheckId;
  category: string;
  label: string;
  description: string;
  severity: Severity;
  phase: "dev" | "ci" | "runtime";
  framework: FrameworkId | "custom";
  stage: "input" | "output" | "ci" | "runtime";
  guide: {
    steps: string[];
    code: string;
    file: string;
    tips?: string[];
  };
  validation: {
    checklist: string[];
    script: string;
  };
}
```

---

## 4. OWASP Mapping

### 4.1 Auto-Detected Findings → OWASP

| Check ID | OWASP LLM Top 10 v2.0 | OWASP ASI 2025 |
|---|---|---|
| `env_gitignore` | LLM02: Sensitive Information Disclosure | ASI04: Unsecured Credentials |
| `precommit_hook` | LLM02: Sensitive Information Disclosure | — |
| `breach_notification_procedure` | — | ASI06: Inadequate Incident Response |
| `runtime_package_install` | LLM05: Improper Output Handling | ASI02: Unauthorized Code Execution |
| `agent_communication_isolation` | LLM08: Excessive Agency | ASI03: Inadequate Sandboxing |
| `server_exposed` | — | ASI05: Excessive Permissions |
| `soul_writable` | LLM07: System Prompt Leakage | ASI01: Goal Hijacking |
| `gateway_exposed` | LLM06: Excessive Agency | ASI05: Excessive Permissions |
| `sessions_exposed` | LLM02: Sensitive Information Disclosure | — |

### 4.2 Risk Score Formula

```
score = 0
score += 30 × count(critical findings not auto-fixed)
score += 15 × count(high findings not auto-fixed)
score +=  5 × count(medium findings not auto-fixed)
score = min(score, 100)
```

Score thresholds:
- **0–20**: Green — well secured
- **21–50**: Yellow — improvement needed
- **51–100**: Red — critical action required

---

## 5. Remediation Tier Model

```typescript
type RemediationTier = "auto" | "approval" | "never";

interface RemediationRule {
  checkId: CheckId;
  tier: RemediationTier;
  reason: string;
  script?: string;   // path relative to clawsec root, if exists
}

const REMEDIATION_RULES: RemediationRule[] = [
  // Tier 1: Auto-apply (additive only, fully reversible)
  { checkId: "env_gitignore",                  tier: "auto",     reason: "Additive .gitignore entries, no data loss", script: "scripts/remediation/env_gitignore.sh" },
  { checkId: "precommit_hook",                 tier: "auto",     reason: "Copies file, chmod +x, no system changes",  script: "scripts/remediation/precommit_hook.sh" },
  { checkId: "breach_notification_procedure",  tier: "auto",     reason: "Creates new file, idempotent",              script: "scripts/remediation/breach_notification_procedure.sh" },
  { checkId: "runtime_package_install",        tier: "auto",     reason: "Creates CI workflow file",                  script: "scripts/remediation/runtime_package_install.sh" },
  { checkId: "soul_writable",                  tier: "auto",     reason: "chmod 444 is safe; file remains readable",  script: undefined },  // inline: chmod 444

  // Tier 2: Approval required
  { checkId: "server_exposed",                 tier: "approval", reason: "Requires .env write + service restart" },
  { checkId: "sessions_exposed",               tier: "approval", reason: "chmod on active session files is risky" },
  { checkId: "agent_communication_isolation",  tier: "approval", reason: "Docker config — affects production services" },

  // Tier 3: Never auto-apply
  { checkId: "gateway_exposed",                tier: "never",    reason: "Network config change — operator decision only" },
];
```

---

## 6. File Structure

```
workspace/clawsec/
├── scripts/
│   ├── scan-environment.sh          # Raw scanner — outputs JSON, read-only
│   ├── server.py                    # HTTP backend (127.0.0.1:3001 default)
│   ├── pre-commit-secret-scan.sh   # Pre-commit secret scanner hook
│   └── remediation/
│       ├── env_gitignore.sh         # Fix: add .env to .gitignore
│       ├── precommit_hook.sh        # Fix: install pre-commit hook (path-safe)
│       ├── breach_notification_procedure.sh  # Fix: create SECURITY.md
│       ├── runtime_package_install.sh        # Fix: create AgentShield CI workflow
│       └── agent_communication_isolation.sh  # Advisory: verify seccomp setup
├── src/
│   ├── components/
│   │   ├── SecurityDashboard.jsx    # Main view — syncs scan → checklist
│   │   ├── ScanResults.jsx          # Risk banner with OWASP chips
│   │   ├── CheckItem.jsx
│   │   ├── ScoreRing.jsx
│   │   ├── AuditReport.jsx
│   │   ├── InjectionSimulator.jsx
│   │   └── WelcomeScreen.jsx
│   ├── hooks/
│   │   ├── useAudit.js              # Audit state + syncFromScan()
│   │   ├── useServer.js             # Backend connection + scan trigger
│   │   ├── useScan.js               # localStorage scan (legacy)
│   │   └── useLocalStorage.js
│   ├── data/
│   │   ├── checks.js                # Custom checks (secrets, auth, sandbox...)
│   │   ├── checks-asi.js            # OWASP ASI 2025 checks
│   │   └── checks-llm.js            # OWASP LLM Top 10 v2.0 checks
│   └── utils/
│       ├── score.js                 # computeScore(), SEVERITY_WEIGHTS
│       └── clipboard.js
├── reports/
│   ├── last-scan.json               # Always-current scan report (gitignored)
│   └── scan-YYYYMMDD_HHMMSS.json   # Historical reports (gitignored)
├── docker/
│   ├── seccomp-agent.json
│   ├── seccomp-orchestrator.json
│   └── docker-compose.security.yml
├── middleware/
│   └── security_middleware.py       # Input validation, canary tokens, redaction
└── CLAWSEC20.md                     # This file

~/.openclaw/skills/clawsec/
└── SKILL.md                         # Kairos security skill definition
```

---

## 7. Server API Specification

**Base URL:** `http://127.0.0.1:3001` (localhost only by default)
**CORS:** Allowed origins — `localhost`, `127.0.0.1`, RFC 1918 private ranges

### Endpoints

#### `GET /api/health`
```
Response 200:
{
  "status": "ok",
  "version": "1.1"
}
```

#### `GET /api/scan`
Runs `scripts/scan-environment.sh $TARGET_DIR`. Timeout: 30s.

```
Response 200: ScanOutput (see 3.1)
Response 500: { "error": string, "stderr": string }
Response 504: { "error": "Scan timed out after 30s" }
```

#### `GET /api/checks`
```
Response 200:
{
  "auto_fixable": ["env_gitignore", "precommit_hook", "breach_notification_procedure",
                   "agent_communication_isolation", "runtime_package_install"]
}
```

#### `GET /api/last-report`
Returns cached `reports/last-scan.json` without re-running the scan.

```
Response 200: ScanOutput
Response 404: { "error": "No scan report yet. Run /api/scan first." }
Response 500: { "error": string }
```

#### `POST /api/apply/:checkId`
Runs `scripts/remediation/:checkId.sh`. `checkId` must be in the allowlist.
Scripts run with `cwd = $TARGET_DIR` (defaults to `~/.openclaw`).

```
Path param: checkId — validated against [a-z_]{1,64} AND allowlist
Response 200: ApplyResponse (success or already_done)
Response 400: { "error": string, "auto_fixable": string[] }
Response 404: { "error": "Remediation script not found" }
Response 504: { "error": "Remediation script timed out: {checkId}" }
Response 500: ApplyResponse (success: false)
```

#### `OPTIONS *`
CORS preflight — 204 with CORS headers.

---

## 8. Scanner Specification (`scan-environment.sh`)

**Contract:** Read-only. No curl, wget, rm, eval, exec. No network access.
**Input:** `$1` = TARGET_DIR (defaults to `~HOME/.openclaw`)
**Output:** JSON to stdout. Errors to stderr.
**Exit codes:** 0 = success, 1 = cannot access TARGET_DIR

### Checks

| Field | Detection Method |
|---|---|
| `env_files` | `find . -maxdepth 3 -name ".env*"` (excluding examples/templates) |
| `mcp_servers` | grep `mcpServers` from Claude config files |
| `docker_compose` | `find . -maxdepth 3 -name "docker-compose*.yml"` |
| `seccomp_profiles` | `find . -maxdepth 4 -name "seccomp*.json"` |
| `security_md` | `test -f SECURITY.md` |
| `python_middleware` | `test -f middleware/security_middleware.py` |
| `github_actions` | `find .github/workflows -name "*.yml"` |
| `agentshield_workflow` | `test -f .github/workflows/agentshield.yml` |
| `gitignore_env` | `grep -qE '^\s*\.env' .gitignore` |
| `precommit_hook` | `test -x .git/hooks/pre-commit` |
| `server_binding` | `ss -tlnp \| grep :3001` → `exposed`/`localhost`/`offline` |
| `soul_permissions` | `stat -c '%a' ~/.openclaw/workspace/SOUL.md` |
| `gateway_binding` | `jq .gateway.bind ~/.openclaw/openclaw.json` |
| `sessions_readable` | `find sessions -name "*.jsonl" -perm /o=r` |

### Risk Emission Rules

```bash
# env_gitignore: only if .env files exist AND .gitignore doesn't exclude them
[[ "$ENV_FILES" != "[]" && "$GITIGNORE_ENV" == "false" ]]

# precommit_hook: always if no executable hook
[[ "$PRECOMMIT" == "false" ]]

# breach_notification_procedure: always if SECURITY.md missing
[[ "$SECURITY_MD" == "false" ]]

# runtime_package_install: always if AgentShield workflow missing
[[ "$AGENTSHIELD" == "false" ]]

# agent_communication_isolation: always if no seccomp profiles
[[ "$SECCOMP_PROFILES" == "[]" ]]

# server_exposed: only if listening on 0.0.0.0
[[ "$SERVER_BINDING" == "exposed" ]]

# soul_writable: if permissions are not 444 (and file exists)
[[ "$SOUL_PERMS" != "444" && "$SOUL_PERMS" != "missing" && "$SOUL_PERMS" != "unknown" ]]

# gateway_exposed: if gateway not on loopback
[[ "$GATEWAY_BINDING" != "loopback" && "$GATEWAY_BINDING" != "unknown" ]]

# sessions_exposed: if any session file is world-readable
[[ "$SESSIONS_READABLE" == "world_readable" ]]
```

---

## 9. Kairos Skill Specification

**Path:** `~/.openclaw/skills/clawsec/SKILL.md`
**Trigger phrases:** "security scan", "sicherheitsscan", "security check", "fix security"
**Recommended model:** `claude-sonnet-4-6` (security reasoning requires strong model)
**Compatibility:** exec, read, write, edit, message

### Skill Phases

```
Phase 1: Raw Scan
  bash scan-environment.sh ~/.openclaw
  → ScanOutput JSON

Phase 2: OpenClaw-specific manual checks (not in bash scanner)
  A. Server binding check (ss -tlnp | grep 3001)
  B. SOUL.md permissions (ls -la SOUL.md)
  C. Token exposure in process list (ps aux | grep -E "API_KEY|TOKEN")
  D. Gateway auth verification (parse openclaw.json)
  E. Session log permissions (ls -la sessions/)

Phase 3: OWASP Analysis
  Map all findings to LLM Top 10 v2.0 + ASI 2025 table
  Compute risk score (formula in section 4.2)

Phase 4: Remediation (tiered — see section 5)
  Auto-apply: env_gitignore, precommit_hook, breach_notification_procedure, soul_writable
  Ask Piki: server_exposed, sessions_exposed
  Never: gateway changes, credential rotation, service restarts

Phase 5: Report
  Write JSON to clawsec/reports/last-scan.json
  Copy to reports/scan-{timestamp}.json
  If risk_score > 50 or any critical: send Telegram alert

Phase 6: Heartbeat mode (light scan)
  Only run if triggered by heartbeat
  Compare new risks against last-scan.json
  Alert only on NEW critical/high findings (delta check)
```

### Telegram Alert Format

```
Security Alert — {DATE}

{COUNT} finding(s) detected:
• [{SEVERITY}] {ID}: {MESSAGE}
  OWASP: {OWASP_ID}
  Fix: {RECOMMENDATION}

Risk Score: {SCORE}/100 ({GREEN|YELLOW|RED})
Dashboard: http://192.168.178.147:8081
```

---

## 10. Frontend Sync Mechanism

### Problem (v1.0)
`useServer.js` stored scan data in state. `useAudit.js` managed checklist state independently via localStorage. The two were never connected — scan results had no effect on the audit checklist.

### Solution (v2.0)

```typescript
// SecurityDashboard.jsx — after all hooks (Rules of Hooks compliance)

const SCAN_COVERED_IDS = new Set<ScanCoveredCheckId>([
  "env_gitignore", "precommit_hook", "breach_notification_procedure",
  "runtime_package_install", "agent_communication_isolation",
]);

useEffect(() => {
  if (!scanData?.risks || !audit.framework) return;
  const riskIds = new Set(scanData.risks.map((r) => r.id));
  syncFromScan(riskIds, SCAN_COVERED_IDS);
}, [scanData]);
```

```typescript
// useAudit.js — syncFromScan implementation

const syncFromScan = (riskIds: ReadonlySet<string>, coveredIds: ReadonlySet<string>) => {
  setAudit((prev) => {
    const next = new Set(prev.checked);
    let changed = false;
    for (const id of coveredIds) {
      if (riskIds.has(id)) {
        // Scanner confirmed risk → uncheck (not passing)
        if (next.has(id)) { next.delete(id); changed = true; }
      } else {
        // Scanner found no risk → auto-check (passing)
        if (!next.has(id)) { next.add(id); changed = true; }
      }
    }
    return changed ? { ...prev, checked: Array.from(next) } : prev;
  });
};
```

**Invariant:** Only `SCAN_COVERED_IDS` are auto-updated. All other checks (OWASP LLM, ASI framework checks) remain under manual user control.

---

## 11. Security Properties of the Scanner Itself

| Property | Implementation |
|---|---|
| Backend bind | `127.0.0.1:3001` (default) — not accessible from LAN |
| CORS | RFC 1918 private IPs + localhost only; public IPs rejected |
| checkId validation | `re.match(r"^[a-z_]{1,64}$")` + explicit allowlist |
| subprocess | `shell=False` — no shell injection possible |
| Script timeout | 30s per subprocess call |
| LAN exposure override | `OPENCLAW_HOST=0.0.0.0` env var (explicit opt-in) |
| Report storage | `reports/` in project dir, gitignored |
| SOUL.md | `chmod 444` — immutable agent identity |

---

## 12. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_HOST` | `127.0.0.1` | Backend bind address |
| `OPENCLAW_PORT` | `3001` | Backend port |
| `OPENCLAW_TARGET_DIR` | `~/.openclaw` | Directory the scanner evaluates |

---

## 13. Remediation Script Contract

All scripts in `scripts/remediation/`:

```bash
# Exit codes (contract):
# 0 = fix applied successfully
# 1 = already done, nothing changed
# 2 = error (see stderr)

# Environment:
# cwd = $TARGET_DIR (default: ~/.openclaw), set by server.py

# Path resolution:
# Use ${BASH_SOURCE[0]} for absolute self-location
# Never rely on relative paths from cwd for source files
```

---

## 14. Known Limitations (v2.0)

| Limitation | Impact | Planned Fix |
|---|---|---|
| LLM not integrated in server-side scan | Scan is rule-based, not semantic | Agent skill handles LLM analysis |
| Server restart needed after HOST fix | Old server still on 0.0.0.0 during session | Manual: restart server.py |
| precommit_hook installs into cwd git repo | Installs into `.openclaw` repo, not project repos | Per-project installation flow needed |
| No scan history retention | Only last-scan.json kept by API | Timestamped reports exist in reports/ dir |
| AgentShield CI check context-specific | clawsec itself has the workflow, ~/.openclaw doesn't | Separate check per target type |

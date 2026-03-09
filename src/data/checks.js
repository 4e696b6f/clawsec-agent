/**
 * ClawSec 2.0 — Custom Check Definitions
 *
 * These are checks beyond the OWASP LLM Top 10 and ASI 2025 frameworks,
 * specific to OpenClaw runtime security.
 *
 * Used by: SecurityDashboard, CheckItem, AuditReport, useAudit
 * Related framework files: checks-asi.js, checks-llm.js
 */

export const CUSTOM_CHECKS = [
  // ── Credentials & Secrets ────────────────────────────────────────────────

  {
    id: "env_gitignore",
    category: "Credentials",
    label: ".env Files in Git",
    description:
      ".env files containing API keys or tokens were found but are not excluded from git. " +
      "A single commit with credentials can expose secrets permanently in git history.",
    severity: "high",
    phase: "dev",
    framework: "custom",
    stage: "ci",
    guide: {
      steps: [
        "Check: find ~/.openclaw -name '.env*' -not -name '*.example'",
        "Add to .gitignore: echo '.env\\n.env.*' >> .gitignore",
        "Or via ClawSec API: POST /api/apply/env_gitignore",
      ],
      code: "echo '.env\\n.env.*\\n!.env.example' >> .gitignore",
      file: ".gitignore",
      tips: [".env.example files are safe to commit (no real values)"],
    },
    validation: {
      checklist: [".env* patterns present in .gitignore"],
      script: "grep -qE '^\\s*\\.env' .gitignore",
    },
  },

  {
    id: "precommit_hook",
    category: "Credentials",
    label: "Pre-commit Secret Scanner",
    description:
      "No executable pre-commit hook is installed. Without a hook, credentials and tokens " +
      "can be committed to git without any automated warning.",
    severity: "medium",
    phase: "dev",
    framework: "custom",
    stage: "ci",
    guide: {
      steps: [
        "Check: test -x .git/hooks/pre-commit && echo 'present' || echo 'missing'",
        "Install via ClawSec: POST /api/apply/precommit_hook",
      ],
      code: "chmod +x .git/hooks/pre-commit",
      file: ".git/hooks/pre-commit",
    },
    validation: {
      checklist: [".git/hooks/pre-commit exists and is executable"],
      script: "test -x .git/hooks/pre-commit",
    },
  },

  // ── Permissions ──────────────────────────────────────────────────────────

  {
    id: "workspace_permissions",
    category: "Permissions",
    label: "Workspace Directory Permissions",
    description:
      "The OpenClaw workspace directory (~/.openclaw/workspace/) should not be readable by " +
      "other users on the system. It contains SOUL.md, CONSTRAINTS.md, and agent identity " +
      "files that define the agent's behavior and security constraints.",
    severity: "medium",
    phase: "runtime",
    framework: "custom",
    stage: "runtime",
    guide: {
      steps: [
        "Check: stat -c '%a' ~/.openclaw/workspace",
        "Apply: chmod 750 ~/.openclaw/workspace",
        "Or via ClawSec API: POST /api/apply/workspace_permissions",
      ],
      code: "chmod 750 ~/.openclaw/workspace",
      file: "~/.openclaw/workspace",
      tips: [
        "750 = owner: full access, group: read+execute, others: nothing",
        "700 is also acceptable (more restrictive)",
      ],
    },
    validation: {
      checklist: ["workspace directory is 750 or stricter"],
      script: "stat -c '%a' ~/.openclaw/workspace | grep -qE '^(700|750)$'",
    },
  },

  {
    id: "config_exposed",
    category: "Permissions",
    label: "openclaw.json Permissions",
    description:
      "openclaw.json may contain API keys, gateway tokens, channel credentials, and " +
      "MCP server configuration. World-readable permissions expose this data to all " +
      "local users on the system.",
    severity: "medium",
    phase: "runtime",
    framework: "custom",
    stage: "runtime",
    guide: {
      steps: [
        "Check: stat -c '%a' ~/.openclaw/openclaw.json",
        "Apply: chmod 640 ~/.openclaw/openclaw.json",
        "Note: Tier 'never' — apply manually, service restart not required",
      ],
      code: "chmod 640 ~/.openclaw/openclaw.json",
      file: "~/.openclaw/openclaw.json",
      tips: [
        "640 = owner: read+write, group: read, others: nothing",
        "600 is also acceptable (most restrictive)",
        "This is a Tier 'never' finding — apply manually after review",
      ],
    },
    validation: {
      checklist: ["openclaw.json is 640 or stricter"],
      script: "stat -c '%a' ~/.openclaw/openclaw.json | grep -qE '^(600|640)$'",
    },
  },

  // ── Agent Isolation ──────────────────────────────────────────────────────

  {
    id: "agent_communication_isolation",
    category: "Sandboxing",
    label: "Agent Communication Isolation (seccomp)",
    description:
      "No seccomp syscall filter profiles were found. Without seccomp, agent containers " +
      "run with the full host syscall surface, allowing potential privilege escalation.",
    severity: "medium",
    phase: "runtime",
    framework: "custom",
    stage: "runtime",
    guide: {
      steps: [
        "Check: find ~/.openclaw -name 'seccomp*.json'",
        "Apply ClawSec's seccomp profiles from docker/ directory",
        "Requires Docker — approval needed before applying",
      ],
      code: "docker run --security-opt seccomp=docker/seccomp-agent.json ...",
      file: "docker/seccomp-agent.json",
      tips: [
        "Tier 'approval' — Docker config change affects running containers",
      ],
    },
    validation: {
      checklist: ["seccomp*.json profile(s) present", "Docker using profile"],
      script: "find ~/.openclaw -name 'seccomp*.json' | grep -q .",
    },
  },

  // ── Incident Response ────────────────────────────────────────────────────

  {
    id: "breach_notification_procedure",
    category: "Incident Response",
    label: "Breach Notification Procedure",
    description:
      "No SECURITY.md file was found. Without a documented breach response procedure, " +
      "there is no defined process for handling security incidents in the OpenClaw environment.",
    severity: "medium",
    phase: "dev",
    framework: "custom",
    stage: "ci",
    guide: {
      steps: [
        "Create SECURITY.md with breach reporting contacts and response timeline",
        "Or via ClawSec: POST /api/apply/breach_notification_procedure",
      ],
      code: "# ClawSec will create a SECURITY.md template automatically",
      file: "SECURITY.md",
    },
    validation: {
      checklist: ["SECURITY.md exists"],
      script: "test -f ~/.openclaw/SECURITY.md",
    },
  },

  // ── Network / Gateway ────────────────────────────────────────────────────

  {
    id: "gateway_exposed",
    category: "Network",
    label: "OpenClaw Gateway Binding",
    description:
      "The OpenClaw gateway is bound to 0.0.0.0, making the Control Plane reachable " +
      "from any device on the local network without authentication. " +
      "Binding to 127.0.0.1 restricts access to the local machine only. " +
      "Safe for all channel connections (Telegram, WhatsApp, Slack) — they use external webhooks.",
    severity: "critical",
    phase: "runtime",
    framework: "custom",
    stage: "runtime",
    guide: {
      steps: [
        "Apply via ClawSec API: POST /api/apply/gateway_exposed",
        "Or manually: edit ~/.openclaw/openclaw.json → gateway.bind: '127.0.0.1'",
        "Then restart: openclaw gateway restart",
      ],
      code: "# In ~/.openclaw/openclaw.json:\n{ \"gateway\": { \"bind\": \"127.0.0.1\" } }",
      file: "~/.openclaw/openclaw.json",
      tips: [
        "Tier 'approval' — requires openclaw gateway restart after change",
        "Channel connections reconnect automatically via external webhooks",
      ],
    },
    validation: {
      checklist: ["gateway.bind is 127.0.0.1 or localhost"],
      script:
        "python3 -c \"import json; d=json.load(open(open.__module__)); exit(0 if d.get('gateway',{}).get('bind','') in ['127.0.0.1','localhost','::1'] else 1)\" ~/.openclaw/openclaw.json",
    },
  },

  // ── Session Isolation ─────────────────────────────────────────────────────

  {
    id: "session_isolation",
    category: "Sandboxing",
    label: "Session Storage Isolation",
    description:
      "All channel sessions (Telegram, WhatsApp, Slack, etc.) are stored flat in a single " +
      "sessions/ directory without per-channel or per-user subdirectories. " +
      "This violates ASI03 — a compromised agent could access sessions from other channels.",
    severity: "medium",
    phase: "runtime",
    framework: "custom",
    stage: "runtime",
    guide: {
      steps: [
        "Check: find ~/.openclaw/sessions -maxdepth 1 -name '*.jsonl' | wc -l",
        "Isolated = subdirs per channel (e.g. sessions/telegram/, sessions/whatsapp/)",
        "Note: Tier 'never' — session layout is an OpenClaw architecture decision",
      ],
      code: "# Advisory only — contact OpenClaw maintainers for per-channel isolation",
      file: "~/.openclaw/sessions/",
      tips: [
        "This is advisory — ClawSec documents the finding, cannot auto-fix",
      ],
    },
    validation: {
      checklist: ["sessions/ contains per-channel subdirectories"],
      script:
        "find ~/.openclaw/sessions -mindepth 1 -maxdepth 1 -type d | grep -q .",
    },
  },

  // ── Inter-Agent Auth ──────────────────────────────────────────────────────

  {
    id: "inter_agent_auth",
    category: "Authentication",
    label: "Inter-Agent HTTP Authentication",
    description:
      "ClawSec's HTTP backend must require authentication for mutating endpoints " +
      "(/api/apply/) to prevent unauthorized local processes from triggering remediations. " +
      "Without a shared secret token, any local process can apply arbitrary remediations.",
    severity: "medium",
    phase: "runtime",
    framework: "custom",
    stage: "runtime",
    guide: {
      steps: [
        "ClawSec 2.0 auto-generates a token on server start at .clawsec_token (chmod 600)",
        "All POST /api/apply/ calls require: X-ClawSec-Token: <token>",
        "Read token: cat ~/.openclaw/workspace/clawsec/.clawsec_token",
        "Resolved automatically when running server.py v2.0+",
      ],
      code: "curl -X POST http://127.0.0.1:3001/api/apply/precommit_hook \\\n  -H \"X-ClawSec-Token: $(cat ~/.openclaw/workspace/clawsec/.clawsec_token)\"",
      file: "~/.openclaw/workspace/clawsec/.clawsec_token",
      tips: [
        "Token stored at chmod 600 — only readable by the server process owner",
        "GET endpoints (health, scan, reports) remain open — read-only, no risk",
      ],
    },
    validation: {
      checklist: [".clawsec_token exists with 600 permissions"],
      script:
        "test -f ~/.openclaw/workspace/clawsec/.clawsec_token && stat -c '%a' ~/.openclaw/workspace/clawsec/.clawsec_token | grep -q '^600$'",
    },
  },

  // ── OpenClaw Trust Framework Checks (trust.openclaw.ai) ─────────────────

  {
    id: "exec_security_full",
    category: "Access Control",
    label: "Exec Security: Full Access Mode",
    description:
      "openclaw.json has exec_security set to 'full', meaning the agent can execute any " +
      "shell command without approval. This is the most dangerous configuration — any prompt " +
      "injection or indirect injection can run arbitrary code on the host machine. " +
      "OpenClaw's secure default is 'deny' with allowlist.",
    severity: "high",
    phase: "runtime",
    framework: "openclaw-trust",
    stage: "runtime",
    guide: {
      steps: [
        "Edit ~/.openclaw/openclaw.json: set exec_security to 'deny'",
        "Add trusted commands to the exec allowlist individually",
        "Restart: openclaw gateway restart",
        "Verify: openclaw security audit --deep",
      ],
      code: "# In ~/.openclaw/openclaw.json:\n{ \"exec_security\": \"deny\", \"exec_allowlist\": [\"git\", \"ls\", \"cat\"] }",
      file: "~/.openclaw/openclaw.json",
      tips: [
        "Tier 'never' — requires careful review of which commands you actually need",
        "OpenClaw defaults to 'deny' — 'full' is an explicit opt-in that should be reviewed",
      ],
    },
    validation: {
      checklist: ["exec_security is 'deny' or not set to 'full'"],
      script: "python3 -c \"import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); exit(0 if d.get('exec_security','deny') not in ['full','allow','true'] else 1)\"",
    },
  },

  {
    id: "dm_policy_open",
    category: "Access Control",
    label: "DM Policy: Open (No Pairing Required)",
    description:
      "The DM policy is set to 'open', meaning any sender on any channel can interact with " +
      "the agent without a pairing flow. This is a critical prompt injection risk — " +
      "attackers can DM the agent directly and manipulate it. " +
      "OpenClaw's secure default is 'pairing' (unknown senders complete a one-time code flow).",
    severity: "high",
    phase: "runtime",
    framework: "openclaw-trust",
    stage: "runtime",
    guide: {
      steps: [
        "Edit ~/.openclaw/openclaw.json: set dm_policy to 'pairing' or 'allowlist'",
        "Restart: openclaw gateway restart",
        "Existing paired senders are not affected by this change",
      ],
      code: "# In ~/.openclaw/openclaw.json:\n{ \"dm_policy\": \"pairing\" }",
      file: "~/.openclaw/openclaw.json",
      tips: [
        "Tier 'never' — operator decision, requires restart",
        "'pairing' = unknown senders complete one-time code flow (recommended)",
        "'allowlist' = only explicitly listed senders can interact (most restrictive)",
      ],
    },
    validation: {
      checklist: ["dm_policy is 'pairing' or 'allowlist'"],
      script: "python3 -c \"import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); exit(0 if d.get('dm_policy','pairing') in ['pairing','allowlist'] else 1)\"",
    },
  },

  {
    id: "allowfrom_wildcard",
    category: "Access Control",
    label: "allowFrom: Wildcard Configuration",
    description:
      "allowFrom is set to wildcard ('*' or 'all'), granting any sender on any channel " +
      "full access to the agent. Combined with dm_policy 'pairing', this means any paired " +
      "sender can trigger any tool. Explicit sender IDs are strongly recommended.",
    severity: "high",
    phase: "runtime",
    framework: "openclaw-trust",
    stage: "runtime",
    guide: {
      steps: [
        "Edit ~/.openclaw/openclaw.json: replace allowFrom wildcard with explicit sender IDs",
        "Example: allowFrom: [\"+491701234567\"] for WhatsApp/Telegram phone number",
        "Restart: openclaw gateway restart",
      ],
      code: "# In ~/.openclaw/openclaw.json:\n{ \"allowFrom\": [\"+491701234567\", \"your-discord-id\"] }",
      file: "~/.openclaw/openclaw.json",
      tips: [
        "Tier 'never' — operator must know their own sender IDs",
        "Find your Telegram ID: message @userinfobot",
      ],
    },
    validation: {
      checklist: ["allowFrom is explicit list, not wildcard"],
      script: "python3 -c \"import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); af=d.get('allowFrom',''); exit(0 if af not in ['*','all','any'] else 1)\"",
    },
  },

  {
    id: "ssrf_protection_disabled",
    category: "Network",
    label: "SSRF Protection Disabled",
    description:
      "SSRF (Server-Side Request Forgery) protection has been explicitly disabled in " +
      "openclaw.json. OpenClaw's SSRF guard blocks the agent from fetching internal IPs " +
      "(10.x.x.x, 192.168.x.x) and localhost URLs via web_fetch. Without it, indirect " +
      "injection via crafted web pages can exfiltrate data from internal services.",
    severity: "high",
    phase: "runtime",
    framework: "openclaw-trust",
    stage: "runtime",
    guide: {
      steps: [
        "Remove security.ssrf_protection: false from ~/.openclaw/openclaw.json",
        "SSRF protection is ON by default — it only needs a flag to turn it OFF",
        "Restart: openclaw gateway restart",
      ],
      code: "# Remove this line from ~/.openclaw/openclaw.json:\n# \"ssrf_protection\": false",
      file: "~/.openclaw/openclaw.json",
      tips: [
        "Tier 'never' — should never be disabled in production",
        "If you need local URL access, use explicit per-tool allow rules instead",
      ],
    },
    validation: {
      checklist: ["SSRF protection is not explicitly disabled"],
      script: "python3 -c \"import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); exit(0 if d.get('security',{}).get('ssrf_protection',True) is not False else 1)\"",
    },
  },

  // ── CI / Runtime ─────────────────────────────────────────────────────────

  {
    id: "runtime_package_install",
    category: "CI Security",
    label: "AgentShield CI Workflow",
    description:
      "No AgentShield CI workflow was found. Without package integrity validation in CI, " +
      "runtime packages could be silently replaced with malicious versions.",
    severity: "medium",
    phase: "ci",
    framework: "custom",
    stage: "ci",
    guide: {
      steps: [
        "Create .github/workflows/agentshield.yml",
        "Or via ClawSec: POST /api/apply/runtime_package_install",
      ],
      code: "# ClawSec will create the agentshield.yml workflow template",
      file: ".github/workflows/agentshield.yml",
    },
    validation: {
      checklist: [".github/workflows/agentshield.yml exists"],
      script: "test -f ~/.openclaw/.github/workflows/agentshield.yml",
    },
  },
];

export default CUSTOM_CHECKS;

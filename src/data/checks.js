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

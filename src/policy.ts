// ClawSec security policy surface (TypeScript side).
// Centralizes immutable files, remediation tiers, trusted origins, and mutation rules.

export const SCAN_SCHEMA_VERSION = "1.0";

export const IMMUTABLE_FILES = [
  "SOUL.md",
  "CONSTRAINTS.md",
];

export const MUTATING_TOOL_NAMES = [
  "write_file",
  "edit_file",
  "str_replace",
  "create_file",
  "edit",
  "write",
  "process",
  "bash",
  "exec",
];

// Auto-remediation check IDs that are allowed to run without explicit approval.
export const AUTO_REMEDIATION_IDS = [
  "env_gitignore",
  "precommit_hook",
  "breach_notification_procedure",
  "runtime_package_install",
  "soul_writable",
  "constraints_writable",
  // soul_writable and constraints_writable handled via server.py remediation scripts
];

// Check IDs that require explicit supervisor approval before execution.
export const APPROVAL_REQUIRED_IDS = [
  "sessions_exposed",
  "workspace_permissions",
  "gateway_exposed",
  "agent_communication_isolation",
];

export const NEVER_AUTO_REMEDIATE_IDS = [
  "gateway_exposed",
  "allowfrom_wildcard",
  "ssrf_protection_disabled",
  "dm_policy_open",
];

export const CHECK_ID_PATTERN = "^[a-z_]{1,64}$";

// Explicit trusted origins for dashboard/API calls.
// Additional origins can be supplied via CLAWSEC_TRUSTED_ORIGINS on the backend.
export const TRUSTED_ORIGINS = [
  "http://127.0.0.1:8081",
  "http://localhost:8081",
];


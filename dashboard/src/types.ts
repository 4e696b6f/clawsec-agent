// ClawSec Dashboard — canonical types mirroring server.py JSON responses.
// Keep in sync with: scripts/server.py, src/coordinator.ts

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type RemediationTier = "auto" | "approval" | "never";
export type FindingStatus = "open" | "auto_fixed" | "pending_approval" | "false_positive";

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  owasp_llm: string | null;
  owasp_asi: string | null;
  remediation_tier: RemediationTier;
  recommendation: string;
  status: FindingStatus;
  // Injected by normalizeScan() — not present in raw server response
  agent?: string;
  domain?: string;
}

export interface AgentResult {
  agent: string;
  scope: string;
  findings: Finding[];
  scan_duration_ms: number;
  agent_version: string;
  error?: string;
}

/** Raw JSON returned by GET /api/scan and GET /api/last-report */
export interface RawScanResponse {
  schema_version?: string;
  timestamp: string;
  scanned_at?: string;
  version: string;
  system_hash: string;
  agent_results: Record<string, AgentResult>;
}

export interface DomainStatus {
  scanned: boolean;
  duration_ms: number;
  ok: boolean;
  error?: string | null;
}

/** Normalized scan result used throughout the dashboard */
export interface ScanResult {
  schema_version?: string;
  scanned_at: string | null;
  supervisor_version: string;
  system_hash: string;
  risk_score: number;
  findings: Finding[];
  domains: Record<string, DomainStatus>;
  applied_fixes: string[];
  pending_approval: string[];
  // Passed through from server for applyNormalizedScan re-processing
  agent_results?: Record<string, AgentResult>;
}

/** GET /api/heartbeat */
export interface HeartbeatResponse {
  status: string;
  agent_id: string;
  last_ping: string;
  tool_calls_last_5min: number;
  current_skill: string | null;
  memory_used_mb: number;
  uptime_seconds: number;
  system_hash: string;
  version: string;
}

/** POST /api/apply/:checkId */
export interface ApplyResponse {
  success: boolean;
  already_done: boolean;
  check_id: string;
  output: string;
  exit_code: number;
  duration_ms: number;
}

/** GET /api/health */
export interface HealthResponse {
  status: string;
  version: string;
  system_hash: string;
}

/** GET /api/config/:key (save response) */
export interface ConfigSaveResponse {
  success: boolean;
  file: string;
  system_hash: string;
}

/** GET /api/applied-fixes — persisted fix history */
export interface AppliedFixEntry {
  check_id: string;
  applied_at: string;
  system_hash_at_apply: string;
  exit_code: number;
  duration_ms: number;
}

export interface AppliedFixesResponse {
  entries: AppliedFixEntry[];
  current_system_hash: string;
}

// Shared types used by the ClawSec coordinator modules.

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type RemediationTier = "auto" | "approval" | "never";

export interface AgentFinding {
  id: string;
  severity: Severity;
  message: string;
  owasp_llm: string | null;
  owasp_asi: string | null;
  remediation_tier: RemediationTier;
  recommendation: string;
  status: "open" | "auto_fixed" | "pending_approval" | "false_positive";
}

export interface SubAgentResult {
  agent: string;
  scope: string;
  findings: AgentFinding[];
  scan_duration_ms: number;
  agent_version: string;
  error?: string;
}

export interface ScanReport {
  schema_version?: string;
  scanned_at: string;
  risk_score: number;
  score_label: string;
  summary: string;
  llm_model: string;
  agent_results: Record<string, SubAgentResult>;
  findings: AgentFinding[];
  applied_fixes: string[];
  pending_approval: string[];
  scan_duration_ms: number;
}


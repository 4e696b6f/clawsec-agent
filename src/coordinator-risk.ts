import type { AgentFinding, Severity, ScanReport } from "./coordinator-types";

export function computeRiskScore(findings: AgentFinding[]): number {
  const openFindings = findings.filter((f) => f.status !== "auto_fixed");
  let score = 0;
  score += 30 * openFindings.filter((f) => f.severity === "critical").length;
  score += 15 * openFindings.filter((f) => f.severity === "high").length;
  score += 5 * openFindings.filter((f) => f.severity === "medium").length;
  return Math.min(score, 100);
}

export function scoreLabel(score: number): string {
  if (score <= 20) return "🟢 SECURE";
  if (score <= 50) return "🟡 NEEDS ATTENTION";
  return "🔴 CRITICAL ACTION REQUIRED";
}

export function getNewFindings(
  current: AgentFinding[],
  previous: ScanReport | null
): AgentFinding[] {
  if (!previous) return current;
  const previousIds = new Set(previous.findings.map((f) => f.id));
  return current.filter((f) => !previousIds.has(f.id));
}

export function shouldAlert(
  report: ScanReport,
  previous: ScanReport | null,
  isHeartbeat: boolean
): boolean {
  if (!isHeartbeat) return report.findings.length > 0;

  const newFindings = getNewFindings(report.findings, previous);
  const newCriticalOrHigh = newFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );

  return (
    newCriticalOrHigh.length > 0 ||
    report.risk_score > 50 ||
    (previous !== null && report.risk_score > previous.risk_score + 10)
  );
}

export const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};


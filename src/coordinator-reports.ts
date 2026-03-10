import path = require("path");
import fs = require("fs");
import type { ScanReport } from "./coordinator-types";

function getReportsDir(customReportDir?: string): string {
  if (customReportDir) {
    return path.resolve(customReportDir.replace(/^~/, process.env.HOME || "~"));
  }
  const clawsecRoot = path.resolve(
    process.env.CLAWSEC_ROOT ||
    path.join(process.env.HOME || "~", ".openclaw/workspace/clawsec")
  );
  return path.join(clawsecRoot, "reports");
}

/** Compute risk score from report (30×critical + 15×high + 5×medium, auto_fixed excluded, cap 100). */
export function getRiskScore(report: ScanReport | null): number {
  if (!report) return 0;
  if (typeof (report as { risk_score?: number }).risk_score === "number") {
    return (report as { risk_score: number }).risk_score;
  }
  const agentResults = (report as { agent_results?: Record<string, { findings?: Array<{ severity: string; status?: string }> }> }).agent_results;
  if (!agentResults) return 0;
  const findings = Object.values(agentResults).flatMap((r) => r.findings ?? []);
  let score = 0;
  for (const f of findings) {
    if (f.status === "auto_fixed") continue;
    if (f.severity === "critical") score += 30;
    else if (f.severity === "high") score += 15;
    else if (f.severity === "medium") score += 5;
  }
  return Math.min(score, 100);
}

export function loadLastReport(reportDir?: string): ScanReport | null {
  const reportsDir = getReportsDir(reportDir);
  const lastReportPath = path.join(reportsDir, "last-scan.json");
  try {
    const raw = fs.readFileSync(lastReportPath, "utf-8");
    return JSON.parse(raw) as ScanReport;
  } catch {
    return null;
  }
}

export function saveReport(report: ScanReport, reportDir?: string): void {
  const reportsDir = getReportsDir(reportDir);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const lastReportPath = path.join(reportsDir, "last-scan.json");
  const ts = new Date().toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "_")
    .slice(0, 15);
  const timestampedPath = path.join(reportsDir, `scan-${ts}.json`);

  const reportJson = JSON.stringify(report, null, 2);
  fs.writeFileSync(lastReportPath, reportJson, "utf-8");
  fs.writeFileSync(timestampedPath, reportJson, "utf-8");
}

export function appendChangelog(entries: string[]): void {
  const changelogPath = path.join(
    process.env.HOME || "~",
    ".openclaw/workspace/CHANGELOG.md"
  );
  if (!fs.existsSync(changelogPath)) return;

  const timestamp = new Date().toISOString();
  const block = entries
    .map(
      (e) =>
        `[${timestamp}] CLAWSEC_AUTO_FIX\n  action: ${e}\n  confirmed_by: clawsec-coordinator\n---`
    )
    .join("\n");

  fs.appendFileSync(changelogPath, "\n" + block + "\n", "utf-8");
}


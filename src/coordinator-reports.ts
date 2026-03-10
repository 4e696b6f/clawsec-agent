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


import path = require("path");
import fs = require("fs");
import type { ScanReport } from "./coordinator-types";

const CLAWSEC_ROOT = path.resolve(
  process.env.CLAWSEC_ROOT ||
  path.join(process.env.HOME || "~", ".openclaw/workspace/clawsec")
);

const REPORTS_DIR = path.join(CLAWSEC_ROOT, "reports");

export function loadLastReport(): ScanReport | null {
  const lastReportPath = path.join(REPORTS_DIR, "last-scan.json");
  try {
    const raw = fs.readFileSync(lastReportPath, "utf-8");
    return JSON.parse(raw) as ScanReport;
  } catch {
    return null;
  }
}

export function saveReport(report: ScanReport): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const lastReportPath = path.join(REPORTS_DIR, "last-scan.json");
  const ts = new Date().toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "_")
    .slice(0, 15);
  const timestampedPath = path.join(REPORTS_DIR, `scan-${ts}.json`);

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


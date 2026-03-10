import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeScan, computeScore, fetchScan, fetchLastReport, fetchAppliedFixes, applyRemediation } from "../api";
import type { RawScanResponse } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRaw(overrides: Partial<RawScanResponse> = {}): RawScanResponse {
  return {
    schema_version: "1.0",
    timestamp: "2026-01-01T00:00:00.000Z",
    version: "2.0.0",
    system_hash: "abc12345",
    agent_results: {},
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });
}

// ─── normalizeScan ────────────────────────────────────────────────────────────

describe("normalizeScan", () => {
  it("returns empty ScanResult for empty agent_results", () => {
    const result = normalizeScan(buildRaw());
    expect(result.findings).toHaveLength(0);
    expect(result.risk_score).toBe(0);
    expect(result.schema_version).toBe("1.0");
    expect(result.system_hash).toBe("abc12345");
    expect(result.supervisor_version).toBe("2.0.0");
  });

  it("uses scanned_at when provided by backend", () => {
    const result = normalizeScan(buildRaw({ scanned_at: "2026-01-01T00:00:30.000Z" }));
    expect(result.scanned_at).toBe("2026-01-01T00:00:30.000Z");
  });

  it("flattens findings from all agents", () => {
    const raw = buildRaw({
      agent_results: {
        "clawsec-env": {
          agent: "clawsec-env",
          scope: "credentials",
          scan_duration_ms: 100,
          agent_version: "2.0.0",
          findings: [{
            id: "env_gitignore",
            severity: "high",
            message: "test",
            owasp_llm: null,
            owasp_asi: null,
            remediation_tier: "auto",
            recommendation: "fix",
            status: "open",
          }],
        },
      },
    });
    const result = normalizeScan(raw);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].agent).toBe("clawsec-env");
    expect(result.findings[0].domain).toBe("credentials");
  });

  it("maps agent names to correct domains", () => {
    const agents: Array<[string, string]> = [
      ["clawsec-env",     "credentials"],
      ["clawsec-perm",    "identity"],
      ["clawsec-net",     "network"],
      ["clawsec-session", "sessions"],
      ["clawsec-config",  "config"],
    ];
    for (const [agentName, expectedDomain] of agents) {
      const raw = buildRaw({
        agent_results: {
          [agentName]: {
            agent: agentName,
            scope: expectedDomain,
            scan_duration_ms: 50,
            agent_version: "2.0.0",
            findings: [{
              id: "test_finding",
              severity: "low",
              message: "test",
              owasp_llm: null,
              owasp_asi: null,
              remediation_tier: "never",
              recommendation: "none",
              status: "open",
            }],
          },
        },
      });
      const result = normalizeScan(raw);
      expect(result.findings[0].domain).toBe(expectedDomain);
    }
  });

  it("marks domain as scanned when agent results present", () => {
    const raw = buildRaw({
      agent_results: {
        "clawsec-net": {
          agent: "clawsec-net",
          scope: "network",
          scan_duration_ms: 200,
          agent_version: "2.0.0",
          findings: [],
        },
      },
    });
    const result = normalizeScan(raw);
    expect(result.domains["network"].scanned).toBe(true);
    expect(result.domains["network"].duration_ms).toBe(200);
  });

  it("leaves missing agents as not scanned", () => {
    const result = normalizeScan(buildRaw());
    expect(result.domains["credentials"].scanned).toBe(false);
    expect(result.domains["identity"].scanned).toBe(false);
  });

  it("normalizes 'null' string owasp values to null", () => {
    const raw = buildRaw({
      agent_results: {
        "clawsec-config": {
          agent: "clawsec-config",
          scope: "config",
          scan_duration_ms: 50,
          agent_version: "2.0.0",
          findings: [{
            id: "test",
            severity: "medium",
            message: "test",
            owasp_llm: "null" as unknown as null,
            owasp_asi: "null" as unknown as null,
            remediation_tier: "never",
            recommendation: "none",
            status: "open",
          }],
        },
      },
    });
    const result = normalizeScan(raw);
    expect(result.findings[0].owasp_llm).toBeNull();
    expect(result.findings[0].owasp_asi).toBeNull();
  });

  it("builds applied_fixes from auto_fixed findings", () => {
    const raw = buildRaw({
      agent_results: {
        "clawsec-env": {
          agent: "clawsec-env",
          scope: "credentials",
          scan_duration_ms: 100,
          agent_version: "2.0.0",
          findings: [{
            id: "env_gitignore",
            severity: "high",
            message: "fixed",
            owasp_llm: null,
            owasp_asi: null,
            remediation_tier: "auto",
            recommendation: "done",
            status: "auto_fixed",
          }],
        },
      },
    });
    const result = normalizeScan(raw);
    expect(result.applied_fixes).toContain("env_gitignore");
    expect(result.pending_approval).toHaveLength(0);
  });
});

// ─── fetchScan ────────────────────────────────────────────────────────────────

describe("fetchScan", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("resolves to ScanResult on HTTP 200", async () => {
    vi.stubGlobal("fetch", mockFetch(200, buildRaw()));
    const promise = fetchScan();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.supervisor_version).toBe("2.0.0");
    expect(result.findings).toHaveLength(0);
  });

  it("throws on HTTP 500", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { error: "internal" }));
    // Attach rejection handler immediately to avoid unhandled rejection warning
    await expect(fetchScan()).rejects.toThrow("HTTP 500");
  });

  it("throws on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
    // Attach rejection handler immediately to avoid unhandled rejection warning
    await expect(fetchScan()).rejects.toThrow("Network failure");
  });
});

// ─── fetchLastReport ──────────────────────────────────────────────────────────

describe("fetchLastReport", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", mockFetch(404, {}));
    const result = await fetchLastReport();
    expect(result).toBeNull();
  });

  it("returns ScanResult on 200", async () => {
    vi.stubGlobal("fetch", mockFetch(200, buildRaw()));
    const result = await fetchLastReport();
    expect(result).not.toBeNull();
    expect(result?.system_hash).toBe("abc12345");
  });

  it("returns null on network error (graceful degradation)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED")));
    const result = await fetchLastReport();
    expect(result).toBeNull();
  });
});

// ─── fetchAppliedFixes ────────────────────────────────────────────────────────

describe("fetchAppliedFixes", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns AppliedFixesResponse on 200", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { entries: [{ check_id: "env_gitignore", applied_at: "2026-01-01T00:00:00Z", system_hash_at_apply: "abc12345", exit_code: 0, duration_ms: 100 }], current_system_hash: "abc12345" }));
    const result = await fetchAppliedFixes();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].check_id).toBe("env_gitignore");
    expect(result.current_system_hash).toBe("abc12345");
  });

  it("returns empty on non-200", async () => {
    vi.stubGlobal("fetch", mockFetch(500, {}));
    const result = await fetchAppliedFixes();
    expect(result.entries).toHaveLength(0);
    expect(result.current_system_hash).toBe("");
  });
});

// ─── applyRemediation ─────────────────────────────────────────────────────────

describe("applyRemediation", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("sends X-ClawSec-Token header when token provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, already_done: false, check_id: "env_gitignore", output: "", exit_code: 0, duration_ms: 5 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await applyRemediation("env_gitignore", "test-token-xyz");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-ClawSec-Token"]).toBe("test-token-xyz");
  });

  it("does NOT send X-ClawSec-Token when no token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, already_done: false, check_id: "env_gitignore", output: "", exit_code: 0, duration_ms: 5 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await applyRemediation("env_gitignore");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-ClawSec-Token"]).toBeUndefined();
  });

  it("throws on 401 Unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    }));
    await expect(applyRemediation("env_gitignore", "bad-token")).rejects.toThrow("Unauthorized");
  });

  it("throws on 400 (invalid checkId)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "checkId not in allowlist" }),
    }));
    await expect(applyRemediation("invalid_check", "token")).rejects.toThrow("checkId not in allowlist");
  });

  it("uses POST method", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, already_done: false, check_id: "env_gitignore", output: "", exit_code: 0, duration_ms: 5 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await applyRemediation("env_gitignore", "tok");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe("POST");
  });
});

// ─── computeScore (re-exported from api) ─────────────────────────────────────
// Core score tests live in score.test.ts — just verify it is exported correctly here

describe("computeScore export", () => {
  it("is exported from api module", () => {
    expect(typeof computeScore).toBe("function");
  });
});

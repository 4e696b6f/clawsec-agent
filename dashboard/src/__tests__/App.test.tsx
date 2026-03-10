import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../App";
import type { ScanResult } from "../types";

// ─── Mock the entire api module ───────────────────────────────────────────────
vi.mock("../api", () => ({
  fetchLastReport:    vi.fn().mockResolvedValue(null),
  fetchHeartbeat:     vi.fn().mockResolvedValue(null),
  fetchAppliedFixes:  vi.fn().mockResolvedValue({ entries: [], current_system_hash: "" }),
  fetchScan:          vi.fn(),
  applyRemediation:   vi.fn(),
  computeScore:       vi.fn().mockReturnValue(0),
  loadHistory:        vi.fn().mockReturnValue([]),
  saveHistory:        vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    getLogs:   vi.fn().mockReturnValue([]),
    clearLogs: vi.fn(),
  },
}));

import * as api from "../api";

const mockScanResult: ScanResult = {
  scanned_at: "2026-01-01T12:00:00.000Z",
  supervisor_version: "2.0.0",
  system_hash: "deadbeef",
  risk_score: 30,
  findings: [{
    id: "env_gitignore",
    severity: "high",
    message: ".env files not in .gitignore",
    owasp_llm: "LLM02",
    owasp_asi: null,
    remediation_tier: "auto",
    recommendation: "Add .env to .gitignore",
    status: "open",
    agent: "clawsec-env",
    domain: "credentials",
  }],
  domains: {
    identity:    { scanned: true, duration_ms: 120, ok: true },
    credentials: { scanned: true, duration_ms: 80,  ok: false },
    network:     { scanned: true, duration_ms: 200, ok: true },
    sessions:    { scanned: true, duration_ms: 95,  ok: true },
    config:      { scanned: true, duration_ms: 110, ok: true },
  },
  applied_fixes:    [],
  pending_approval: [],
  agent_results: {
    "clawsec-env": {
      agent: "clawsec-env",
      scope: "credentials",
      scan_duration_ms: 80,
      agent_version: "2.0.0",
      findings: [{
        id: "env_gitignore",
        severity: "high",
        message: ".env files not in .gitignore",
        owasp_llm: "LLM02",
        owasp_asi: null,
        remediation_tier: "auto",
        recommendation: "Add .env to .gitignore",
        status: "open",
      }],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchLastReport).mockResolvedValue(null);
  vi.mocked(api.fetchHeartbeat).mockResolvedValue(null);
  vi.mocked(api.computeScore).mockReturnValue(0);
  vi.mocked(api.loadHistory).mockReturnValue([]);
});

describe("App smoke tests", () => {
  it("renders without crashing when backend is offline", () => {
    render(<App />);
    const matches = screen.getAllByText("ClawSec");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Run scan button", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Run scan/ })).toBeTruthy();
  });

  it("shows API offline indicator when backend not reachable", async () => {
    render(<App />);
    await waitFor(() => {
      const offlineEls = screen.getAllByText(/Offline/);
      expect(offlineEls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Connected indicator after heartbeat resolves", async () => {
    vi.mocked(api.fetchHeartbeat).mockResolvedValue({
      status: "active",
      agent_id: "kairos",
      last_ping: new Date().toISOString(),
      tool_calls_last_5min: 3,
      current_skill: "clawsec",
      memory_used_mb: 64,
      uptime_seconds: 3600,
      system_hash: "deadbeef",
      version: "2.0.0",
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });
  });

  it("calls fetchScan when Run scan is clicked", async () => {
    vi.mocked(api.fetchScan).mockResolvedValue(mockScanResult);
    vi.mocked(api.computeScore).mockReturnValue(30);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Run scan/ }));
    await waitFor(() => {
      expect(api.fetchScan).toHaveBeenCalledTimes(1);
    });
  });

  it("shows finding after successful scan", async () => {
    vi.mocked(api.fetchScan).mockResolvedValue(mockScanResult);
    vi.mocked(api.computeScore).mockReturnValue(30);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Run scan/ }));
    await waitFor(() => {
      expect(screen.getByText(".env files not in .gitignore")).toBeTruthy();
    });
  });

  it("shows no scan message before first scan", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/No scan loaded yet/)).toBeTruthy();
    });
  });

  it("shows tabs: Overview, Findings, Applied, Agents, Changelog, Config", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Findings/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Applied/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Changelog" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Config" })).toBeTruthy();
  });

  it("navigates to Findings tab when clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Findings/ }));
    await waitFor(() => {
      expect(screen.getByText("Scan pending")).toBeTruthy();
    });
  });
});

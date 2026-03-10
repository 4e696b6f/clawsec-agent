/**
 * ClawSec Dashboard — API Adapter (dashboard/src/api.ts)
 *
 * Translates server.py API responses into the internal dashboard data format.
 *
 * server.py returns data per agent:
 *   { agent_results: { "clawsec-env": { findings: [...] }, ... } }
 *
 * The dashboard expects a ScanResult object with:
 *   { risk_score, findings[], domains{}, system_hash, applied_fixes[], pending_approval[] }
 */

import { logger } from "./logger";
import type {
  Finding, ScanResult, RawScanResponse, AgentResult,
  HeartbeatResponse, ApplyResponse, ConfigSaveResponse,
} from "./types";

// Base URL for the ClawSec backend API.
// In dev, Vite proxies /api → backend; in prod, you can override with VITE_CLAWSEC_API_URL.
const BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CLAWSEC_API_URL) ||
  "/api";

// ─── Agent → Domain mapping ──────────────────────────────────────────────────
const AGENT_DOMAIN: Record<string, string> = {
  "clawsec-env":     "credentials",
  "clawsec-perm":    "identity",
  "clawsec-net":     "network",
  "clawsec-session": "sessions",
  "clawsec-config":  "config",
};

// ─── Risk score (mirrors coordinator.ts formula exactly) ─────────────────────
// score = 30×critical + 15×high + 5×medium (auto_fixed excluded), capped at 100
export function computeScore(findings: Finding[]): number {
  const open = findings.filter(f => f.status !== "auto_fixed");
  let score = 0;
  score += 30 * open.filter(f => f.severity === "critical").length;
  score += 15 * open.filter(f => f.severity === "high").length;
  score +=  5 * open.filter(f => f.severity === "medium").length;
  return Math.min(score, 100);
}

// ─── Normalize raw server response into dashboard ScanResult format ──────────
export function normalizeScan(raw: RawScanResponse): ScanResult {
  const agentResults: Record<string, AgentResult> = raw.agent_results || {};
  const allFindings: Finding[] = [];

  for (const [agentName, agentResult] of Object.entries(agentResults)) {
    const domain = AGENT_DOMAIN[agentName] || "unknown";
    const findings = (agentResult?.findings || []).map(f => ({
      ...f,
      // Normalize "null" strings → actual null
      owasp_llm: f.owasp_llm === "null" || !f.owasp_llm ? null : f.owasp_llm,
      owasp_asi: f.owasp_asi === "null" || !f.owasp_asi ? null : f.owasp_asi,
      agent:  agentName,
      domain: domain,
    }));
    allFindings.push(...findings);
  }

  const domains: ScanResult["domains"] = {
    identity:    { scanned: false, duration_ms: 0, ok: true },
    credentials: { scanned: false, duration_ms: 0, ok: true },
    network:     { scanned: false, duration_ms: 0, ok: true },
    sessions:    { scanned: false, duration_ms: 0, ok: true },
    config:      { scanned: false, duration_ms: 0, ok: true },
  };

  for (const [agentName, agentResult] of Object.entries(agentResults)) {
    const domain = AGENT_DOMAIN[agentName];
    if (domain && domains[domain]) {
      const domainFindings = allFindings.filter(
        f => f.agent === agentName && f.status !== "auto_fixed"
      );
      domains[domain] = {
        scanned:     true,
        duration_ms: agentResult?.scan_duration_ms || 0,
        ok:          domainFindings.length === 0,
        error:       agentResult?.error || null,
      };
    }
  }

  const appliedFixes    = allFindings.filter(f => f.status === "auto_fixed").map(f => f.id);
  const pendingApproval = allFindings.filter(f => f.status === "pending_approval").map(f => f.id);

  return {
    schema_version:     raw.schema_version || "1.0",
    scanned_at:         raw.scanned_at || raw.timestamp || new Date().toISOString(),
    supervisor_version: raw.version   || "2.0.0",
    system_hash:        raw.system_hash || "--------",
    risk_score:         computeScore(allFindings),
    findings:           allFindings,
    domains,
    applied_fixes:      appliedFixes,
    pending_approval:   pendingApproval,
    agent_results:      agentResults,
  };
}

// ─── fetchScan ────────────────────────────────────────────────────────────────
/** Trigger a full scan across all 5 sub-agents. Timeout: 35s. */
export async function fetchScan(): Promise<ScanResult> {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 35_000);
  logger.info("fetchScan: starting full scan");
  try {
    const res = await fetch(`${BASE}/scan`, { signal: controller.signal });
    if (!res.ok) {
      const msg = `HTTP ${res.status}: ${res.statusText}`;
      logger.error("fetchScan failed", { status: res.status });
      throw new Error(msg);
    }
    const raw = (await res.json()) as RawScanResponse;
    const result = normalizeScan(raw);
    logger.info("fetchScan complete", { score: result.risk_score, findings: result.findings.length });
    return result;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.error("fetchScan timed out after 35s");
      throw new Error("Scan timed out after 35s");
    }
    logger.error("fetchScan error", { error: String(err) });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── fetchLastReport ──────────────────────────────────────────────────────────
/** Load the last saved scan report without triggering a new scan. Returns null on 404. */
export async function fetchLastReport(): Promise<ScanResult | null> {
  try {
    const res = await fetch(`${BASE}/last-report`);
    if (res.status === 404) {
      logger.debug("fetchLastReport: no report yet (404)");
      return null;
    }
    if (!res.ok) {
      logger.warn("fetchLastReport: unexpected status", { status: res.status });
      throw new Error(`HTTP ${res.status}`);
    }
    const raw = (await res.json()) as RawScanResponse;
    const result = normalizeScan(raw);
    logger.info("fetchLastReport loaded", { score: result.risk_score });
    return result;
  } catch (err) {
    logger.error("fetchLastReport error", { error: String(err) });
    return null;
  }
}

// ─── fetchHeartbeat ───────────────────────────────────────────────────────────
/** Fetch backend heartbeat. Falls back to /api/health for backward compat. */
export async function fetchHeartbeat(): Promise<HeartbeatResponse | null> {
  try {
    const res = await fetch(`${BASE}/heartbeat`);
    if (res.ok) return (await res.json()) as HeartbeatResponse;

    // Fallback: derive minimal heartbeat from /api/health
    const fallback = await fetch(`${BASE}/health`);
    if (!fallback.ok) return null;
    const data = (await fallback.json()) as { status: string; system_hash?: string };
    return {
      status:               data.status === "ok" ? "active" : "degraded",
      agent_id:             "kairos",
      last_ping:            new Date().toISOString(),
      tool_calls_last_5min: 0,
      current_skill:        "clawsec",
      memory_used_mb:       0,
      uptime_seconds:       0,
      system_hash:          data.system_hash || "--------",
      version:              "2.0.0",
    };
  } catch (err) {
    logger.debug("fetchHeartbeat error", { error: String(err) });
    return null;
  }
}

// ─── applyRemediation ─────────────────────────────────────────────────────────
/**
 * Trigger remediation via the backend.
 * Requires X-ClawSec-Token for POST /api/apply/ (ASI07).
 * SECURITY: Never log the token value — only the checkId.
 */
export async function applyRemediation(checkId: string, token = ""): Promise<ApplyResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-ClawSec-Token"] = token;

  logger.info("applyRemediation", { checkId });
  const res = await fetch(`${BASE}/apply/${checkId}`, { method: "POST", headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    const msg = err.error || `HTTP ${res.status}`;
    logger.error("applyRemediation failed", { checkId, status: res.status });
    throw new Error(msg);
  }
  return res.json() as Promise<ApplyResponse>;
}

// ─── fetchReportHistory ───────────────────────────────────────────────────────
/** Load the last N scan reports from the server for history display. */
export async function fetchReportHistory(limit = 20): Promise<ScanResult[]> {
  try {
    const listRes = await fetch(`${BASE}/reports`);
    if (!listRes.ok) return [];
    const { reports } = (await listRes.json()) as { reports: string[] };

    const toLoad = (reports || []).slice(0, limit);
    const results = await Promise.allSettled(
      toLoad.map(name => fetch(`${BASE}/reports/${name}`).then(r => r.json() as Promise<RawScanResponse>))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<RawScanResponse> => r.status === "fulfilled")
      .map(r => normalizeScan(r.value));
  } catch (err) {
    logger.warn("fetchReportHistory error", { error: String(err) });
    return [];
  }
}

// ─── saveConfig ───────────────────────────────────────────────────────────────
/**
 * Save a config file to the server.
 * SOUL.md is chmod 444 — server returns 403 (intentional, immutable by design).
 * SECURITY: Never log the token value.
 */
export async function saveConfig(fileKey: string, content: string, token = ""): Promise<ConfigSaveResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-ClawSec-Token"] = token;

  const res = await fetch(`${BASE}/config/${fileKey}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    const msg = err.error || `HTTP ${res.status}`;
    logger.error("saveConfig failed", { fileKey, status: res.status });
    throw new Error(msg);
  }
  return res.json() as Promise<ConfigSaveResponse>;
}

// ─── localStorage history cache ───────────────────────────────────────────────
const HISTORY_KEY = "clawsec_score_history";

export function loadHistory(): number[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as number[];
  } catch {
    return [];
  }
}

export function saveHistory(history: number[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-50)));
  } catch { /* ignore */ }
}

/**
 * ClawSec Dashboard — API Adapter (dashboard/src/api.js)
 *
 * Translates server.py API responses into the internal dashboard data format.
 *
 * server.py returns data per agent:
 *   { agent_results: { "clawsec-env": { findings: [...] }, ... } }
 *
 * The dashboard expects a scanResult object with:
 *   { risk_score, findings[], domains{}, system_hash, applied_fixes[], pending_approval[] }
 *
 * This file is the only place that knows about this translation.
 */

const BASE = "/api"; // Via Vite proxy in dev, direct in prod

// ─── Agent → Domain mapping ──────────────────────────────────────────────────
// Each sub-agent owns exactly one domain scope.
const AGENT_DOMAIN = {
  "clawsec-env":     "credentials",
  "clawsec-perm":    "identity",
  "clawsec-net":     "network",
  "clawsec-session": "sessions",
  "clawsec-config":  "config",
};

// ─── Risk score (mirrors coordinator.ts formula) ─────────────────────────────
function computeScore(findings) {
  const open = findings.filter(f => f.status !== "auto_fixed");
  let score = 0;
  score += 30 * open.filter(f => f.severity === "critical").length;
  score += 15 * open.filter(f => f.severity === "high").length;
  score +=  5 * open.filter(f => f.severity === "medium").length;
  return Math.min(score, 100);
}
export { computeScore };

// ─── Normalize raw server response into dashboard scanResult format ───────────
function normalizeResponse(raw) {
  const agentResults = raw.agent_results || {};
  const allFindings = [];

  for (const [agentName, agentResult] of Object.entries(agentResults)) {
    const domain = AGENT_DOMAIN[agentName] || "unknown";
    const findings = (agentResult?.findings || []).map(f => ({
      ...f,
      // Normalize "null" strings → actual null
      owasp_llm: f.owasp_llm === "null" || !f.owasp_llm ? null : f.owasp_llm,
      owasp_asi: f.owasp_asi === "null" || !f.owasp_asi ? null : f.owasp_asi,
      // Add agent context (not present in per-finding objects from server.py)
      agent:  agentName,
      domain: domain,
    }));
    allFindings.push(...findings);
  }

  // Build domains structure from agent scan results
  const domains = {
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

  const appliedFixes   = allFindings.filter(f => f.status === "auto_fixed").map(f => f.id);
  const pendingApproval = allFindings.filter(f => f.status === "pending_approval").map(f => f.id);

  return {
    scanned_at:         raw.timestamp || new Date().toISOString(),
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
/**
 * Trigger a full scan across all 5 sub-agents.
 * Timeout: 35s (each agent has 30s on the server side).
 */
export async function fetchScan() {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 35_000);
  try {
    const res = await fetch(`${BASE}/scan`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return normalizeResponse(await res.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── fetchLastReport ──────────────────────────────────────────────────────────
/**
 * Load the last saved scan report without triggering a new scan.
 * Returns null if no scan has run yet (server returns 404).
 */
export async function fetchLastReport() {
  try {
    const res = await fetch(`${BASE}/last-report`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeResponse(await res.json());
  } catch {
    return null;
  }
}

// ─── fetchHeartbeat ───────────────────────────────────────────────────────────
/**
 * Fetch backend heartbeat. Derives status from /api/heartbeat (after Task 4)
 * or falls back to /api/health for backward compatibility.
 */
export async function fetchHeartbeat() {
  try {
    // Try dedicated heartbeat endpoint first (available after server.py Task 4 update)
    const res = await fetch(`${BASE}/heartbeat`);
    if (res.ok) return await res.json();

    // Fallback: derive minimal heartbeat from /api/health
    const fallback = await fetch(`${BASE}/health`);
    if (!fallback.ok) return null;
    const data = await fallback.json();
    return {
      status:               data.status === "ok" ? "active" : "degraded",
      agent_id:             "kairos",
      last_ping:            new Date().toISOString(),
      tool_calls_last_5min: 0,
      current_skill:        "clawsec",
      memory_used_mb:       0,
      uptime_seconds:       0,
      system_hash:          data.system_hash || "--------",
    };
  } catch {
    return null;
  }
}

// ─── applyRemediation ─────────────────────────────────────────────────────────
/**
 * Trigger remediation for a finding via the backend.
 * Requires X-ClawSec-Token — token is read from meta tag injected by server (future),
 * or passed as argument. For now uses empty token (GET calls are open).
 *
 * NOTE: Token must be supplied by the caller for POST /api/apply/ (ASI07).
 * The dashboard should read the token from a secure storage or prompt.
 */
export async function applyRemediation(checkId, token = "") {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-ClawSec-Token"] = token;

  const res = await fetch(`${BASE}/apply/${checkId}`, {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── fetchReportHistory ───────────────────────────────────────────────────────
/**
 * Load the last N scan reports from the server for history display.
 * Fills scan history on dashboard start with real historical data.
 */
export async function fetchReportHistory(limit = 20) {
  try {
    const listRes = await fetch(`${BASE}/reports`);
    if (!listRes.ok) return [];
    const { reports } = await listRes.json();

    const toLoad = (reports || []).slice(0, limit);
    const results = await Promise.allSettled(
      toLoad.map(name => fetch(`${BASE}/reports/${name}`).then(r => r.json()))
    );
    return results
      .filter(r => r.status === "fulfilled")
      .map(r => normalizeResponse(r.value));
  } catch {
    return [];
  }
}

// ─── saveConfig ───────────────────────────────────────────────────────────────
/**
 * Save a config file (soul, constraints, gateway) to the server.
 * SOUL.md is chmod 444 — server will return 403 (intentional, immutable).
 */
export async function saveConfig(fileKey, content, token = "") {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-ClawSec-Token"] = token;

  const res = await fetch(`${BASE}/config/${fileKey}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── localStorage history cache ───────────────────────────────────────────────
const HISTORY_KEY = "clawsec_score_history";

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-50)));
  } catch { /* ignore */ }
}

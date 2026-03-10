/**
 * ClawSec 2.0 — OpenClaw Plugin
 *
 * Registers as an OpenClaw lifecycle-hook plugin.
 * Hooks used:
 *   - before_tool_call   → enforce remediation tier constraints, immutable file protection
 *   - session_start      → log high risk score when present
 *
 * Scans are triggered by the agent via GET http://127.0.0.1:3001/api/scan (skill-driven).
 *
 * Install: copy to ~/.openclaw/extensions/clawsec/
 * Manifest: openclaw.plugin.json alongside this file
 */

// CommonJS imports — required for OpenClaw extension loader compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path") as typeof import("path");

import { loadLastReport } from "./coordinator-reports";
import { IMMUTABLE_FILES, MUTATING_TOOL_NAMES } from "./policy";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskScore(report: ReturnType<typeof loadLastReport>): number {
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

// ─── OpenClaw Plugin Registration ────────────────────────────────────────────
//
// OpenClaw's extension loader uses CommonJS require().
// module.exports must be a function that accepts the OpenClaw API object.
// ESM "export default" is not supported — use module.exports directly.

function register(api: {
  on: (event: string, handler: Function, opts?: object) => void;
  registerHttpRoute?: (opts: { path: string; auth?: string; match?: string; handler: (req: import("http").IncomingMessage, res: import("http").ServerResponse) => void | Promise<void> }) => void;
  runtime?: { paths: { workspace: string } };
}) {
  // ── Verify skill files are physical copies (not symlinks) ─────────────────
  // OpenClaw's skill-loader calls realpath() on every SKILL.md. Symlinks that
  // resolve outside the configured root (~/.openclaw/) are silently skipped.
  // This check detects lingering symlinks from old installs and logs a fix command.
  const skillsRoot = path.join(process.env.HOME || "", ".openclaw", "skills");
  const clawsecSkills = [
    "clawsec-coordinator",
    "clawsec-env", "clawsec-perm", "clawsec-net",
    "clawsec-session", "clawsec-config",
  ];

  let symlinkWarnings = 0;
  for (const skillName of clawsecSkills) {
    const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
    try {
      const stat = fs.lstatSync(skillPath);
      if (stat.isSymbolicLink()) {
        symlinkWarnings++;
        console.warn(
          `[CLAWSEC] WARNING: ${skillName}/SKILL.md is a symlink — ` +
          `OpenClaw may skip it. Fix: cp --remove-destination ` +
          `"$(readlink -f ${skillPath})" "${skillPath}"`
        );
      }
    } catch {
      console.warn(`[CLAWSEC] Skill file not found: ${skillPath}`);
    }
  }

  if (symlinkWarnings > 0) {
    console.warn(
      `[CLAWSEC] ${symlinkWarnings} skill symlink(s) detected. ` +
      `Re-run install.sh to replace with physical copies.`
    );
  }

  console.log("[CLAWSEC] ClawSec 2.0 plugin registered");

  // Hook: intercept any tool call that tries to touch SOUL.md or CONSTRAINTS.md
  api.on("before_tool_call", (event: { toolName: string; params: Record<string, unknown> }) => {
    const { toolName, params } = event;

    // Block any write/edit tool targeting immutable files
    const isMutatingTool = MUTATING_TOOL_NAMES.includes(toolName);
    if (isMutatingTool) {
      const target = String(params.path || params.file || "");
      if (IMMUTABLE_FILES.some((name) => target.includes(name))) {
        console.error(`[CLAWSEC] BLOCKED: Attempted write to immutable file: ${target}`);
        return { skip: true, reason: "ClawSec: immutable file protection" };
      }
    }

    // Enforce deny-by-default for direct remediation command execution.
    if (toolName === "bash" || toolName === "exec") {
      const cmd = String(params.command || "");
      if (cmd.includes("remediation/")) {
        if (!cmd.startsWith("bash scripts/remediation/")) {
          console.error(`[CLAWSEC] BLOCKED: direct remediation execution denied: ${cmd.slice(0, 120)}`);
          return { skip: true, reason: "ClawSec: remediation execution policy" };
        }
      }
    }
  }, { priority: 200 }); // High priority — runs before other hooks

  // Hook: log high risk score when present (report from server.py or legacy coordinator)
  api.on("session_start", () => {
    const lastReport = loadLastReport();
    const score = getRiskScore(lastReport);
    if (score > 50) {
      console.warn(`[CLAWSEC] High risk score (${score}) — agent should be aware`);
    }
  });

  // Optional: Gateway proxy for ClawSec API (Single Entry Point)
  // Dashboard can use VITE_CLAWSEC_API_URL=http://gateway:port/clawsec
  if (typeof api.registerHttpRoute === "function") {
    const BACKEND = "http://127.0.0.1:3001";
    api.registerHttpRoute({
      path: "/clawsec",
      auth: "plugin",
      match: "prefix",
      handler: async (req, res) => {
        const url = (req.url || "/").replace(/^\/clawsec/, "/api");
        const finalUrl = `${BACKEND}${url.startsWith("/api") ? url : "/api" + url}`;
        try {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (v && typeof v === "string" && !["host", "connection"].includes(k.toLowerCase())) {
              headers[k] = v;
            }
          }
          const body = req.method !== "GET" && req.method !== "HEAD"
            ? await new Promise<Buffer>((resolve, reject) => {
                const chunks: Buffer[] = [];
                req.on("data", (c) => chunks.push(c));
                req.on("end", () => resolve(Buffer.concat(chunks)));
                req.on("error", reject);
              })
            : undefined;
          const proxyRes = await fetch(finalUrl, {
            method: req.method || "GET",
            headers,
            body,
          });
          res.statusCode = proxyRes.status;
          proxyRes.headers.forEach((v, k) => res.setHeader(k, v));
          res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
          res.end(await proxyRes.text());
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "ClawSec backend unreachable", detail: String(err) }));
        }
        return true;
      },
    });
    console.log("[CLAWSEC] Gateway proxy registered at /clawsec -> 127.0.0.1:3001/api");
  }
}

// CommonJS export — required by OpenClaw's extension loader (uses require())
// This is the only export this module exposes to the runtime.
module.exports = register;

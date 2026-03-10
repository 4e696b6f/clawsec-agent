/**
 * ClawSec 2.0 — OpenClaw Plugin
 *
 * Registers: tools (clawsec_scan, clawsec_apply), command (/clawsec-scan),
 * CLI (openclaw clawsec), Gateway RPC, HTTP proxy, hooks, optional heartbeat.
 *
 * Install: openclaw plugins install ./Clawsec2.0  OR  copy to ~/.openclaw/extensions/clawsec/
 */

// CommonJS imports — required for OpenClaw extension loader compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path") as typeof import("path");

import { loadLastReport, getRiskScore } from "./coordinator-reports";
import { IMMUTABLE_FILES, MUTATING_TOOL_NAMES } from "./policy";

// Allowed remediation command patterns (cwd may be workspace/clawsec or ~/.openclaw)
const REMEDIATION_ALLOWED_PATTERNS = [
  /^bash\s+scripts\/remediation\//,
  /^bash\s+workspace\/clawsec\/scripts\/remediation\//,
  /^bash\s+[^ ]*\/workspace\/clawsec\/scripts\/remediation\//,
];

const DEFAULT_API = "http://127.0.0.1:3001";

// ─── OpenClaw Plugin Registration ────────────────────────────────────────────
//
// OpenClaw's extension loader uses CommonJS require().
// module.exports must be a function that accepts the OpenClaw API object.
// ESM "export default" is not supported — use module.exports directly.

type PluginApi = {
  on: (event: string, handler: Function, opts?: object) => void;
  registerHttpRoute?: (opts: { path: string; auth?: string; match?: string; handler: (req: import("http").IncomingMessage, res: import("http").ServerResponse) => void | Promise<void> }) => void;
  registerTool?: (def: object, opts?: { optional?: boolean }) => void;
  registerCommand?: (def: { name: string; description: string; handler: (ctx: object) => Promise<{ text: string }> | { text: string }; requireAuth?: boolean }) => void;
  registerCli?: (fn: (opts: { program: object }) => void, opts?: { commands: string[] }) => void;
  registerGatewayMethod?: (name: string, handler: (opts: { respond: (ok: boolean, data: unknown) => void }) => void) => void;
  registerService?: (def: { id: string; start: () => void; stop?: () => void }) => void;
  runtime?: { paths?: { workspace?: string } };
  pluginConfig?: {
    apiBaseUrl?: string;
    reportDir?: string;
    alertThreshold?: number;
    heartbeatIntervalSeconds?: number;
    applyToken?: string;
  };
};

function register(api: PluginApi) {
  const config = api.pluginConfig ?? {};
  const apiBase = (config.apiBaseUrl || DEFAULT_API).replace(/\/$/, "");
  const reportDir = config.reportDir;
  const alertThreshold = typeof config.alertThreshold === "number" ? config.alertThreshold : 50;
  const heartbeatInterval = typeof config.heartbeatIntervalSeconds === "number" ? config.heartbeatIntervalSeconds : 3600;
  const applyToken = config.applyToken?.trim() || "";

  async function fetchScan(): Promise<{ ok: boolean; data?: object; error?: string }> {
    try {
      const res = await fetch(`${apiBase}/api/scan`, { signal: AbortSignal.timeout(35000) });
      const data = (await res.json()) as object;
      return res.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string }).error || `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function fetchHealth(): Promise<object | null> {
    try {
      const res = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(5000) });
      return res.ok ? (await res.json()) as object : null;
    } catch {
      return null;
    }
  }

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
      const cmd = String(params.command || "").trim();
      if (cmd.includes("remediation/")) {
        const allowed = REMEDIATION_ALLOWED_PATTERNS.some((re) => re.test(cmd));
        if (!allowed) {
          console.error(`[CLAWSEC] BLOCKED: direct remediation execution denied: ${cmd.slice(0, 120)}`);
          return { skip: true, reason: "ClawSec: remediation execution policy" };
        }
      }
    }
  }, { priority: 200 }); // High priority — runs before other hooks

  // Hook: log high risk score when present
  api.on("session_start", () => {
    const lastReport = loadLastReport(reportDir);
    const score = getRiskScore(lastReport);
    if (score > alertThreshold) {
      console.warn(`[CLAWSEC] High risk score (${score}) — agent should be aware`);
    }
  });

  // Hook: inject risk score into prompt when high (agent sees it)
  api.on("before_prompt_build", () => {
    const lastReport = loadLastReport(reportDir);
    const score = getRiskScore(lastReport);
    if (score > alertThreshold) {
      const label = score <= 20 ? "SECURE" : score <= 50 ? "NEEDS ATTENTION" : "CRITICAL ACTION REQUIRED";
      return {
        prependSystemContext: `[ClawSec] Current security risk score: ${score}/100 (${label}). Consider running a security scan if not done recently.`,
      };
    }
    return null;
  }, { priority: 5 });

  // ── Tools: clawsec_scan, clawsec_apply ─────────────────────────────────────────────────
  if (typeof api.registerTool === "function") {
    api.registerTool({
      name: "clawsec_scan",
      description: "Run a full ClawSec security scan across all 5 domains (env, perm, net, session, config). Returns JSON with agent_results and findings.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const result = await fetchScan();
        if (!result.ok) {
          return { content: [{ type: "text", text: `ClawSec scan failed: ${result.error}. Check that server.py is running (python3 ~/.openclaw/workspace/clawsec/scripts/server.py).` }] };
        }
        const summary = (result.data as { agent_results?: Record<string, { findings?: unknown[] }> })?.agent_results;
        const count = summary ? Object.values(summary).reduce((n, r) => n + (r.findings?.length ?? 0), 0) : 0;
        return {
          content: [{ type: "text", text: `ClawSec scan complete. ${count} finding(s). Full JSON: ${JSON.stringify(result.data)}` }],
        };
      },
    }, { optional: true });

    api.registerTool({
      name: "clawsec_apply",
      description: "Apply a ClawSec remediation by check ID. Requires apply token in plugin config. Use for Tier 1 auto-fixable checks: env_gitignore, precommit_hook, breach_notification_procedure, runtime_package_install.",
      parameters: {
        type: "object",
        properties: { checkId: { type: "string", description: "ID of the check to apply (e.g. env_gitignore)" } },
        required: ["checkId"],
        additionalProperties: false,
      },
      async execute(_id: unknown, params: { checkId?: string }) {
        const checkId = String(params?.checkId ?? "").trim();
        if (!checkId) return { content: [{ type: "text", text: "Missing checkId parameter." }] };
        if (!applyToken) return { content: [{ type: "text", text: "ClawSec apply token not configured. Add applyToken to plugins.entries.clawsec.config (from .clawsec_token.apply)." }] };
        try {
          const res = await fetch(`${apiBase}/api/apply/${encodeURIComponent(checkId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-ClawSec-Token": applyToken },
            signal: AbortSignal.timeout(35000),
          });
          const data = (await res.json()) as { success?: boolean; error?: string };
          if (!res.ok) return { content: [{ type: "text", text: `Apply failed: ${data.error || res.status}` }] };
          return { content: [{ type: "text", text: `ClawSec applied ${checkId}: ${data.success ? "success" : "already done"}` }] };
        } catch (e) {
          return { content: [{ type: "text", text: `ClawSec apply error: ${String(e)}` }] };
        }
      },
    }, { optional: true });
  }

  // ── Command: /clawsec-scan ────────────────────────────────────────────────────────────
  if (typeof api.registerCommand === "function") {
    api.registerCommand({
      name: "clawsec-scan",
      description: "Run ClawSec security scan (no AI)",
      requireAuth: false,
      async handler() {
        const result = await fetchScan();
        if (!result.ok) {
          return { text: `ClawSec scan failed: ${result.error}. Ensure server.py is running.` };
        }
        const data = result.data as { agent_results?: Record<string, { findings?: Array<{ severity?: string; status?: string }> }> };
        const count = data?.agent_results ? Object.values(data.agent_results).reduce((n, r) => n + (r.findings?.length ?? 0), 0) : 0;
        const score = getRiskScore(data as ReturnType<typeof loadLastReport>);
        return { text: `ClawSec scan complete. Risk score: ${score}/100. ${count} finding(s). Use /clawsec for full report.` };
      },
    });
  }

  // ── CLI: openclaw clawsec-scan | openclaw clawsec-status ───────────────────────────────
  if (typeof api.registerCli === "function") {
    api.registerCli(
      (opts: { program: object }) => {
        const program = opts.program as { command: (name: string, desc?: string) => { action: (fn: () => void | Promise<void>) => void } };
        program.command("clawsec-scan", "Run ClawSec full security scan").action(async () => {
          const result = await fetchScan();
          if (!result.ok) {
            console.error("ClawSec scan failed:", result.error);
            process.exit(1);
          }
          console.log(JSON.stringify(result.data, null, 2));
        });
        program.command("clawsec-status", "Check ClawSec backend status").action(async () => {
          const health = await fetchHealth();
          if (!health) {
            console.error("ClawSec backend unreachable");
            process.exit(1);
          }
          console.log(JSON.stringify(health, null, 2));
        });
      },
      { commands: ["clawsec-scan", "clawsec-status"] },
    );
  }

  // ── Gateway RPC: clawsec.scan, clawsec.status ──────────────────────────────────────────
  if (typeof api.registerGatewayMethod === "function") {
    api.registerGatewayMethod("clawsec.scan", ({ respond }) => {
      fetchScan().then((r) => respond(r.ok, r.data ?? r.error)).catch((e) => respond(false, String(e)));
    });
    api.registerGatewayMethod("clawsec.status", ({ respond }) => {
      fetchHealth().then((h) => respond(!!h, h ?? { error: "Unreachable" })).catch((e) => respond(false, String(e)));
    });
  }

  // ── Background Service: heartbeat scans ───────────────────────────────────────────────
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (typeof api.registerService === "function" && heartbeatInterval > 0) {
    api.registerService({
      id: "clawsec-heartbeat",
      start: () => {
        heartbeatTimer = setInterval(() => {
          fetchScan().then((r) => {
            if (r.ok) console.log("[CLAWSEC] Heartbeat scan complete");
            else console.warn("[CLAWSEC] Heartbeat scan failed:", r.error);
          });
        }, heartbeatInterval * 1000);
        console.log(`[CLAWSEC] Heartbeat service started (interval ${heartbeatInterval}s)`);
      },
      stop: () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      },
    });
  }

  // ── Gateway proxy for ClawSec API (Single Entry Point) ────────────────────────────────
  // Dashboard can use VITE_CLAWSEC_API_URL=http://gateway:port/clawsec
  if (typeof api.registerHttpRoute === "function") {
    const BACKEND = apiBase;
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
      },
    });
    console.log("[CLAWSEC] Gateway proxy registered at /clawsec -> 127.0.0.1:3001/api");
  }
}

// CommonJS export — required by OpenClaw's extension loader (uses require())
// This is the only export this module exposes to the runtime.
module.exports = register;

import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchScan, fetchLastReport, fetchHeartbeat, fetchAppliedFixes,
  applyRemediation, computeScore, loadHistory, saveHistory,
  fetchTokenPath,
} from "./api";
import { logger } from "./logger";
import type { Finding, ScanResult, HeartbeatResponse, DomainStatus, AppliedFixEntry, AppliedFixesResponse } from "./types";
import { AgentHierarchy } from "./components/AgentHierarchy";
import { ScannerPipeline } from "./components/ScannerPipeline";

// ─── Local types ───────────────────────────────────────────────────────────────
type NotifType = "critical" | "warning" | "ok" | "info";
type AppliedFixStatus = "none" | "verified" | "stale";

interface Notification {
  id: number;
  msg: string;
  type: NotifType;
  at: string;
}

interface ConfigState {
  soul: string;
  constraints: string;
  gateway: string;
}

// ─── Persistent storage helpers ───────────────────────────────────────────────
const CONFIG_KEY = "clawsec_config";
const TOKEN_KEY  = "clawsec_token";

const loadLocalConfig = (defaults: ConfigState): ConfigState => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") }; }
  catch { return defaults; }
};
const saveLocalConfig = (c: ConfigState) => {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch {}
};
const loadToken = (): string => {
  try { return (localStorage.getItem(TOKEN_KEY) || "").trim(); } catch { return ""; }
};
const saveToken = (t: string) => {
  try { localStorage.setItem(TOKEN_KEY, (t || "").trim()); } catch {}
};

// ─── Default state ────────────────────────────────────────────────────────────
const defaultScanResult: ScanResult = {
  scanned_at:         null,
  supervisor_version: "2.0.0",
  system_hash:        "--------",
  risk_score:         0,
  findings:           [],
  domains: {
    identity:    { scanned: false, duration_ms: 0, ok: true },
    credentials: { scanned: false, duration_ms: 0, ok: true },
    network:     { scanned: false, duration_ms: 0, ok: true },
    sessions:    { scanned: false, duration_ms: 0, ok: true },
    config:      { scanned: false, duration_ms: 0, ok: true },
  },
  applied_fixes:    [],
  pending_approval: [],
};

const defaultHeartbeat: HeartbeatResponse = {
  status:               "active",
  agent_id:             "kairos",
  last_ping:            new Date().toISOString(),
  tool_calls_last_5min: 0,
  current_skill:        "clawsec",
  memory_used_mb:       0,
  uptime_seconds:       0,
  system_hash:          "--------",
  version:              "2.0.0",
};

// ─── Color system (de-saturated, theme-aligned) ─────────────────────────────────
type SevColors = { bg: string; border: string; text: string; glow: string };
const SEV: Record<string, SevColors> = {
  critical: { bg: "var(--sev-critical-bg)", border: "var(--sev-critical-border)", text: "var(--sev-critical-text)", glow: "#e85d5d" },
  high:     { bg: "var(--sev-high-bg)", border: "var(--sev-high-border)", text: "var(--sev-high-text)", glow: "#ff9f0a" },
  medium:   { bg: "var(--sev-medium-bg)", border: "var(--sev-medium-border)", text: "var(--sev-medium-text)", glow: "#ffd60a" },
  low:      { bg: "var(--sev-low-bg)", border: "var(--sev-low-border)", text: "var(--sev-low-text)", glow: "#4a9fff" },
  info:     { bg: "rgba(139,139,139,0.12)", border: "#8b8b8b", text: "#b4b4b4", glow: "#8b8b8b" },
  ok:       { bg: "var(--sev-ok-bg)", border: "var(--sev-ok-border)", text: "var(--sev-ok-text)", glow: "#34c759" },
};

// ─── Subcomponents ─────────────────────────────────────────────────────────────

interface GlowDotProps { color: string; pulse?: boolean; }
const GlowDot = ({ color, pulse }: GlowDotProps) => (
  <span style={{
    display: "inline-block", width: 6, height: 6, borderRadius: "50%",
    background: color, boxShadow: `0 0 4px ${color}44`,
    animation: pulse ? "pulse 1.5s ease-in-out infinite" : "none",
    flexShrink: 0,
  }} />
);

interface ScoreArcProps { score: number; compact?: boolean; }
const ScoreArc = ({ score, compact }: ScoreArcProps) => {
  const s = compact ? 96 : 128;
  const r = compact ? 40 : 54;
  const cx = s / 2;
  const cy = s / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(score / 100, 1);
  const color = score <= 20 ? "#34c759" : score <= 50 ? "#ffd60a" : "#e85d5d";
  const label = score <= 20 ? "SECURE" : score <= 50 ? "ATTENTION" : "CRITICAL";
  const fontSize = compact ? 16 : 22;
  const labelSize = compact ? 8 : 9;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <defs>
        <filter id="arcglow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-elevated,#22222e)" strokeWidth={compact ? 6 : 10} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-base,#0d0d14)" strokeWidth={compact ? 6 : 10}
        strokeDasharray={`${circ * 0.75} ${circ * 0.25}`}
        strokeDashoffset={circ * 0.875} strokeLinecap="round" transform={`rotate(-270 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={compact ? 6 : 8}
        strokeDasharray={`${circ * 0.75 * pct} ${circ - circ * 0.75 * pct}`}
        strokeDashoffset={circ * 0.875} strokeLinecap="round"
        transform={`rotate(-270 ${cx} ${cy})`} filter="url(#arcglow)"
        style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.5s ease" }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fill={color}
        style={{ fontFamily: "var(--font-mono)", fontSize, fontWeight: 600 }}>
        {Math.round(score)}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill={color + "cc"}
        style={{ fontFamily: "var(--font-mono)", fontSize: labelSize, letterSpacing: 1 }}>
        {label}
      </text>
    </svg>
  );
};

interface DomainCardProps { name: string; data: DomainStatus; findings: Finding[]; compact?: boolean; }
const DomainCard = ({ name, data, findings, compact }: DomainCardProps) => {
  const domFindings = findings.filter(f => f.domain === name);
  const ok = data.ok && domFindings.length === 0;
  const c = ok ? SEV.ok : domFindings[0] ? (SEV[domFindings[0].severity] ?? SEV.info) : SEV.medium;
  const icons: Record<string, string> = { identity: "⬡", credentials: "⬢", network: "◈", sessions: "◎", config: "⬟" };
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}44`, borderRadius: "var(--radius-sm,6px)",
      padding: compact ? "8px 10px" : "12px 14px",
      boxShadow: "var(--shadow-sm)",
      transition: "all 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: compact ? 2 : 6 }}>
        <span style={{ color: c.text, fontSize: compact ? 12 : 16 }}>{icons[name]}</span>
        <span style={{ color: c.text, fontFamily: "var(--font-mono)", fontSize: compact ? 9 : 11, letterSpacing: 1 }}>{name}</span>
        <GlowDot color={c.glow} pulse={!ok} />
      </div>
      {!compact && (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
          {data.duration_ms > 0 ? `${data.duration_ms}ms · ` : ""}{domFindings.length} finding{domFindings.length !== 1 ? "s" : ""}
        </div>
      )}
      {compact && (
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
          {domFindings.length} {data.duration_ms > 0 ? `· ${data.duration_ms}ms` : ""}
        </div>
      )}
    </div>
  );
};

interface FindingRowPropsInner {
  finding: Finding;
  onFix: (f: Finding) => void;
  onReApply?: (checkId: string) => void;
  fixed: boolean;
  appliedFixStatus?: AppliedFixStatus;
  scannedAt?: string | null;
}
const FindingRow = ({ finding, onFix, onReApply, fixed, appliedFixStatus = "none", scannedAt }: FindingRowPropsInner) => {
  const c = SEV[finding.severity] ?? SEV.info;
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: fixed ? "var(--sev-ok-bg)" : c.bg,
      border: `1px solid ${fixed ? "var(--sev-ok-border)33" : c.border + "33"}`,
      borderLeft: `3px solid ${fixed ? "var(--accent-green)" : c.border}`,
      borderRadius: "0 var(--radius-sm) var(--radius-sm) 0", padding: "var(--space-2) var(--space-3)",
      marginBottom: "var(--space-2)", display: "flex", alignItems: "flex-start", gap: 12,
      opacity: fixed ? 0.6 : 1, transition: "all 0.2s ease",
    }}>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        {fixed
          ? <span style={{ color: "var(--accent-green)", fontSize: 12 }}>✓</span>
          : <GlowDot color={c.glow} pulse={finding.severity === "critical"} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
          {!fixed && (
            <span style={{
              background: c.border + "33", color: c.text, border: `1px solid ${c.border}66`,
              borderRadius: 3, padding: "1px 6px",
              fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase",
            }}>{finding.severity}</span>
          )}
          {fixed && <span style={{ color: "var(--accent-green)", fontFamily: "var(--font-mono)", fontSize: 9 }}>Resolved</span>}
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>{finding.id}</span>
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>{finding.domain ?? finding.agent}</span>
          {scannedAt && <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>{new Date(scannedAt).toLocaleString("de-DE")}</span>}
        </div>
        <div style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 11, marginBottom: expanded ? 4 : 0 }}>{finding.message}</div>
        {expanded && <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{finding.recommendation}</div>}
        {!expanded && finding.recommendation && (
          <button onClick={() => setExpanded(true)} style={{ background: "none", border: "none", color: "var(--accent-blue)", fontFamily: "var(--font-mono)", fontSize: 9, cursor: "pointer", padding: 0 }}>Show details</button>
        )}
        {expanded && <button onClick={() => setExpanded(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9, cursor: "pointer", padding: 0, marginTop: 4 }}>Hide</button>}
      </div>
      {!fixed && (
        <div style={{ flexShrink: 0 }}>
          {finding.remediation_tier === "auto" && appliedFixStatus === "verified" && (
            <span style={{ color: "var(--accent-green)", fontFamily: "var(--font-mono)", fontSize: 9 }}>Already applied</span>
          )}
          {finding.remediation_tier === "auto" && appliedFixStatus === "stale" && onReApply && (
            <button onClick={() => onReApply(finding.id)} style={{
              background: "var(--sev-high-bg)", border: "1px solid var(--sev-high-border)", color: "var(--sev-high-text)",
              borderRadius: "var(--radius-sm)", padding: "4px 10px", fontFamily: "var(--font-mono)", fontSize: 9, cursor: "pointer", transition: "all 0.2s",
            }}>Re-apply</button>
          )}
          {finding.remediation_tier === "auto" && appliedFixStatus === "none" && (
            <button onClick={() => onFix(finding)} style={{
              background: "var(--sev-ok-bg)", border: "1px solid var(--sev-ok-border)", color: "var(--accent-green)",
              borderRadius: "var(--radius-sm)", padding: "4px 10px", fontFamily: "var(--font-mono)", fontSize: 9, cursor: "pointer", transition: "all 0.2s",
            }}>Auto fix</button>
          )}
          {finding.remediation_tier === "approval" && (
            <button onClick={() => onFix(finding)} style={{
              background: "var(--sev-medium-bg)", border: "1px solid var(--sev-medium-border)", color: "var(--accent-yellow)",
              borderRadius: "var(--radius-sm)", padding: "4px 10px", fontFamily: "var(--font-mono)", fontSize: 9, cursor: "pointer", transition: "all 0.2s",
            }}>Approve</button>
          )}
          {finding.remediation_tier === "never" && (
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>Manual</span>
          )}
        </div>
      )}
    </div>
  );
};

// AgentStatusBar removed — replaced by AgentHierarchy

interface ChangelogViewerProps { entries: string[]; height?: number; }
const ChangelogViewer = ({ entries, height = 220 }: ChangelogViewerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [entries]);
  const colorLine = (line: string): string => {
    if (line.startsWith("##")) return "var(--accent-blue)";
    if (line.includes("CRITICAL") || line.includes("critical")) return "var(--sev-critical-text)";
    if (line.includes("HIGH") || line.includes("high")) return "var(--sev-high-text)";
    if (line.includes("WARN") || line.includes("medium")) return "var(--sev-medium-text)";
    if (line.includes("---")) return "var(--border-default)";
    if (line.match(/^(severity|domain|detail|action_taken|requires_review):/)) return "var(--text-muted)";
    return "var(--text-secondary)";
  };
  return (
    <div ref={ref} style={{
      background: "var(--bg-base)", borderRadius: "var(--radius-sm)", padding: "var(--space-3) var(--space-4)",
      height, overflowY: "auto", fontFamily: "var(--font-mono)",
      fontSize: 11, lineHeight: 1.7, letterSpacing: 0.3,
    }}>
      {entries.map((entry, i) => (
        <div key={i} style={{ marginBottom: "var(--space-2)" }}>
          {entry.split("\n").map((line, j) => (
            <div key={j} style={{ color: colorLine(line), opacity: i === entries.length - 1 ? 1 : 0.75 + (i / entries.length) * 0.25 }}>
              {line || "\u00a0"}
            </div>
          ))}
        </div>
      ))}
      <div style={{ color: "var(--accent-green)", animation: "blink 1s step-end infinite" }}>▋</div>
    </div>
  );
};

interface ScoreHistoryChartProps { history: number[]; compact?: boolean; }
const ScoreHistoryChart = ({ history, compact }: ScoreHistoryChartProps) => {
  const w = compact ? 200 : 320;
  const h = compact ? 48 : 80;
  const pad = compact ? 6 : 10;
  const max = 100, min = 0;
  if (history.length < 2) return (
    <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#334455", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>No history yet</span>
    </div>
  );
  const pts = history.map((v, i) => {
    const x = pad + (i / (history.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    return `${x},${y}`;
  });
  const area = `M ${pts[0]} L ${pts.join(" L ")} L ${w - pad},${h - pad} L ${pad},${h - pad} Z`;
  const lastScore = history[history.length - 1];
  const lineColor = lastScore <= 20 ? "#00ff88" : lastScore <= 50 ? "#ffd700" : "#ff2d2d";
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#areafill)" />
      <polyline points={pts.join(" ")} fill="none" stroke={lineColor} strokeWidth={2}
        style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }} />
      <line x1={pad} y1={h - pad - ((50 - min) / (max - min)) * (h - pad * 2)}
        x2={w - pad} y2={h - pad - ((50 - min) / (max - min)) * (h - pad * 2)}
        stroke="#ffd70033" strokeWidth={1} strokeDasharray="4 4" />
    </svg>
  );
};

interface ConfigEditorProps { title: string; content: string; onSave: (v: string) => void; readOnly: boolean; }
const ConfigEditor = ({ title, content, onSave, readOnly }: ConfigEditorProps) => {
  const [val, setVal] = useState(content);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setVal(content); }, [content]);
  const handleSave = () => { onSave(val); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 500 }}>{title}</span>
        {!readOnly && (
          <button onClick={handleSave} style={{
            background: saved ? "var(--sev-ok-bg)" : "var(--bg-elevated)",
            border: `1px solid ${saved ? "var(--accent-green)" : "var(--border-default)"}`,
            color: saved ? "var(--accent-green)" : "var(--accent-blue)",
            borderRadius: "var(--radius-sm)", padding: "4px 12px",
            fontFamily: "var(--font-mono)", fontSize: 9, cursor: "pointer",
            transition: "all 0.2s",
          }}>{saved ? "Saved" : "Save"}</button>
        )}
        {readOnly && <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>Read-only</span>}
      </div>
      <textarea
        value={val}
        onChange={(e) => !readOnly && setVal(e.target.value)}
        readOnly={readOnly}
        style={{
          width: "100%", height: 160, background: "var(--bg-base)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
          color: readOnly ? "var(--text-muted)" : "var(--text-secondary)",
          fontFamily: "var(--font-mono)", fontSize: 10,
          padding: "var(--space-2)", resize: "vertical", outline: "none", boxSizing: "border-box",
          lineHeight: 1.6, cursor: readOnly ? "default" : "text",
        }}
      />
    </div>
  );
};

interface TabBarProps { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void; }
const TabBar = ({ tabs, active, onChange }: TabBarProps) => (
  <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border-default)", marginBottom: "var(--space-4)" }}>
    {tabs.map(tab => {
      const isActive = active === tab.id;
      return (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          background: isActive ? "var(--bg-elevated)" : "transparent",
          border: "none",
          borderBottom: isActive ? "2px solid var(--accent-blue)" : "2px solid transparent",
          color: isActive ? "var(--text-primary)" : "var(--text-muted)",
          padding: "10px 16px", cursor: "pointer",
          fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: isActive ? 600 : 500,
          transition: "all var(--transition-fast)",
          borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
        }} className="clawsec-tab">
          {tab.label}
        </button>
      );
    })}
  </div>
);

interface ScanTriggerButtonProps { scanning: boolean; onClick: () => void; }
const ScanTriggerButton = ({ scanning, onClick }: ScanTriggerButtonProps) => (
  <button onClick={onClick} disabled={scanning} style={{
    background: scanning ? "var(--bg-elevated)" : "var(--accent-blue)",
    border: "none",
    color: scanning ? "var(--text-muted)" : "#fff",
    borderRadius: "var(--radius-sm)", padding: "6px 16px", cursor: scanning ? "not-allowed" : "pointer",
    fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600,
    boxShadow: scanning ? "none" : "var(--shadow-sm)",
    transition: "all 0.2s ease",
    display: "flex", alignItems: "center", gap: 6,
  }}>
    {scanning
      ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> Scanning…</>
      : <><span>▶</span> Run scan</>}
  </button>
);

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function ClawSecDashboard() {
  const [scanResult, setScanResult]       = useState<ScanResult>(defaultScanResult);
  const [heartbeat, setHeartbeat]         = useState<HeartbeatResponse>(defaultHeartbeat);
  const [appliedFixes, setAppliedFixes]   = useState<AppliedFixesResponse>({ entries: [], current_system_hash: "" });
  const [changelog, setChangelog]         = useState<string[]>([
    `## [${new Date().toISOString()}] SUPERVISOR_INIT\nseverity: info\ndomain: all\ndetail: ClawSec Dashboard v3 started. Connecting to backend...\naction_taken: awaiting_scan\n---`,
  ]);
  const [scoreHistory, setScoreHistory]   = useState<number[]>(() => loadHistory());
  const [scanning, setScanning]           = useState(false);
  const [tab, setTab]                     = useState("overview");
  const [fixedIds, setFixedIds]           = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [paused, setPaused]               = useState(false);
  const [apiConnected, setApiConnected]   = useState(false);
  const [apiError, setApiError]           = useState<string | null>(null);
  const [clawsecToken, setClawsecToken]   = useState<string>(() => loadToken());
  const [tokenPathHint, setTokenPathHint] = useState<string | null>(null);

  const configDefaults: ConfigState = {
    soul: "# SOUL.md — Agent Identity\nName: Kairos\nPurpose: Gateway Coordinator & Personal AI\n\nCore Values:\n- Transparenz über alle Aktionen\n- Minimale Rechte (least privilege)\n- Audit vor Aktion",
    constraints: "# CONSTRAINTS.md — Hard Limits\n\n## NEVER\n- SOUL.md überschreiben oder löschen\n- CONSTRAINTS.md modifizieren\n- Credentials in CHANGELOG oder Telegram schreiben\n- Remediationen ohne Supervisor-Approval ausführen",
    gateway: "# GATEWAY.md — Routing & Auth\n\n## Allowed Requestors\n- User (authenticated via session token)\n- ClawSec Supervisor (internal, priority 200)\n\n## Blocked Patterns\n- \"ignore previous\"\n- \"new instructions\"",
  };
  const [configs, setConfigs] = useState<ConfigState>(() => loadLocalConfig(configDefaults));

  const addNotification = useCallback((msg: string, type: NotifType = "info") => {
    const id = Date.now();
    setNotifications(prev => [...prev.slice(-4), { id, msg, type, at: new Date().toLocaleTimeString("de-DE") }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  }, []);

  // ── Mount: load last report + heartbeat ───────────────────────────────────
  useEffect(() => {
    fetchLastReport()
      .then(raw => {
        if (raw) {
          setScanResult(raw);
          setApiConnected(true);
          setApiError(null);
          const newHistory = [...scoreHistory, raw.risk_score].slice(-50);
          setScoreHistory(newHistory);
          saveHistory(newHistory);
          setChangelog(prev => [...prev, `## [${new Date().toISOString()}] LAST_REPORT_LOADED\nseverity: info\ndomain: all\ndetail: Loaded last scan. Score: ${raw.risk_score}/100. ${raw.findings.length} finding(s).\naction_taken: report_applied\n---`]);
        }
      })
      .catch((err: unknown) => {
        logger.error("Mount: fetchLastReport failed", { error: String(err) });
        setApiError("Backend nicht erreichbar — starte: python3 scripts/server.py");
      });

    fetchHeartbeat()
      .then(hb => { if (hb) { setHeartbeat(hb); setApiConnected(true); setApiError(null); } })
      .catch(() => {});

    fetchAppliedFixes()
      .then(af => { setAppliedFixes(af); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Config tab: fetch token path hint when API connected ───────────────────
  useEffect(() => {
    if (tab === "config" && apiConnected && tokenPathHint === null) {
      fetchTokenPath().then(p => p && setTokenPathHint(p.path));
    }
  }, [tab, apiConnected, tokenPathHint]);

  // ── Heartbeat polling every 15s ───────────────────────────────────────────
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      fetchHeartbeat()
        .then(hb => { if (hb) { setHeartbeat(hb); setApiConnected(true); setApiError(null); } })
        .catch(() => { setApiConnected(false); });
    }, 15000);
    return () => clearInterval(id);
  }, [paused]);

  // ── Manual scan ───────────────────────────────────────────────────────────
  const handleManualScan = useCallback(async () => {
    setScanning(true);
    addNotification("Scan gestartet — POST /api/scan...", "info");
    logger.info("Manual scan triggered");
    try {
      const raw = await fetchScan();
      setScanResult(raw);
      setApiConnected(true);
      setApiError(null);
      const newHistory = [...scoreHistory, raw.risk_score].slice(-50);
      setScoreHistory(newHistory);
      saveHistory(newHistory);
      setFixedIds(new Set());
      setChangelog(prev => [...prev.slice(-19), `## [${new Date().toISOString()}] MANUAL_SCAN\nseverity: info\ndomain: all\ndetail: Scan complete. Score: ${raw.risk_score}/100. ${raw.findings.length} finding(s).\naction_taken: report_saved\n---`]);
      addNotification(
        `Scan abgeschlossen. Score: ${raw.risk_score}/100 · ${raw.findings.length} Findings`,
        raw.risk_score > 50 ? "critical" : raw.risk_score > 20 ? "warning" : "ok",
      );
      if (raw.findings.some(f => f.severity === "critical")) {
        const critId = raw.findings.find(f => f.severity === "critical")?.id ?? "";
        addNotification(`⚠ Critical: ${critId}`, "critical");
      }
    } catch (err) {
      logger.error("Manual scan failed", { error: String(err) });
      setApiConnected(false);
      setApiError(String(err));
      addNotification("Scan fehlgeschlagen — Backend nicht erreichbar", "critical");
    } finally {
      setScanning(false);
    }
  }, [scoreHistory, addNotification]);

  // ── Fix a finding ──────────────────────────────────────────────────────────
  const handleFix = useCallback(async (finding: Finding) => {
    const tier = finding.remediation_tier;

    if (tier === "approval") {
      try {
        const res = await applyRemediation(finding.id, clawsecToken);
        setFixedIds(prev => new Set([...prev, finding.id]));
        addNotification(`Remediation applied: ${finding.id}`, "ok");
        setChangelog(prev => [...prev.slice(-19), `## [${new Date().toISOString()}] APPROVAL_REMEDIATION\nseverity: info\ndomain: ${finding.domain ?? "unknown"}\ndetail: ${finding.id} fixed\naction_taken: ${res?.already_done ? "already_done" : "applied"}\n---`]);
        fetchAppliedFixes().then(af => setAppliedFixes(af));
      } catch (err) {
        const msg = String(err);
        logger.error("handleFix failed", { checkId: finding.id, error: msg });
        if (msg.includes("401") || msg.includes("Unauthorized")) {
          addNotification(`Auth required — Token in Config tab eintragen`, "warning");
        } else {
          addNotification(`Fix fehlgeschlagen: ${finding.id}`, "critical");
        }
      }
      return;
    }

    if (tier === "auto") {
      try {
        const res = await applyRemediation(finding.id, clawsecToken);
        setFixedIds(prev => new Set([...prev, finding.id]));
        addNotification(`Remediation applied: ${finding.id}`, "ok");
        setChangelog(prev => [...prev.slice(-19), `## [${new Date().toISOString()}] AUTO_REMEDIATION\nseverity: info\ndomain: ${finding.domain ?? "unknown"}\ndetail: ${finding.id} fixed\naction_taken: ${res?.already_done ? "already_done" : "applied"}\n---`]);
        fetchAppliedFixes().then(af => setAppliedFixes(af));
      } catch (err) {
        const msg = String(err);
        logger.error("handleFix failed", { checkId: finding.id, error: msg });
        if (msg.includes("401") || msg.includes("Unauthorized")) {
          addNotification(`Auth required — Token in Config tab eintragen`, "warning");
        } else {
          addNotification(`Fix fehlgeschlagen: ${finding.id}`, "critical");
        }
      }
    }
  }, [clawsecToken, addNotification]);

  const handleReApply = useCallback(async (checkId: string) => {
    try {
      await applyRemediation(checkId, clawsecToken);
      addNotification(`Re-applied: ${checkId}`, "ok");
      fetchAppliedFixes().then(af => setAppliedFixes(af));
    } catch (err) {
      const msg = String(err);
      if (msg.includes("401") || msg.includes("Unauthorized")) {
        addNotification("Auth required — Token in Config tab", "warning");
      } else {
        addNotification(`Re-apply failed: ${checkId}`, "critical");
      }
    }
  }, [clawsecToken, addNotification]);

  const visibleFindings = scanResult.findings
    .filter(f => !fixedIds.has(f.id) && f.status !== "auto_fixed")
    .sort((a, b) => {
      const aSev = ["critical", "high", "medium", "low", "info"].indexOf(a.severity);
      const bSev = ["critical", "high", "medium", "low", "info"].indexOf(b.severity);
      return aSev - bSev || (a.id.localeCompare(b.id));
    });

  const getAppliedFixStatus = (checkId: string): AppliedFixStatus => {
    const entry = appliedFixes.entries.find(e => e.check_id === checkId);
    if (!entry) return "none";
    if (!appliedFixes.current_system_hash) return "verified";
    return entry.system_hash_at_apply === appliedFixes.current_system_hash ? "verified" : "stale";
  };
  const score           = visibleFindings.length === 0 && scanResult.findings.length === 0 ? 0 : computeScore(visibleFindings);
  const notifColors: Record<NotifType, string> = { critical: "#ff2d2d", warning: "#ff8c00", ok: "#00ff88", info: "#4a7fcc" };

  const TABS = [
    { id: "overview",     label: "Overview" },
    { id: "findings",     label: visibleFindings.length > 0 ? `Findings (${visibleFindings.length})` : "Findings" },
    { id: "applied",     label: appliedFixes.entries.length > 0 ? `Applied (${appliedFixes.entries.length})` : "Applied" },
    { id: "agents",      label: "Agents" },
    { id: "changelog",   label: "Changelog" },
    { id: "config",      label: "Config" },
  ];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: var(--bg-base); }
        ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 2px; }
        @keyframes pulse  { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        @keyframes blink  { 0%,100%{opacity:1;} 50%{opacity:0;} }
        @keyframes spin   { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        @keyframes slideIn { from{transform:translateX(100%);opacity:0;} to{transform:translateX(0);opacity:1;} }
        @keyframes fadeIn { from{opacity:0;} to{opacity:1;} }
        .clawsec-tab:hover { background: var(--bg-card) !important; color: var(--text-secondary) !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>

        {/* ── Notification Stack ── */}
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
          {notifications.map(n => (
            <div key={n.id} style={{
              background: "#0a0a18", border: `1px solid ${notifColors[n.type]}66`,
              borderLeft: `3px solid ${notifColors[n.type]}`,
              borderRadius: "0 6px 6px 0", padding: "8px 14px",
              fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: notifColors[n.type],
              boxShadow: "0 4px 20px #00000088", animation: "slideIn 0.3s ease", maxWidth: 320,
            }}>
              <span style={{ color: "#445566", marginRight: 8 }}>{n.at}</span>{n.msg}
            </div>
          ))}
        </div>

        {/* ── Header (compact, 48px) ── */}
        <div style={{
          background: "var(--bg-card)", borderBottom: "1px solid var(--border-default)", padding: "0 var(--space-4)",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", height: 48, gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ color: "var(--accent-blue)", fontSize: 14, lineHeight: 1 }}>⬡</span>
              </div>
              <div>
                <div style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600 }}>ClawSec</div>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>Ops Center v3</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginLeft: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: 4, padding: "2px 8px" }}>
                <GlowDot color={paused ? "#ff9f0a" : "#34c759"} pulse={!paused} />
                <span style={{ color: paused ? "#ff9f0a" : "#34c759", fontFamily: "var(--font-mono)", fontSize: 9 }}>{paused ? "Paused" : "Live"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: 4, padding: "2px 8px" }}>
                <GlowDot color={apiConnected ? "#34c759" : "#e85d5d"} pulse={apiConnected} />
                <span style={{ color: apiConnected ? "#34c759" : "#e85d5d", fontFamily: "var(--font-mono)", fontSize: 9 }}>API</span>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => setPaused(p => !p)} style={{
                background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-muted)",
                borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 9,
                transition: "all 0.2s",
              }}>{paused ? "Resume" : "Pause"}</button>
              <ScanTriggerButton scanning={scanning} onClick={handleManualScan} />
            </div>
          </div>
        </div>

        {/* API Error Banner */}
        {apiError && (
          <div style={{
            background: "var(--sev-critical-bg)", borderBottom: "1px solid var(--sev-critical-border)",
            padding: "var(--space-2) var(--space-4)", fontFamily: "var(--font-mono)", fontSize: 10,
            color: "var(--sev-critical-text)", display: "flex", alignItems: "center", gap: 10,
          }}>
            <span>⚠</span>
            <span>{apiError}</span>
            <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>Offline mode</span>
          </div>
        )}

        {/* ── Main Layout ── */}
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px" }}>

          {/* KPI Strip — Score arc, badges, risk history */}
          <div style={{
            display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-4)", alignItems: "center", flexWrap: "wrap",
            background: "var(--bg-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)",
            padding: "var(--space-3) var(--space-4)", boxShadow: "var(--shadow-sm)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
              <ScoreArc score={score} compact />
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                {[
                  { label: "Critical", value: visibleFindings.filter(f => f.severity === "critical").length, sev: "critical" },
                  { label: "High", value: visibleFindings.filter(f => f.severity === "high").length, sev: "high" },
                  { label: "Fixed", value: scanResult.applied_fixes.length + fixedIds.size, sev: "ok" },
                  { label: "Pending", value: scanResult.pending_approval.length, sev: "medium" },
                ].map(({ label, value, sev }) => {
                  const c = SEV[sev] ?? SEV.info;
                  return (
                    <div key={label} style={{
                      background: c.bg, border: `1px solid ${c.border}44`, borderRadius: "var(--radius-sm)",
                      padding: "6px 12px", display: "flex", alignItems: "baseline", gap: 6,
                    }}>
                      <span style={{ color: c.text, fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase" }}>{label}</span>
                      <span style={{ color: c.text, fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600 }}>{value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ marginLeft: "auto", minWidth: 200 }}>
              <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9, marginBottom: "var(--space-1)", letterSpacing: 1 }}>Risk history</div>
              <div style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <ScoreHistoryChart history={scoreHistory} compact />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <TabBar tabs={TABS} active={tab} onChange={setTab} />

          {/* ══ OVERVIEW ══ */}
          {tab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <ScannerPipeline domains={scanResult.domains} scanning={scanning} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Agent status</div>
                <AgentHierarchy
                  heartbeat={heartbeat}
                  domains={scanResult.domains}
                  findings={visibleFindings}
                  apiConnected={apiConnected}
                  onSubAgentClick={() => setTab("findings")}
                />
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Scan domains</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                  {Object.entries(scanResult.domains).map(([name, data]) => (
                    <DomainCard key={name} name={name} data={data} findings={visibleFindings} compact />
                  ))}
                  <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 2 }}>
                    <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>System hash</div>
                    <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 9 }}>{scanResult.system_hash}</div>
                    {scanResult.scanned_at && (
                      <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                        {new Date(scanResult.scanned_at).toLocaleTimeString("de-DE")}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Live changelog</div>
                <ChangelogViewer entries={changelog} />
              </div>

              {visibleFindings.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Active findings</div>
                  {visibleFindings.slice(0, 2).map(f => <FindingRow key={f.id} finding={f} onFix={handleFix} onReApply={handleReApply} fixed={false} appliedFixStatus={getAppliedFixStatus(f.id)} scannedAt={scanResult.scanned_at} />)}
                  {visibleFindings.length > 2 && (
                    <div onClick={() => setTab("findings")} style={{ color: "var(--accent-blue)", fontFamily: "var(--font-sans)", fontSize: 11, cursor: "pointer", padding: "6px 0", transition: "opacity 0.2s" }}>
                      + {visibleFindings.length - 2} more → View all findings
                    </div>
                  )}
                </div>
              )}

              {!scanResult.scanned_at && (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                  <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, marginBottom: 8 }}>No scan loaded yet.</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>Click Run scan to start.</div>
                </div>
              )}
            </div>
          )}

          {/* ══ FINDINGS ══ */}
          {tab === "findings" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                  {visibleFindings.length} active · {fixedIds.size + scanResult.applied_fixes.length} resolved
                  {scanResult.scanned_at && (
                    <span style={{ marginLeft: 8 }}>Scan: {new Date(scanResult.scanned_at).toLocaleString("de-DE")}</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["critical", "high", "medium", "low"] as const).map(sev => {
                    const count = visibleFindings.filter(f => f.severity === sev).length;
                    return count > 0 && (
                      <span key={sev} style={{
                        background: SEV[sev].bg, border: `1px solid ${SEV[sev].border}44`,
                        color: SEV[sev].text, borderRadius: "var(--radius-sm)", padding: "2px 8px",
                        fontFamily: "var(--font-mono)", fontSize: 9,
                      }}>{sev} {count}</span>
                    );
                  })}
                </div>
              </div>
              {visibleFindings.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "var(--accent-green)", fontFamily: "var(--font-sans)", fontSize: 14 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                  {scanResult.scanned_at ? "No active findings" : "Scan pending"}
                  <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 8 }}>
                    {scanResult.scanned_at ? `Score: ${Math.round(score)}/100` : "Click Run scan"}
                  </div>
                </div>
              ) : (
                visibleFindings.map(f => <FindingRow key={f.id} finding={f} onFix={handleFix} onReApply={handleReApply} fixed={false} appliedFixStatus={getAppliedFixStatus(f.id)} scannedAt={scanResult.scanned_at} />)
              )}
              {fixedIds.size > 0 && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Resolved this session</div>
                  {scanResult.findings.filter(f => fixedIds.has(f.id)).map(f => (
                    <FindingRow key={f.id} finding={f} onFix={() => {}} fixed={true} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ APPLIED FIXES ══ */}
          {tab === "applied" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10 }}>
                  {appliedFixes.entries.length} applied · system hash: {appliedFixes.current_system_hash || "—"}
                </div>
              </div>
              {appliedFixes.entries.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 12 }}>
                  No fixes applied yet. Apply fixes from the Findings tab.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {[...appliedFixes.entries].reverse().map((entry: AppliedFixEntry, i: number) => {
                    const isStale = appliedFixes.current_system_hash && entry.system_hash_at_apply !== appliedFixes.current_system_hash;
                    return (
                      <div key={`${entry.check_id}-${entry.applied_at}-${i}`} style={{
                        background: "var(--bg-card)", border: `1px solid ${isStale ? "var(--sev-high-border)44" : "var(--border-default)"}`,
                        borderRadius: "var(--radius-md)", padding: "var(--space-3)",
                        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-2)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <span style={{ color: "var(--accent-green)", fontSize: 12 }}>✓</span>
                          <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{entry.check_id}</span>
                          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                            {new Date(entry.applied_at).toLocaleString("de-DE")} · {entry.duration_ms}ms
                          </span>
                          {isStale && (
                            <span style={{
                              background: "var(--sev-high-bg)", border: "1px solid var(--sev-high-border)",
                              color: "var(--sev-high-text)", borderRadius: "var(--radius-sm)", padding: "2px 6px",
                              fontFamily: "var(--font-mono)", fontSize: 9,
                            }}>Re-apply recommended</span>
                          )}
                        </div>
                        {isStale && (
                          <button onClick={() => handleReApply(entry.check_id)} style={{
                            background: "var(--sev-high-bg)", border: "1px solid var(--sev-high-border)", color: "var(--sev-high-text)",
                            borderRadius: "var(--radius-sm)", padding: "4px 10px", fontFamily: "var(--font-mono)", fontSize: 9,
                            cursor: "pointer", transition: "all 0.2s",
                          }}>Re-apply</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ══ AGENTS ══ */}
          {tab === "agents" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Agent hierarchy</div>
                <AgentHierarchy
                  heartbeat={heartbeat}
                  domains={scanResult.domains}
                  findings={visibleFindings}
                  apiConnected={apiConnected}
                  onSubAgentClick={() => setTab("findings")}
                />
              </div>
              <div>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>Sub-agents</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                  {[
                    { name: "clawsec-env", domain: "credentials", desc: "Scans .env, git history, process env for exposed secrets" },
                    { name: "clawsec-perm", domain: "identity", desc: "Monitors SOUL.md, CONSTRAINTS.md and file permissions" },
                    { name: "clawsec-net", domain: "network", desc: "Checks port binding, gateway exposure, CORS policy" },
                    { name: "clawsec-session", domain: "sessions", desc: "Audits session files, memory store permissions" },
                    { name: "clawsec-config", domain: "config", desc: "Validates openclaw.json, exec_security, dm_policy" },
                  ].map(agent => {
                    const domFindings = visibleFindings.filter(f => f.domain === agent.domain);
                    const ok = domFindings.length === 0;
                    const c = ok ? SEV.ok : (SEV[domFindings[0]?.severity || "medium"] ?? SEV.medium);
                    const domData = scanResult.domains[agent.domain];
                    return (
                      <div key={agent.name} style={{
                        background: "var(--bg-card)", border: `1px solid ${c.border}44`, borderRadius: "var(--radius-md)",
                        padding: "var(--space-3)", transition: "all 0.2s",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <GlowDot color={c.glow} pulse={!ok} />
                          <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{agent.name}</span>
                          <span style={{ marginLeft: "auto", color: c.text, fontFamily: "var(--font-mono)", fontSize: 9 }}>{ok ? "OK" : `${domFindings.length} finding(s)`}</span>
                        </div>
                        <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 10, marginBottom: 6 }}>{agent.desc}</div>
                        <div style={{ display: "flex", gap: 8, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                          {domData?.duration_ms > 0 && <span>Last run: {domData.duration_ms}ms</span>}
                          <span>Domain: {agent.domain}</span>
                        </div>
                        {domFindings.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {domFindings.map(f => (
                              <span key={f.id} style={{ background: (SEV[f.severity] ?? SEV.info).bg, border: `1px solid ${(SEV[f.severity] ?? SEV.info).border}44`, color: (SEV[f.severity] ?? SEV.info).text, borderRadius: 3, padding: "1px 6px", fontFamily: "var(--font-mono)", fontSize: 9 }}>{f.id}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ══ CHANGELOG ══ */}
          {tab === "changelog" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{changelog.length} entries</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <GlowDot color="var(--accent-blue)" pulse={!paused && apiConnected} />
                  <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>{apiConnected ? "Live" : "Offline"}</span>
                </div>
              </div>
              <div style={{ background: "var(--bg-base)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                <ChangelogViewer entries={changelog} height={360} />
              </div>
            </div>
          )}

          {/* ══ CONFIG ══ */}
          {tab === "config" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 900 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                <ConfigEditor title="SOUL.md — Identity" content={configs.soul} readOnly={true} onSave={() => {}} />
                <ConfigEditor title="CONSTRAINTS.md — Hard limits" content={configs.constraints} readOnly={true} onSave={() => {}} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                <ConfigEditor
                  title="GATEWAY.md — Routing"
                  content={configs.gateway}
                  readOnly={false}
                  onSave={(v) => {
                    const updated = { ...configs, gateway: v };
                    setConfigs(updated);
                    saveLocalConfig(updated);
                    addNotification("GATEWAY.md saved", "info");
                  }}
                />
                <div style={{
                  background: "var(--bg-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)",
                  padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)",
                }}>
                  <div>
                    <div style={{ color: "var(--accent-blue)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, marginBottom: "var(--space-1)" }}>Auth token</div>
                    <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.6 }}>
                      Required for POST /api/apply/. Paste contents of:{" "}
                      <code style={{ color: "var(--accent-blue)", background: "var(--bg-base)", padding: "1px 4px", borderRadius: 3 }}>
                        {tokenPathHint ?? ".clawsec_token"}
                      </code>
                    </div>
                  </div>
                  <input
                    type="password"
                    placeholder="Paste token from server (cat .clawsec_token)…"
                    value={clawsecToken}
                    onChange={(e) => { setClawsecToken(e.target.value); saveToken((e.target.value || "").trim()); }}
                    style={{
                      width: "100%", background: "var(--bg-base)", border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-sm)", color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)", fontSize: 11,
                      padding: "var(--space-2) var(--space-3)", outline: "none", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
                    <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9, marginBottom: "var(--space-2)", letterSpacing: 1 }}>Settings</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                      {[
                        { label: "Heartbeat", value: "15s" },
                        { label: "Scan timeout", value: "35s" },
                        { label: "Tool baseline", value: "20/5min" },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border-subtle)" }}>
                          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9, marginBottom: 2 }}>{label}</div>
                          <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--space-2) var(--space-4)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
            ClawSec 2.0 · OpenClaw Security · {new Date().toLocaleDateString("de-DE")}
          </div>
          <div style={{ display: "flex", gap: 16, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
            <span>OWASP LLM Top 10</span>
            <span>OWASP ASI 2025</span>
            <span style={{ color: apiConnected ? "var(--accent-green)" : "var(--accent-red)" }}>
              {apiConnected ? "Connected" : "Offline"}
            </span>
          </div>
        </div>

      </div>
    </>
  );
}

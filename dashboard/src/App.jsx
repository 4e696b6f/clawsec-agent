import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchScan, fetchLastReport, fetchHeartbeat,
  applyRemediation, computeScore, loadHistory, saveHistory,
} from "./api.js";

// ─── Persistent storage helpers ───────────────────────────────────────────────
const CONFIG_KEY = "clawsec_config";
const TOKEN_KEY  = "clawsec_token";

const loadLocalConfig = (defaults) => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") }; }
  catch { return defaults; }
};
const saveLocalConfig = (c) => {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch {}
};
const loadToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
};
const saveToken = (t) => {
  try { localStorage.setItem(TOKEN_KEY, t); } catch {}
};

// ─── Default state ────────────────────────────────────────────────────────────
const defaultScanResult = {
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

const defaultHeartbeat = {
  status:               "active",
  agent_id:             "kairos",
  last_ping:            new Date().toISOString(),
  tool_calls_last_5min: 0,
  current_skill:        "clawsec",
  memory_used_mb:       0,
  uptime_seconds:       0,
};

// ─── Color system ──────────────────────────────────────────────────────────────
const SEV = {
  critical: { bg: "#ff2d2d22", border: "#ff2d2d", text: "#ff6b6b", glow: "#ff2d2d" },
  high:     { bg: "#ff8c0022", border: "#ff8c00", text: "#ffb347", glow: "#ff8c00" },
  medium:   { bg: "#ffd70022", border: "#ffd700", text: "#ffe55c", glow: "#ffd700" },
  low:      { bg: "#00bfff22", border: "#00bfff", text: "#7dd3fc", glow: "#00bfff" },
  info:     { bg: "#8b8b8b22", border: "#8b8b8b", text: "#b4b4b4", glow: "#8b8b8b" },
  ok:       { bg: "#00ff8822", border: "#00ff88", text: "#6bffb8", glow: "#00ff88" },
};

// ─── Subcomponents ─────────────────────────────────────────────────────────────

const GlowDot = ({ color, pulse }) => (
  <span style={{
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: color, boxShadow: `0 0 6px ${color}, 0 0 12px ${color}44`,
    animation: pulse ? "pulse 1.5s ease-in-out infinite" : "none",
    flexShrink: 0,
  }} />
);

const ScoreArc = ({ score }) => {
  const r = 54, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(score / 100, 1);
  const color = score <= 20 ? "#00ff88" : score <= 50 ? "#ffd700" : "#ff2d2d";
  const label = score <= 20 ? "SECURE" : score <= 50 ? "ATTENTION" : "CRITICAL";
  return (
    <svg width={128} height={128} viewBox="0 0 128 128">
      <defs>
        <filter id="arcglow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a2e" strokeWidth={10} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0f0f1e" strokeWidth={10}
        strokeDasharray={`${circ * 0.75} ${circ * 0.25}`}
        strokeDashoffset={circ * 0.875} strokeLinecap="round" transform="rotate(-270 64 64)" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${circ * 0.75 * pct} ${circ - circ * 0.75 * pct}`}
        strokeDashoffset={circ * 0.875} strokeLinecap="round"
        transform="rotate(-270 64 64)" filter="url(#arcglow)"
        style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.5s ease" }} />
      <text x={cx} y={cy - 8} textAnchor="middle" fill={color}
        style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 22, fontWeight: 700 }}>
        {Math.round(score)}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill={color + "cc"}
        style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2 }}>
        {label}
      </text>
    </svg>
  );
};

const DomainCard = ({ name, data, findings }) => {
  const domFindings = findings.filter(f => f.domain === name);
  const ok = data.ok && domFindings.length === 0;
  const c = ok ? SEV.ok : domFindings[0] ? SEV[domFindings[0].severity] : SEV.medium;
  const icons = { identity: "⬡", credentials: "⬢", network: "◈", sessions: "◎", config: "⬟" };
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}44`, borderRadius: 8,
      padding: "12px 14px",
      boxShadow: ok ? `inset 0 0 20px ${c.glow}08` : `inset 0 0 20px ${c.glow}12`,
      transition: "all 0.4s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: c.text, fontSize: 16 }}>{icons[name]}</span>
        <span style={{ color: c.text, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>{name}</span>
        <GlowDot color={c.glow} pulse={!ok} />
      </div>
      <div style={{ color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
        {data.duration_ms > 0 ? `${data.duration_ms}ms · ` : ""}{domFindings.length} finding{domFindings.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
};

const FindingRow = ({ finding, onFix, fixed }) => {
  const c = SEV[finding.severity] || SEV.info;
  return (
    <div style={{
      background: fixed ? "#0a1a0a" : c.bg,
      border: `1px solid ${fixed ? "#00ff8833" : c.border + "33"}`,
      borderLeft: `3px solid ${fixed ? "#00ff88" : c.border}`,
      borderRadius: "0 6px 6px 0", padding: "10px 14px",
      marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 12,
      opacity: fixed ? 0.5 : 1, transition: "all 0.4s ease",
    }}>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        {fixed
          ? <span style={{ color: "#00ff88", fontSize: 12 }}>✓</span>
          : <GlowDot color={c.glow} pulse={finding.severity === "critical"} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
          {!fixed && (
            <span style={{
              background: c.border + "33", color: c.text, border: `1px solid ${c.border}66`,
              borderRadius: 3, padding: "1px 7px",
              fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
            }}>{finding.severity}</span>
          )}
          {fixed && <span style={{ color: "#00ff88", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>RESOLVED</span>}
          <span style={{ color: "#777", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.id}</span>
          <span style={{ color: "#445", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.agent}</span>
          {finding.owasp_llm && <span style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.owasp_llm}</span>}
          {finding.owasp_asi && <span style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.owasp_asi}</span>}
        </div>
        <div style={{ color: "#d4d4d4", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginBottom: 4 }}>{finding.message}</div>
        <div style={{ color: "#666", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>{finding.recommendation}</div>
      </div>
      {!fixed && (
        <div style={{ flexShrink: 0 }}>
          {finding.remediation_tier === "auto" && (
            <button onClick={() => onFix(finding)} style={{
              background: "#00ff8822", border: "1px solid #00ff8866", color: "#00ff88",
              borderRadius: 4, padding: "4px 10px",
              fontFamily: "'Share Tech Mono', monospace", fontSize: 9, cursor: "pointer", letterSpacing: 1,
            }}>AUTO FIX</button>
          )}
          {finding.remediation_tier === "approval" && (
            <button onClick={() => onFix(finding)} style={{
              background: "#ffd70022", border: "1px solid #ffd70066", color: "#ffd700",
              borderRadius: 4, padding: "4px 10px",
              fontFamily: "'Share Tech Mono', monospace", fontSize: 9, cursor: "pointer", letterSpacing: 1,
            }}>APPROVE</button>
          )}
          {finding.remediation_tier === "never" && (
            <span style={{ color: "#444", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>MANUAL</span>
          )}
        </div>
      )}
    </div>
  );
};

const AgentStatusBar = ({ heartbeat, apiConnected }) => {
  const isActive = heartbeat.status === "active";
  const c = isActive ? SEV.ok : SEV.high;
  const upHours = Math.floor(heartbeat.uptime_seconds / 3600);
  const upMins = Math.floor((heartbeat.uptime_seconds % 3600) / 60);
  return (
    <div style={{
      background: "#0a0a16", border: `1px solid ${c.border}44`,
      borderRadius: 8, padding: "14px 18px",
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: c.bg, border: `2px solid ${c.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 12px ${c.glow}44`,
          fontFamily: "'Share Tech Mono', monospace", fontSize: 14, color: c.text,
        }}>K</div>
        <div>
          <div style={{ color: "#e0e0e0", fontFamily: "'Share Tech Mono', monospace", fontSize: 12, letterSpacing: 1 }}>KAIROS</div>
          <div style={{ color: c.text, fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>{heartbeat.status}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[
          { label: "SKILL",    value: (heartbeat.current_skill || "—").toUpperCase() },
          { label: "TOOLS/5m", value: heartbeat.tool_calls_last_5min },
          { label: "MEM",      value: heartbeat.memory_used_mb > 0 ? heartbeat.memory_used_mb + "MB" : "—" },
          { label: "UPTIME",   value: heartbeat.uptime_seconds > 0 ? `${upHours}h ${upMins}m` : "—" },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>{label}</div>
            <div style={{ color: "#9aafcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 12 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>API</div>
        <div style={{ color: apiConnected ? "#00ff88" : "#ff2d2d", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
          {apiConnected ? "LIVE" : "OFFLINE"}
        </div>
      </div>
    </div>
  );
};

const ChangelogViewer = ({ entries }) => {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [entries]);
  const colorLine = (line) => {
    if (line.startsWith("##")) return "#7c9fcc";
    if (line.includes("CRITICAL") || line.includes("critical")) return "#ff6b6b";
    if (line.includes("HIGH") || line.includes("high")) return "#ffb347";
    if (line.includes("WARN") || line.includes("medium")) return "#ffe55c";
    if (line.includes("---")) return "#333";
    if (line.match(/^(severity|domain|detail|action_taken|requires_review):/)) return "#778899";
    return "#8899aa";
  };
  return (
    <div ref={ref} style={{
      background: "#050510", borderRadius: 6, padding: "12px 14px",
      height: 260, overflowY: "auto", fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, lineHeight: 1.7,
    }}>
      {entries.map((entry, i) => (
        <div key={i}>
          {entry.split("\n").map((line, j) => (
            <div key={j} style={{ color: colorLine(line), opacity: i === entries.length - 1 ? 1 : 0.7 + (i / entries.length) * 0.3 }}>
              {line || "\u00a0"}
            </div>
          ))}
        </div>
      ))}
      <div style={{ color: "#00ff88", animation: "blink 1s step-end infinite" }}>▋</div>
    </div>
  );
};

const ScoreHistoryChart = ({ history }) => {
  const w = 320, h = 80, pad = 10;
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

const ConfigEditor = ({ title, content, onSave, readOnly }) => {
  const [val, setVal] = useState(content);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setVal(content); }, [content]);
  const handleSave = () => {
    onSave(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#7c9fcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1 }}>{title}</span>
        {!readOnly && (
          <button onClick={handleSave} style={{
            background: saved ? "#00ff8822" : "#0a1628",
            border: `1px solid ${saved ? "#00ff88" : "#2a3f5f"}`,
            color: saved ? "#00ff88" : "#7c9fcc",
            borderRadius: 4, padding: "4px 12px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: 9, cursor: "pointer",
            letterSpacing: 1, transition: "all 0.3s",
          }}>{saved ? "✓ SAVED" : "SAVE"}</button>
        )}
        {readOnly && <span style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>READ-ONLY (chmod 444)</span>}
      </div>
      <textarea
        value={val}
        onChange={(e) => !readOnly && setVal(e.target.value)}
        readOnly={readOnly}
        style={{
          width: "100%", height: 180, background: readOnly ? "#030308" : "#050510",
          border: "1px solid #1a1a2e", borderRadius: 6,
          color: readOnly ? "#445566" : "#8899aa",
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          padding: 12, resize: "vertical", outline: "none", boxSizing: "border-box",
          lineHeight: 1.7, cursor: readOnly ? "default" : "text",
        }}
      />
    </div>
  );
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #0f0f1e", marginBottom: 20 }}>
    {tabs.map(tab => (
      <button key={tab.id} onClick={() => onChange(tab.id)} style={{
        background: active === tab.id ? "#0a1628" : "transparent",
        border: "none", borderBottom: active === tab.id ? "2px solid #4a7fcc" : "2px solid transparent",
        color: active === tab.id ? "#9aafcc" : "#445566",
        padding: "10px 18px", cursor: "pointer",
        fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 1.5,
        transition: "all 0.2s",
      }}>{tab.label}</button>
    ))}
  </div>
);

const ScanTriggerButton = ({ scanning, onClick }) => (
  <button onClick={onClick} disabled={scanning} style={{
    background: "#0a1628",
    border: `1px solid ${scanning ? "#2a3f5f" : "#4a7fcc"}`,
    color: scanning ? "#445566" : "#7cb4ff",
    borderRadius: 6, padding: "8px 20px", cursor: scanning ? "not-allowed" : "pointer",
    fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2,
    boxShadow: scanning ? "none" : "0 0 12px #4a7fcc22",
    transition: "all 0.3s",
    display: "flex", alignItems: "center", gap: 8,
  }}>
    {scanning
      ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> SCANNING...</>
      : <><span>▶</span> RUN SCAN</>}
  </button>
);

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function ClawSecDashboard() {
  const [scanResult, setScanResult]     = useState(defaultScanResult);
  const [heartbeat, setHeartbeat]       = useState(defaultHeartbeat);
  const [changelog, setChangelog]       = useState([
    `## [${new Date().toISOString()}] SUPERVISOR_INIT\nseverity: info\ndomain: all\ndetail: ClawSec Dashboard v3 started. Connecting to backend...\naction_taken: awaiting_scan\n---`,
  ]);
  const [scoreHistory, setScoreHistory] = useState(() => loadHistory());
  const [scanning, setScanning]         = useState(false);
  const [tab, setTab]                   = useState("overview");
  const [fixedIds, setFixedIds]         = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [paused, setPaused]             = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [apiError, setApiError]         = useState(null);
  const [clawsecToken, setClawsecToken] = useState(() => loadToken());

  const configDefaults = {
    soul: "# SOUL.md — Agent Identity\nName: Kairos\nPurpose: Gateway Coordinator & Personal AI\n\nCore Values:\n- Transparency über alle Aktionen\n- Minimale Rechte (least privilege)\n- Audit vor Aktion",
    constraints: "# CONSTRAINTS.md — Hard Limits\n\n## NEVER\n- SOUL.md überschreiben oder löschen\n- CONSTRAINTS.md modifizieren\n- Credentials in CHANGELOG oder Telegram schreiben\n- Remediationen ohne Supervisor-Approval ausführen",
    gateway: "# GATEWAY.md — Routing & Auth\n\n## Allowed Requestors\n- User (authenticated via session token)\n- ClawSec Supervisor (internal, priority 200)\n\n## Blocked Patterns\n- \"ignore previous\"\n- \"new instructions\"",
  };
  const [configs, setConfigs] = useState(() => loadLocalConfig(configDefaults));

  const addNotification = useCallback((msg, type = "info") => {
    const id = Date.now();
    setNotifications(prev => [...prev.slice(-4), { id, msg, type, at: new Date().toLocaleTimeString("de-DE") }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  }, []);

  const applyNormalizedScan = useCallback((raw) => {
    if (!raw) return;
    // Flatten agent_results → findings with .agent and .domain
    const AGENT_DOMAIN = {
      "clawsec-env":     "credentials",
      "clawsec-perm":    "identity",
      "clawsec-net":     "network",
      "clawsec-session": "sessions",
      "clawsec-config":  "config",
    };
    const findings = [];
    const domains  = { identity: { ok: true, duration_ms: 0, scanned: false }, credentials: { ok: true, duration_ms: 0, scanned: false }, network: { ok: true, duration_ms: 0, scanned: false }, sessions: { ok: true, duration_ms: 0, scanned: false }, config: { ok: true, duration_ms: 0, scanned: false } };

    for (const [agentName, agentResult] of Object.entries(raw.agent_results || {})) {
      const domain = AGENT_DOMAIN[agentName] || "config";
      const dur    = agentResult.scan_duration_ms || 0;
      domains[domain] = { scanned: true, duration_ms: dur, ok: (agentResult.findings || []).length === 0 };
      for (const f of agentResult.findings || []) {
        findings.push({ ...f, agent: agentName, domain, owasp_llm: f.owasp_llm === "null" ? null : f.owasp_llm, owasp_asi: f.owasp_asi === "null" ? null : f.owasp_asi });
      }
    }

    const applied   = findings.filter(f => f.status === "auto_fixed").map(f => f.id);
    const pending   = findings.filter(f => f.status === "pending_approval").map(f => f.id);
    const score     = computeScore(findings.filter(f => f.status !== "auto_fixed"));

    setScanResult({
      scanned_at:         raw.timestamp || new Date().toISOString(),
      supervisor_version: raw.version || "2.0.0",
      system_hash:        raw.system_hash || "--------",
      risk_score:         score,
      findings,
      domains,
      applied_fixes:    applied,
      pending_approval: pending,
    });
    return { score, findings };
  }, []);

  // ── Mount: load last report + heartbeat ───────────────────────────────────
  useEffect(() => {
    fetchLastReport()
      .then(raw => {
        if (raw) {
          const result = applyNormalizedScan(raw);
          if (result) {
            setApiConnected(true);
            setApiError(null);
            const newHistory = [...scoreHistory, result.score].slice(-50);
            setScoreHistory(newHistory);
            saveHistory(newHistory);
            setChangelog(prev => [...prev, `## [${new Date().toISOString()}] LAST_REPORT_LOADED\nseverity: info\ndomain: all\ndetail: Loaded last scan. Score: ${result.score}/100. ${result.findings.length} finding(s).\naction_taken: report_applied\n---`]);
          }
        }
      })
      .catch(() => {
        setApiError("Backend nicht erreichbar — starte: python3 scripts/server.py");
      });

    fetchHeartbeat()
      .then(hb => { if (hb) { setHeartbeat(hb); setApiConnected(true); setApiError(null); } })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    try {
      const raw = await fetchScan();
      const result = applyNormalizedScan(raw);
      if (result) {
        setApiConnected(true);
        setApiError(null);
        const newHistory = [...scoreHistory, result.score].slice(-50);
        setScoreHistory(newHistory);
        saveHistory(newHistory);
        setFixedIds(new Set()); // reset local fixes on new scan
        setChangelog(prev => [...prev.slice(-19), `## [${new Date().toISOString()}] MANUAL_SCAN\nseverity: info\ndomain: all\ndetail: Scan complete. Score: ${result.score}/100. ${result.findings.length} finding(s).\naction_taken: report_saved\n---`]);
        addNotification(`Scan abgeschlossen. Score: ${result.score}/100 · ${result.findings.length} Findings`, result.score > 50 ? "critical" : result.score > 20 ? "warning" : "ok");
        if (result.findings.some(f => f.severity === "critical")) {
          addNotification(`⚠ Critical: ${result.findings.find(f => f.severity === "critical")?.id}`, "critical");
        }
      }
    } catch (err) {
      setApiConnected(false);
      setApiError(String(err));
      addNotification("Scan fehlgeschlagen — Backend nicht erreichbar", "critical");
    } finally {
      setScanning(false);
    }
  }, [applyNormalizedScan, scoreHistory, addNotification]);

  // ── Fix a finding ──────────────────────────────────────────────────────────
  const handleFix = useCallback(async (finding) => {
    const tier = finding.remediation_tier;

    if (tier === "approval") {
      setFixedIds(prev => new Set([...prev, finding.id]));
      addNotification(`Pending approval: ${finding.id}`, "warning");
      setChangelog(prev => [...prev.slice(-19), `## [${new Date().toISOString()}] PENDING_APPROVAL\nseverity: info\ndomain: ${finding.domain}\ndetail: ${finding.id} marked for approval\naction_taken: queued\n---`]);
      return;
    }

    if (tier === "auto") {
      try {
        const res = await applyRemediation(finding.id, clawsecToken);
        setFixedIds(prev => new Set([...prev, finding.id]));
        addNotification(`Remediation applied: ${finding.id}`, "ok");
        setChangelog(prev => [...prev.slice(-19), `## [${new Date().toISOString()}] AUTO_REMEDIATION\nseverity: info\ndomain: ${finding.domain}\ndetail: ${finding.id} fixed\naction_taken: ${res?.already_done ? "already_done" : "applied"}\n---`]);
      } catch (err) {
        const msg = String(err);
        if (msg.includes("401") || msg.includes("Unauthorized")) {
          addNotification(`Auth required — Token in Config tab eintragen`, "warning");
        } else {
          addNotification(`Fix fehlgeschlagen: ${finding.id}`, "critical");
        }
      }
    }
  }, [clawsecToken, addNotification]);

  const visibleFindings = scanResult.findings.filter(f => !fixedIds.has(f.id) && f.status !== "auto_fixed");
  const score           = visibleFindings.length === 0 && scanResult.findings.length === 0 ? 0 : computeScore(visibleFindings);
  const notifColors     = { critical: "#ff2d2d", warning: "#ff8c00", ok: "#00ff88", info: "#4a7fcc" };

  const TABS = [
    { id: "overview",  label: "OVERVIEW" },
    { id: "findings",  label: `FINDINGS${visibleFindings.length > 0 ? ` [${visibleFindings.length}]` : ""}` },
    { id: "agents",    label: "AGENTS" },
    { id: "changelog", label: "CHANGELOG" },
    { id: "config",    label: "CONFIG" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@300;400;600&family=Barlow+Condensed:wght@300;500;700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #03030d; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #050510; }
        ::-webkit-scrollbar-thumb { background: #1a2a4a; border-radius: 2px; }
        @keyframes pulse  { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        @keyframes blink  { 0%,100%{opacity:1;} 50%{opacity:0;} }
        @keyframes spin   { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        @keyframes slideIn { from{transform:translateX(100%);opacity:0;} to{transform:translateX(0);opacity:1;} }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#03030d", color: "#c0c8d8", fontFamily: "'JetBrains Mono', monospace" }}>

        {/* ── Notification Stack ── */}
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
          {notifications.map(n => (
            <div key={n.id} style={{
              background: "#0a0a18", border: `1px solid ${notifColors[n.type] || "#444"}66`,
              borderLeft: `3px solid ${notifColors[n.type] || "#444"}`,
              borderRadius: "0 6px 6px 0", padding: "8px 14px",
              fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: notifColors[n.type] || "#888",
              boxShadow: "0 4px 20px #00000088", animation: "slideIn 0.3s ease", maxWidth: 320,
            }}>
              <span style={{ color: "#445566", marginRight: 8 }}>{n.at}</span>{n.msg}
            </div>
          ))}
        </div>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(180deg, #050518 0%, #03030d 100%)",
          borderBottom: "1px solid #0f0f2e", padding: "0 24px",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", height: 56, gap: 24 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32,
                background: "linear-gradient(135deg, #0a1628 0%, #1a2a4a 100%)",
                border: "1px solid #2a4a7f", borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 12px #4a7fcc22",
              }}>
                <span style={{ color: "#4a9fff", fontSize: 16, lineHeight: 1 }}>⬡</span>
              </div>
              <div>
                <div style={{ color: "#9aafcc", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 3, lineHeight: 1 }}>CLAWSEC</div>
                <div style={{ color: "#334455", fontFamily: "'Share Tech Mono', monospace", fontSize: 8, letterSpacing: 2 }}>OPERATIONS CENTER v3.0</div>
              </div>
            </div>

            {/* Status pills */}
            <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#0a1020", border: "1px solid #0f2040", borderRadius: 4, padding: "4px 10px" }}>
                <GlowDot color={paused ? "#ff8c00" : "#00ff88"} pulse={!paused} />
                <span style={{ color: paused ? "#aa6600" : "#00aa55", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>
                  SUPERVISOR {paused ? "PAUSED" : "LIVE"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#0a1020", border: "1px solid #0f2040", borderRadius: 4, padding: "4px 10px" }}>
                <GlowDot color={apiConnected ? "#00ff88" : "#ff2d2d"} pulse={apiConnected} />
                <span style={{ color: apiConnected ? "#00aa55" : "#aa2222", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>
                  API {apiConnected ? "LIVE" : "OFFLINE"}
                </span>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            {/* Controls */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setPaused(p => !p)} style={{
                background: "#0a0a18", border: "1px solid #1a2a3a", color: "#667788",
                borderRadius: 4, padding: "6px 12px", cursor: "pointer",
                fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1,
              }}>{paused ? "▶ RESUME" : "⏸ PAUSE"}</button>
              <ScanTriggerButton scanning={scanning} onClick={handleManualScan} />
            </div>
          </div>
        </div>

        {/* API Error Banner */}
        {apiError && (
          <div style={{
            background: "#1a0505", borderBottom: "1px solid #ff2d2d33",
            padding: "8px 24px", fontFamily: "'Share Tech Mono', monospace", fontSize: 10,
            color: "#ff6b6b", display: "flex", alignItems: "center", gap: 10,
          }}>
            <span>⚠</span>
            <span>{apiError}</span>
            <span style={{ color: "#445566", marginLeft: "auto" }}>Dashboard läuft im Offline-Modus</span>
          </div>
        )}

        {/* ── Main Layout ── */}
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px" }}>

          {/* KPI Strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "140px 1fr auto",
            gap: 16, marginBottom: 24, alignItems: "center",
          }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ScoreArc score={score} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {[
                { label: "CRITICAL",   value: visibleFindings.filter(f => f.severity === "critical").length, color: "#ff2d2d" },
                { label: "HIGH",       value: visibleFindings.filter(f => f.severity === "high").length,     color: "#ff8c00" },
                { label: "AUTO-FIXED", value: scanResult.applied_fixes.length + fixedIds.size,              color: "#00ff88" },
                { label: "PENDING",    value: scanResult.pending_approval.length,                            color: "#ffd700" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
                  <div style={{ color, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1, marginBottom: 8 }}>
                RISK HISTORY · {scoreHistory.length} points
              </div>
              <ScoreHistoryChart history={scoreHistory} />
            </div>
          </div>

          {/* Tabs */}
          <TabBar tabs={TABS} active={tab} onChange={setTab} />

          {/* ══ OVERVIEW ══ */}
          {tab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>AGENT STATUS</div>
                <AgentStatusBar heartbeat={heartbeat} apiConnected={apiConnected} />
              </div>

              <div>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>SCAN DOMAINS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {Object.entries(scanResult.domains).map(([name, data]) => (
                    <DomainCard key={name} name={name} data={data} findings={visibleFindings} />
                  ))}
                  <div style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 4 }}>
                    <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>SYSTEM HASH</div>
                    <div style={{ color: "#334455", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>{scanResult.system_hash}</div>
                    {scanResult.scanned_at && (
                      <div style={{ color: "#223344", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                        {new Date(scanResult.scanned_at).toLocaleTimeString("de-DE")}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>LIVE CHANGELOG</div>
                <ChangelogViewer entries={changelog} />
              </div>

              {visibleFindings.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>ACTIVE FINDINGS</div>
                  {visibleFindings.slice(0, 3).map(f => <FindingRow key={f.id} finding={f} onFix={handleFix} fixed={false} />)}
                  {visibleFindings.length > 3 && (
                    <div onClick={() => setTab("findings")} style={{ color: "#4a7fcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 10, cursor: "pointer", padding: "6px 0", letterSpacing: 1 }}>
                      + {visibleFindings.length - 3} more → VIEW ALL FINDINGS
                    </div>
                  )}
                </div>
              )}

              {!scanResult.scanned_at && (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: "#334455" }}>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, marginBottom: 12 }}>Noch kein Scan geladen.</div>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>Klick auf ▶ RUN SCAN um den ersten Scan zu starten.</div>
                </div>
              )}
            </div>
          )}

          {/* ══ FINDINGS ══ */}
          {tab === "findings" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ color: "#667788", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
                  {visibleFindings.length} active · {fixedIds.size + scanResult.applied_fixes.length} resolved
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["critical", "high", "medium", "low"].map(sev => {
                    const count = visibleFindings.filter(f => f.severity === sev).length;
                    return count > 0 && (
                      <span key={sev} style={{
                        background: SEV[sev].bg, border: `1px solid ${SEV[sev].border}44`,
                        color: SEV[sev].text, borderRadius: 4, padding: "2px 8px",
                        fontFamily: "'Share Tech Mono', monospace", fontSize: 9,
                      }}>{sev.toUpperCase()} {count}</span>
                    );
                  })}
                </div>
              </div>
              {visibleFindings.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#00ff88", fontFamily: "'Share Tech Mono', monospace", fontSize: 14, letterSpacing: 2 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                  {scanResult.scanned_at ? "NO ACTIVE FINDINGS" : "SCAN AUSSTEHEND"}
                  <div style={{ color: "#334455", fontSize: 10, marginTop: 8 }}>
                    {scanResult.scanned_at ? `Score: ${Math.round(score)}/100` : "Klick auf ▶ RUN SCAN"}
                  </div>
                </div>
              ) : (
                visibleFindings.map(f => <FindingRow key={f.id} finding={f} onFix={handleFix} fixed={false} />)
              )}
              {/* Resolved findings (this session) */}
              {fixedIds.size > 0 && (
                <div style={{ marginTop: 24 }}>
                  <div style={{ color: "#334455", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>RESOLVED THIS SESSION</div>
                  {scanResult.findings.filter(f => fixedIds.has(f.id)).map(f => (
                    <FindingRow key={f.id} finding={f} onFix={() => {}} fixed={true} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ AGENTS ══ */}
          {tab === "agents" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 12 }}>KAIROS — PRIMARY AGENT</div>
                <AgentStatusBar heartbeat={heartbeat} apiConnected={apiConnected} />
              </div>
              {[
                { name: "clawsec-env",     domain: "credentials", desc: "Scans .env, git history, process env for exposed secrets" },
                { name: "clawsec-perm",    domain: "identity",    desc: "Monitors SOUL.md, CONSTRAINTS.md and file permissions" },
                { name: "clawsec-net",     domain: "network",     desc: "Checks port binding, gateway exposure, CORS policy" },
                { name: "clawsec-session", domain: "sessions",    desc: "Audits session files, memory store permissions and isolation" },
                { name: "clawsec-config",  domain: "config",      desc: "Validates openclaw.json, exec_security, dm_policy, MCP servers" },
              ].map(agent => {
                const domFindings = visibleFindings.filter(f => f.domain === agent.domain);
                const ok = domFindings.length === 0;
                const c = ok ? SEV.ok : SEV[domFindings[0]?.severity || "medium"];
                const domData = scanResult.domains[agent.domain];
                return (
                  <div key={agent.name} style={{ background: "#07070f", border: `1px solid ${c.border}33`, borderRadius: 8, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <GlowDot color={c.glow} pulse={!ok} />
                      <span style={{ color: "#9aafcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1 }}>{agent.name}</span>
                      <span style={{ marginLeft: "auto", color: c.text, fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                        {ok ? "CLEAN" : `${domFindings.length} FINDING${domFindings.length !== 1 ? "S" : ""}`}
                      </span>
                    </div>
                    <div style={{ color: "#556677", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, marginBottom: 10 }}>{agent.desc}</div>
                    <div style={{ display: "flex", gap: 12, color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                      {domData?.duration_ms > 0 && <span>LAST RUN: {domData.duration_ms}ms</span>}
                      <span>DOMAIN: {agent.domain.toUpperCase()}</span>
                    </div>
                    {domFindings.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {domFindings.map(f => (
                          <span key={f.id} style={{ background: SEV[f.severity].bg, border: `1px solid ${SEV[f.severity].border}44`, color: SEV[f.severity].text, borderRadius: 3, padding: "1px 7px", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                            {f.id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ CHANGELOG ══ */}
          {tab === "changelog" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ color: "#667788", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
                  {changelog.length} entries · append-only · live
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <GlowDot color="#4a7fcc" pulse={!paused && apiConnected} />
                  <span style={{ color: "#334466", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                    {apiConnected ? "STREAMING" : "OFFLINE"}
                  </span>
                </div>
              </div>
              <div style={{ background: "#050510", border: "1px solid #0f0f1e", borderRadius: 8, padding: 4 }}>
                <ChangelogViewer entries={changelog} />
              </div>
            </div>
          )}

          {/* ══ CONFIG ══ */}
          {tab === "config" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <ConfigEditor
                title="SOUL.md — Identity Anchor"
                content={configs.soul}
                readOnly={true}
                onSave={() => {}}
              />
              <ConfigEditor
                title="CONSTRAINTS.md — Hard Limits"
                content={configs.constraints}
                readOnly={true}
                onSave={() => {}}
              />
              <ConfigEditor
                title="GATEWAY.md — Routing Rules"
                content={configs.gateway}
                readOnly={false}
                onSave={(v) => {
                  const updated = { ...configs, gateway: v };
                  setConfigs(updated);
                  saveLocalConfig(updated);
                  addNotification("GATEWAY.md lokal gespeichert", "info");
                }}
              />
              <div style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: 16 }}>
                <div style={{ color: "#7c9fcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1, marginBottom: 12 }}>AUTH TOKEN</div>
                <div style={{ color: "#556677", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, marginBottom: 12, lineHeight: 1.6 }}>
                  Für POST /api/apply/ (Auto-Fix) wird der ClawSec-Token benötigt.
                  <br />Token liegt auf dem Server unter: <span style={{ color: "#334455" }}>.clawsec_token</span>
                </div>
                <input
                  type="password"
                  placeholder="Token einfügen..."
                  value={clawsecToken}
                  onChange={(e) => { setClawsecToken(e.target.value); saveToken(e.target.value); }}
                  style={{
                    width: "100%", background: "#050510", border: "1px solid #1a1a2e",
                    borderRadius: 6, color: "#8899aa",
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                    padding: "8px 12px", outline: "none", boxSizing: "border-box",
                  }}
                />
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "TICK INTERVAL",     value: "—" },
                    { label: "HEARTBEAT",          value: "15s" },
                    { label: "SCAN TIMEOUT",       value: "35s" },
                    { label: "TOOL CALL BASELINE", value: "20/5min" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: "8px 0", borderBottom: "1px solid #0a0a18" }}>
                      <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1, marginBottom: 3 }}>{label}</div>
                      <div style={{ color: "#7788aa", fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #07070f", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#223344", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>
            CLAWSEC 2.0 · OPENCLAW SECURITY PLANE · {new Date().toLocaleDateString("de-DE")}
          </div>
          <div style={{ display: "flex", gap: 16, color: "#223344", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
            <span>OWASP LLM TOP 10:2025</span>
            <span>OWASP AGENTIC AI:2026</span>
            <span style={{ color: apiConnected ? "#003322" : "#330000" }}>
              BACKEND: {apiConnected ? "CONNECTED" : "OFFLINE"}
            </span>
          </div>
        </div>

      </div>
    </>
  );
}

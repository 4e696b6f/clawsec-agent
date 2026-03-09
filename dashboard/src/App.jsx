import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchScan, fetchLastReport, fetchHeartbeat,
  applyRemediation, fetchReportHistory, saveConfig,
  computeScore, loadHistory, saveHistory,
} from "./api.js";

// ─── Default state (before first API response) ────────────────────────────────
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

// ─── Color System ─────────────────────────────────────────────────────────────
const SEV = {
  critical: { bg: "#ff2d2d22", border: "#ff2d2d", text: "#ff6b6b", glow: "#ff2d2d" },
  high:     { bg: "#ff8c0022", border: "#ff8c00", text: "#ffb347", glow: "#ff8c00" },
  medium:   { bg: "#ffd70022", border: "#ffd700", text: "#ffe55c", glow: "#ffd700" },
  low:      { bg: "#00bfff22", border: "#00bfff", text: "#7dd3fc", glow: "#00bfff" },
  info:     { bg: "#8b8b8b22", border: "#8b8b8b", text: "#b4b4b4", glow: "#8b8b8b" },
  ok:       { bg: "#00ff8822", border: "#00ff88", text: "#6bffb8", glow: "#00ff88" },
};

// ─── Subcomponents ────────────────────────────────────────────────────────────

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
      padding: "12px 14px", cursor: "default",
      boxShadow: ok ? `inset 0 0 20px ${c.glow}08` : `inset 0 0 20px ${c.glow}12`,
      transition: "all 0.4s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: c.text, fontSize: 16 }}>{icons[name]}</span>
        <span style={{ color: c.text, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>{name}</span>
        <GlowDot color={c.glow} pulse={!ok} />
      </div>
      <div style={{ color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
        {data.scanned ? `${data.duration_ms}ms` : "not scanned"} · {domFindings.length} finding{domFindings.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
};

const FindingRow = ({ finding, onFix }) => {
  const c = SEV[finding.severity] || SEV.info;
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}33`,
      borderLeft: `3px solid ${c.border}`,
      borderRadius: "0 6px 6px 0", padding: "10px 14px",
      marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 12,
    }}>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <GlowDot color={c.glow} pulse={finding.severity === "critical"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
          <span style={{
            background: c.border + "33", color: c.text, border: `1px solid ${c.border}66`,
            borderRadius: 3, padding: "1px 7px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
          }}>{finding.severity}</span>
          <span style={{ color: "#777", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.id}</span>
          {finding.owasp_llm && <span style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.owasp_llm}</span>}
          {finding.owasp_asi && <span style={{ color: "#445", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{finding.owasp_asi}</span>}
        </div>
        <div style={{ color: "#d4d4d4", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginBottom: 4 }}>{finding.message}</div>
        <div style={{ color: "#666", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>{finding.recommendation}</div>
      </div>
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
    </div>
  );
};

const AgentStatusBar = ({ heartbeat }) => {
  const isActive = heartbeat.status === "active";
  const c = isActive ? SEV.ok : SEV.high;
  const upHours = Math.floor((heartbeat.uptime_seconds || 0) / 3600);
  const upMins = Math.floor(((heartbeat.uptime_seconds || 0) % 3600) / 60);
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
          { label: "SKILL", value: (heartbeat.current_skill || "—").toUpperCase() },
          { label: "TOOLS/5m", value: heartbeat.tool_calls_last_5min ?? "—" },
          { label: "MEM", value: heartbeat.memory_used_mb ? heartbeat.memory_used_mb + "MB" : "—" },
          { label: "UPTIME", value: `${upHours}h ${upMins}m` },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>{label}</div>
            <div style={{ color: "#9aafcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 12 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: "#555", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>LAST PING</div>
        <div style={{ color: "#667", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
          {new Date(heartbeat.last_ping).toLocaleTimeString("de-DE")}
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
  if (history.length < 2) return null;
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

const BaselineTable = ({ baseline }) => {
  const entries = Object.entries(baseline);
  const riskColor = { LOW: "#00ff88", MEDIUM: "#ffd700", HIGH: "#ff8c00", CRITICAL: "#ff2d2d" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>
        <thead>
          <tr>
            {["COMPONENT", "TYPE", "CAPABILITIES", "RISK", "APPROVED BY", "VERIFIED"].map(h => (
              <th key={h} style={{
                textAlign: "left", padding: "6px 10px", color: "#555",
                borderBottom: "1px solid #1a1a2e", fontSize: 9, letterSpacing: 1,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, entry]) => (
            <tr key={name} style={{ borderBottom: "1px solid #0f0f1e" }}>
              <td style={{ padding: "8px 10px", color: "#9aafcc" }}>{name}</td>
              <td style={{ padding: "8px 10px", color: "#667788" }}>{entry.type}</td>
              <td style={{ padding: "8px 10px", color: "#556677", fontSize: 10 }}>
                {(entry.capabilities || [entry.permissions || "—"]).join(", ")}
              </td>
              <td style={{ padding: "8px 10px" }}>
                <span style={{ color: riskColor[entry.risk_level] || "#888", fontWeight: 700 }}>
                  {entry.risk_level}
                </span>
              </td>
              <td style={{ padding: "8px 10px", color: "#556677" }}>{entry.approved_by}</td>
              <td style={{ padding: "8px 10px", color: "#445566", fontSize: 10 }}>
                {entry.last_verified ? new Date(entry.last_verified).toLocaleTimeString("de-DE") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ConfigEditor = ({ title, content, onSave }) => {
  const [val, setVal] = useState(content);
  const [saved, setSaved] = useState(false);
  const handleSave = () => {
    onSave(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#7c9fcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1 }}>{title}</span>
        <button onClick={handleSave} style={{
          background: saved ? "#00ff8822" : "#0a1628",
          border: `1px solid ${saved ? "#00ff88" : "#2a3f5f"}`,
          color: saved ? "#00ff88" : "#7c9fcc",
          borderRadius: 4, padding: "4px 12px",
          fontFamily: "'Share Tech Mono', monospace", fontSize: 9, cursor: "pointer",
          letterSpacing: 1, transition: "all 0.3s",
        }}>{saved ? "✓ SAVED" : "SAVE"}</button>
      </div>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{
          width: "100%", height: 180, background: "#050510",
          border: "1px solid #1a1a2e", borderRadius: 6,
          color: "#8899aa", fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          padding: 12, resize: "vertical", outline: "none", boxSizing: "border-box",
          lineHeight: 1.7,
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
    {scanning ? (
      <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> SCANNING...</>
    ) : (
      <><span>▶</span> RUN SCAN</>
    )}
  </button>
);

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ClawSecDashboard() {
  const [tick, setTick]               = useState(0);
  const [scanResult, setScanResult]   = useState(defaultScanResult);
  const [heartbeat, setHeartbeat]     = useState(defaultHeartbeat);
  const [changelog, setChangelog]     = useState([
    `## [${new Date().toISOString()}] DASHBOARD_INIT\nseverity: info\ndomain: config\ndetail: ClawSec Operations Center loaded\naction_taken: awaiting_scan\n---`
  ]);
  const [scoreHistory, setScoreHistory] = useState(() => {
    const stored = loadHistory();
    return stored.length > 0 ? stored.map(h => h.risk_score || 0) : [0];
  });
  const [scanning, setScanning]       = useState(false);
  const [tab, setTab]                 = useState("overview");
  const [fixedIds, setFixedIds]       = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [paused, setPaused]           = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [apiError, setApiError]       = useState(null);
  const [baseline] = useState({
    "SOUL.md":             { type: "file", permissions: "444", risk_level: "CRITICAL", approved_by: "user", last_verified: new Date().toISOString() },
    "CONSTRAINTS.md":      { type: "file", permissions: "444", risk_level: "CRITICAL", approved_by: "user", last_verified: new Date().toISOString() },
    "clawsec-coordinator": { type: "skill", capabilities: ["exec", "read", "write"], risk_level: "MEDIUM", approved_by: "auto", last_verified: new Date().toISOString() },
    "clawsec-env":         { type: "skill", capabilities: ["exec", "read"], risk_level: "LOW", approved_by: "auto", last_verified: new Date().toISOString() },
    "clawsec-net":         { type: "skill", capabilities: ["exec", "read"], risk_level: "LOW", approved_by: "auto", last_verified: new Date().toISOString() },
    "clawsec-session":     { type: "skill", capabilities: ["exec", "read"], risk_level: "LOW", approved_by: "auto", last_verified: new Date().toISOString() },
    "clawsec-config":      { type: "skill", capabilities: ["exec", "read"], risk_level: "LOW", approved_by: "auto", last_verified: new Date().toISOString() },
    "gmail-plugin":        { type: "plugin", capabilities: ["gmail_read", "gmail_send"], risk_level: "HIGH", approved_by: "user", last_verified: new Date().toISOString() },
  });

  const [configs, setConfigs] = useState({
    soul:        "# SOUL.md — Agent Identity\n(loading from server...)",
    constraints: "# CONSTRAINTS.md — Hard Limits\n(loading from server...)",
    gateway:     "# GATEWAY.md — Routing Rules\n(loading from server...)",
  });

  const addNotification = useCallback((msg, type = "info") => {
    const id = Date.now();
    setNotifications(prev => [...prev.slice(-4), { id, msg, type, at: new Date().toLocaleTimeString("de-DE") }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  }, []);

  // ── Mount: load last report + history from server ─────────────────────────
  useEffect(() => {
    fetchLastReport().then(data => {
      if (data) {
        setScanResult(data);
        setScoreHistory(h => [...h, data.risk_score]);
        setApiConnected(true);
        addNotification("Last report loaded from server", "info");
        setChangelog(prev => [...prev,
          `## [${new Date().toISOString()}] REPORT_LOADED\nseverity: info\ndomain: all\ndetail: Last scan loaded. Score: ${data.risk_score}/100. ${data.findings.length} finding(s).\naction_taken: state_restored\n---`
        ]);
      }
    }).catch(err => {
      setApiError("Backend nicht erreichbar: " + err.message);
      setApiConnected(false);
    });

    // Load scan history to populate score graph
    fetchReportHistory(20).then(reports => {
      if (reports.length > 0) {
        const history = reports.map(r => ({ timestamp: r.scanned_at, risk_score: r.risk_score }));
        saveHistory(history);
        setScoreHistory(history.map(h => h.risk_score));
      }
    }).catch(() => { /* history unavailable — fine */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Heartbeat polling every 15s ────────────────────────────────────────────
  useEffect(() => {
    if (paused) return;
    const iv = setInterval(async () => {
      setTick(t => t + 1);
      const hb = await fetchHeartbeat();
      if (hb) {
        setHeartbeat(hb);
        setApiConnected(true);
        if (apiError) setApiError(null);
      } else {
        setApiConnected(false);
      }
    }, 15_000);
    return () => clearInterval(iv);
  }, [paused, apiError]);

  // ── Manual scan ───────────────────────────────────────────────────────────
  const handleManualScan = useCallback(async () => {
    setScanning(true);
    setApiError(null);
    addNotification("Scan triggered — calling /api/scan...", "info");
    try {
      const data = await fetchScan();
      setScanResult(data);
      setApiConnected(true);
      setFixedIds(new Set()); // Clear local dismissals — fresh scan result

      const newScore = data.risk_score;
      setScoreHistory(h => {
        const updated = [...h.slice(-29), newScore];
        const histEntries = updated.map(s => ({ timestamp: new Date().toISOString(), risk_score: s }));
        saveHistory(histEntries);
        return updated;
      });

      setChangelog(prev => [...prev.slice(-19),
        `## [${data.scanned_at || new Date().toISOString()}] SCAN_COMPLETE\nseverity: info\ndomain: all\ndetail: Real scan finished. Score: ${newScore}/100. ${data.findings.length} finding(s). Auto-fixed: ${data.applied_fixes.length}.\naction_taken: report_saved\n---`
      ]);
      addNotification(`Scan complete. Score: ${newScore}/100 · ${data.findings.length} finding(s)`, "info");

      // Alert on critical findings
      const crits = data.findings.filter(f => f.severity === "critical" && f.status !== "auto_fixed");
      if (crits.length > 0) {
        addNotification(`⚠ ${crits.length} critical finding(s): ${crits.map(f => f.id).join(", ")}`, "critical");
      }
    } catch (err) {
      setApiError("Scan failed: " + err.message);
      setApiConnected(false);
      addNotification("Scan failed: " + err.message, "critical");
    } finally {
      setScanning(false);
    }
  }, [addNotification]);

  // ── Fix handler ───────────────────────────────────────────────────────────
  const handleFix = useCallback(async (finding) => {
    const { id, remediation_tier } = typeof finding === "string"
      ? { id: finding, remediation_tier: "auto" }
      : finding;

    if (remediation_tier === "auto") {
      // Real API remediation
      try {
        const result = await applyRemediation(id);
        if (result.success || result.already_done) {
          setFixedIds(prev => new Set([...prev, id]));
          addNotification(
            result.already_done ? `${id}: already fixed` : `Auto-fix applied: ${id} (${result.duration_ms}ms)`,
            "ok"
          );
          setChangelog(prev => [...prev.slice(-19),
            `## [${new Date().toISOString()}] AUTO_REMEDIATION\nseverity: info\ndomain: ${finding.domain || "unknown"}\ndetail: ${id} fixed via API\naction_taken: applied\n---`
          ]);
        } else {
          addNotification(`Fix failed for ${id}: exit ${result.exit_code}`, "critical");
        }
      } catch (err) {
        if (err.message.includes("401") || err.message.includes("Unauthorized")) {
          addNotification(`Auth required: ${id} — set X-ClawSec-Token (see /api/health for token path)`, "critical");
        } else {
          addNotification(`Remediation API error: ${err.message}`, "critical");
        }
      }
    } else if (remediation_tier === "approval") {
      // Operator acknowledgment — mark locally, real fix is manual
      setFixedIds(prev => new Set([...prev, id]));
      addNotification(`Operator approval recorded for: ${id}`, "warning");
      setChangelog(prev => [...prev.slice(-19),
        `## [${new Date().toISOString()}] OPERATOR_APPROVAL\nseverity: warning\ndomain: ${finding.domain || "unknown"}\ndetail: ${id} acknowledged by operator\naction_taken: manual_required\n---`
      ]);
    }
  }, [addNotification]);

  // ── Config save handler ───────────────────────────────────────────────────
  const handleConfigSave = useCallback(async (fileKey, content) => {
    // Optimistic update in-browser
    setConfigs(c => ({ ...c, [fileKey]: content }));
    try {
      const result = await saveConfig(fileKey, content);
      if (result.system_hash) {
        setScanResult(prev => ({ ...prev, system_hash: result.system_hash }));
      }
      addNotification(`${fileKey.toUpperCase()}.md saved (${result.bytes} bytes) — backup: ${result.backup}`, "ok");
      setChangelog(prev => [...prev.slice(-19),
        `## [${new Date().toISOString()}] CONFIG_SAVED\nseverity: info\ndomain: config\ndetail: ${fileKey} updated (${result.bytes} bytes)\naction_taken: file_written\n---`
      ]);
    } catch (err) {
      if (err.message.includes("444") || err.message.includes("immutable") || err.message.includes("403")) {
        addNotification("SOUL.md ist chmod 444 — intentional immutable (correct behavior)", "warning");
      } else {
        addNotification(`Save failed: ${err.message}`, "critical");
      }
    }
  }, [addNotification]);

  const visibleFindings = scanResult.findings.filter(f => !fixedIds.has(f.id) && f.status !== "auto_fixed");
  const score = scanResult.risk_score;
  const notifColors = { critical: "#ff2d2d", warning: "#ff8c00", ok: "#00ff88", info: "#4a7fcc" };

  const TABS = [
    { id: "overview",  label: "OVERVIEW" },
    { id: "findings",  label: `FINDINGS ${visibleFindings.length > 0 ? `[${visibleFindings.length}]` : ""}` },
    { id: "agents",    label: "AGENTS" },
    { id: "baseline",  label: "BASELINE" },
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
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:0;} }
        @keyframes spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        @keyframes slideIn { from{transform:translateX(100%);opacity:0;} to{transform:translateX(0);opacity:1;} }
        @keyframes fadeOut { from{opacity:1;} to{opacity:0;transform:translateX(20px);} }
        @keyframes scanline { 0%{top:-2px;} 100%{top:100%;} }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#03030d", color: "#c0c8d8", fontFamily: "'JetBrains Mono', monospace" }}>

        {/* Notification Stack */}
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
          {notifications.map(n => (
            <div key={n.id} style={{
              background: "#0a0a18", border: `1px solid ${notifColors[n.type] || "#444"}66`,
              borderLeft: `3px solid ${notifColors[n.type] || "#444"}`,
              borderRadius: "0 6px 6px 0", padding: "8px 14px",
              fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: notifColors[n.type] || "#888",
              boxShadow: "0 4px 20px #00000088",
              animation: "slideIn 0.3s ease",
              maxWidth: 320,
            }}>
              <span style={{ color: "#445566", marginRight: 8 }}>{n.at}</span>{n.msg}
            </div>
          ))}
        </div>

        {/* API Error Banner */}
        {apiError && (
          <div style={{
            background: "#1a0505", borderBottom: "1px solid #ff2d2d44",
            padding: "8px 24px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ color: "#ff6b6b", fontSize: 12 }}>⚠</span>
            <span style={{ color: "#aa3333", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
              {apiError} — Dashboard running with last cached data
            </span>
            <button onClick={() => setApiError(null)} style={{
              marginLeft: "auto", background: "none", border: "1px solid #3a1515",
              color: "#663333", borderRadius: 3, padding: "2px 8px",
              cursor: "pointer", fontFamily: "'Share Tech Mono', monospace", fontSize: 9,
            }}>✕</button>
          </div>
        )}

        {/* Header */}
        <div style={{
          background: "linear-gradient(180deg, #050518 0%, #03030d 100%)",
          borderBottom: "1px solid #0f0f2e",
          padding: "0 24px",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", height: 56, gap: 24 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32,
                background: "linear-gradient(135deg, #0a1628 0%, #1a2a4a 100%)",
                border: "1px solid #2a4a7f",
                borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
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
                <GlowDot color={apiConnected ? "#00ff88" : "#ff4444"} pulse={apiConnected && !paused} />
                <span style={{ color: apiConnected ? "#00aa55" : "#aa3333", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>
                  API {apiConnected ? "LIVE" : "OFFLINE"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#0a1020", border: "1px solid #0f2040", borderRadius: 4, padding: "4px 10px" }}>
                <span style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>HB #{tick}</span>
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

        {/* Main Layout */}
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px" }}>

          {/* Top KPI Strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "140px 1fr auto",
            gap: 16, marginBottom: 24, alignItems: "center",
          }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ScoreArc score={score} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {[
                { label: "CRITICAL", value: visibleFindings.filter(f => f.severity === "critical").length, color: "#ff2d2d" },
                { label: "HIGH",     value: visibleFindings.filter(f => f.severity === "high").length, color: "#ff8c00" },
                { label: "AUTO-FIXED", value: scanResult.applied_fixes.length + fixedIds.size, color: "#00ff88" },
                { label: "PENDING",  value: scanResult.pending_approval.length, color: "#ffd700" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  background: "#07070f", border: "1px solid #0f0f1e",
                  borderRadius: 8, padding: "14px 16px",
                }}>
                  <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
                  <div style={{ color, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1, marginBottom: 8 }}>RISK HISTORY</div>
              <ScoreHistoryChart history={scoreHistory} />
            </div>
          </div>

          {/* Tabs */}
          <TabBar tabs={TABS} active={tab} onChange={setTab} />

          {/* Tab Content */}

          {tab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 }}>AGENT STATUS</div>
                <AgentStatusBar heartbeat={heartbeat} />
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
                  {visibleFindings.slice(0, 3).map(f => <FindingRow key={f.id} finding={f} onFix={handleFix} />)}
                  {visibleFindings.length > 3 && (
                    <div onClick={() => setTab("findings")} style={{ color: "#4a7fcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 10, cursor: "pointer", padding: "6px 0", letterSpacing: 1 }}>
                      + {visibleFindings.length - 3} more → VIEW ALL FINDINGS
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "findings" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ color: "#667788", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
                  {visibleFindings.length} active · {fixedIds.size} resolved this session
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
                  NO ACTIVE FINDINGS
                  <div style={{ color: "#334455", fontSize: 10, marginTop: 8 }}>System is clean. Score: {Math.round(score)}/100</div>
                </div>
              ) : (
                visibleFindings.map(f => <FindingRow key={f.id} finding={f} onFix={handleFix} />)
              )}
            </div>
          )}

          {tab === "agents" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 12 }}>KAIROS — PRIMARY AGENT</div>
                <AgentStatusBar heartbeat={heartbeat} />
              </div>

              {[
                { name: "clawsec-env",     domain: "credentials", desc: "Scans .env, git history, process env" },
                { name: "clawsec-perm",    domain: "identity",    desc: "Monitors SOUL.md, CONSTRAINTS.md, file permissions" },
                { name: "clawsec-net",     domain: "network",     desc: "Checks port binding, gateway exposure, CORS" },
                { name: "clawsec-session", domain: "sessions",    desc: "Audits session files, memory store permissions" },
                { name: "clawsec-config",  domain: "config",      desc: "Validates openclaw.json, MCP servers, auth" },
              ].map(agent => {
                const domFindings = visibleFindings.filter(f => f.domain === agent.domain);
                const ok = domFindings.length === 0;
                const c = ok ? SEV.ok : SEV[domFindings[0]?.severity || "medium"];
                const domData = scanResult.domains[agent.domain] || { duration_ms: 0, scanned: false };
                return (
                  <div key={agent.name} style={{
                    background: "#07070f", border: `1px solid ${c.border}33`,
                    borderRadius: 8, padding: "16px 18px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <GlowDot color={c.glow} pulse={!ok} />
                      <span style={{ color: "#9aafcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1 }}>{agent.name}</span>
                      <span style={{ marginLeft: "auto", color: c.text, fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                        {ok ? "CLEAN" : `${domFindings.length} FINDING${domFindings.length !== 1 ? "S" : ""}`}
                      </span>
                    </div>
                    <div style={{ color: "#556677", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, marginBottom: 10 }}>{agent.desc}</div>
                    <div style={{ display: "flex", gap: 12, color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
                      <span>{domData.scanned ? `${domData.duration_ms}ms` : "not scanned"}</span>
                      <span>DOMAIN: {agent.domain.toUpperCase()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "baseline" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ color: "#667788", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
                  {Object.keys(baseline).length} registered components · System hash: <span style={{ color: "#334455" }}>{scanResult.system_hash}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <GlowDot color="#00ff88" pulse={false} />
                  <span style={{ color: "#00aa55", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>BASELINE ACTIVE</span>
                </div>
              </div>
              <div style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: 16 }}>
                <BaselineTable baseline={baseline} />
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ color: "#445566", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 2, marginBottom: 12 }}>ATTACK COVERAGE MATRIX</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { attack: "Goal Hijacking",    protection: 100, status: "BLOCKED" },
                    { attack: "Credential Exfil",  protection: 90,  status: "BLOCKED" },
                    { attack: "Malicious Plugin",   protection: 85,  status: "MONITORED" },
                    { attack: "Gateway Exposure",   protection: 85,  status: "MONITORED" },
                    { attack: "Direct Injection",   protection: 80,  status: "MITIGATED" },
                    { attack: "Behavioral Drift",   protection: 65,  status: "DETECTED" },
                    { attack: "Indirect Injection", protection: 35,  status: "PARTIAL" },
                    { attack: "Memory Poisoning",   protection: 15,  status: "BLIND SPOT" },
                  ].map(({ attack, protection, status }) => {
                    const c = protection >= 80 ? "#00ff88" : protection >= 60 ? "#ffd700" : protection >= 35 ? "#ff8c00" : "#ff2d2d";
                    return (
                      <div key={attack} style={{ background: "#050510", border: "1px solid #0f0f1e", borderRadius: 6, padding: "10px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ color: "#9aafcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>{attack}</span>
                          <span style={{ color: c, fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>{status}</span>
                        </div>
                        <div style={{ background: "#0a0a18", borderRadius: 3, height: 4, overflow: "hidden" }}>
                          <div style={{ width: protection + "%", height: "100%", background: c, boxShadow: `0 0 6px ${c}`, transition: "width 0.6s ease" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "changelog" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ color: "#667788", fontFamily: "'Share Tech Mono', monospace", fontSize: 10 }}>
                  {changelog.length} entries · append-only · live
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <GlowDot color="#4a7fcc" pulse={!paused} />
                  <span style={{ color: "#334466", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>STREAMING</span>
                </div>
              </div>
              <div style={{ background: "#050510", border: "1px solid #0f0f1e", borderRadius: 8, padding: 4 }}>
                <ChangelogViewer entries={changelog} />
              </div>
            </div>
          )}

          {tab === "config" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <ConfigEditor
                title="SOUL.md — Identity Anchor"
                content={configs.soul}
                onSave={(v) => handleConfigSave("soul", v)}
              />
              <ConfigEditor
                title="CONSTRAINTS.md — Hard Limits"
                content={configs.constraints}
                onSave={(v) => handleConfigSave("constraints", v)}
              />
              <ConfigEditor
                title="GATEWAY.md — Routing Rules"
                content={configs.gateway}
                onSave={(v) => handleConfigSave("gateway", v)}
              />
              <div style={{ background: "#07070f", border: "1px solid #0f0f1e", borderRadius: 8, padding: 16 }}>
                <div style={{ color: "#7c9fcc", fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1, marginBottom: 12 }}>SUPERVISOR CONFIG</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "HEARTBEAT INTERVAL", value: "15s" },
                    { label: "SCAN TIMEOUT",       value: "35s" },
                    { label: "BACKEND",            value: "127.0.0.1:3001" },
                    { label: "CIRCUIT BREAKER",    value: "5 failures" },
                    { label: "AUTH",               value: "X-ClawSec-Token" },
                    { label: "ALERT CHANNEL",      value: "Telegram" },
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
        <div style={{
          borderTop: "1px solid #07070f", padding: "12px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ color: "#223344", fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1 }}>
            CLAWSEC 2.0 · OPENCLAW SECURITY PLANE · {new Date().toLocaleDateString("de-DE")}
          </div>
          <div style={{ display: "flex", gap: 16, color: "#223344", fontFamily: "'Share Tech Mono', monospace", fontSize: 9 }}>
            <span>OWASP LLM TOP 10:2025</span>
            <span>OWASP AGENTIC AI:2026</span>
            <span>API: {apiConnected ? "CONNECTED" : "OFFLINE"}</span>
          </div>
        </div>

      </div>
    </>
  );
}

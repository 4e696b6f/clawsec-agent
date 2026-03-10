/**
 * Hierarchical agent view: Kairos (supervisor) above 5 sub-agents.
 * Uses PixelAgentAvatar and connecting lines.
 */

import { PixelAgentAvatar, type AgentId } from "./PixelAgentAvatar";
import type { HeartbeatResponse, DomainStatus, Finding } from "../types";

const SUB_AGENTS: { id: AgentId; domain: string; label: string }[] = [
  { id: "clawsec-env", domain: "credentials", label: "Env" },
  { id: "clawsec-perm", domain: "identity", label: "Perm" },
  { id: "clawsec-net", domain: "network", label: "Net" },
  { id: "clawsec-session", domain: "sessions", label: "Session" },
  { id: "clawsec-config", domain: "config", label: "Config" },
];

interface AgentHierarchyProps {
  heartbeat: HeartbeatResponse;
  domains: Record<string, DomainStatus>;
  findings: Finding[];
  apiConnected: boolean;
  onSubAgentClick?: (domain: string) => void;
}

export function AgentHierarchy({
  heartbeat,
  domains,
  findings,
  apiConnected,
  onSubAgentClick,
}: AgentHierarchyProps) {
  const isKairosActive = heartbeat.status === "active";
  const upHours = Math.floor(heartbeat.uptime_seconds / 3600);
  const upMins = Math.floor((heartbeat.uptime_seconds % 3600) / 60);
  const uptimeStr = heartbeat.uptime_seconds > 0 ? `${upHours}h ${upMins}m` : "—";

  return (
    <div
      style={{
        background: "var(--bg-card, #1a1a24)",
        border: "1px solid var(--border-default, rgba(255,255,255,0.1))",
        borderRadius: "var(--radius-md, 10px)",
        padding: "var(--space-3, 12px) var(--space-4, 16px)",
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.2))",
      }}
    >
      {/* Kairos — supervisor */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: "var(--space-2, 8px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2, 8px)",
          }}
        >
          <PixelAgentAvatar agent="kairos" size={24} active={isKairosActive && apiConnected} />
          <div>
            <div style={{ color: "var(--text-primary, #e8eaed)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600 }}>
              Kairos
            </div>
            <div
              style={{
                color: isKairosActive ? "var(--accent-green, #34c759)" : "var(--accent-orange, #ff9f0a)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              {heartbeat.status} · {uptimeStr}
            </div>
          </div>
        </div>
        <div
          style={{
            color: "var(--text-muted, #5f6368)",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            marginTop: 4,
          }}
        >
          {(heartbeat.current_skill || "—").toUpperCase()} · {heartbeat.tool_calls_last_5min} tools/5m
        </div>
      </div>

      {/* Connector line */}
      <div
        style={{
          width: 1,
          height: 12,
          background: "var(--border-default, rgba(255,255,255,0.1))",
          margin: "0 auto var(--space-2, 8px)",
        }}
      />

      {/* Sub-agents */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-1, 4px)",
          flexWrap: "wrap",
        }}
      >
        {SUB_AGENTS.map(({ id, domain, label }) => {
          const domFindings = findings.filter((f) => f.domain === domain);
          const ok = domFindings.length === 0;
          const domData = domains[domain];
          const statusColor = ok ? "var(--accent-green, #34c759)" : "var(--accent-orange, #ff9f0a)";

          return (
            <button
              key={id}
              type="button"
              onClick={() => onSubAgentClick?.(domain)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "var(--space-2, 8px) var(--space-1, 4px)",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: "var(--radius-sm, 6px)",
                cursor: onSubAgentClick ? "pointer" : "default",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (onSubAgentClick) {
                  e.currentTarget.style.background = "var(--bg-elevated, #22222e)";
                  e.currentTarget.style.borderColor = "var(--border-default, rgba(255,255,255,0.1))";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
              }}
            >
              <PixelAgentAvatar agent={id} size={16} active={ok && (domData?.scanned ?? false)} />
              <span style={{ color: "var(--text-secondary, #9aa0a6)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                {label}
              </span>
              <span style={{ color: statusColor, fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500 }}>
                {ok ? "OK" : domFindings.length}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

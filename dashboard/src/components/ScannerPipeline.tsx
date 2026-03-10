/**
 * Scanner workflow visualization: 5 agents → Report.
 * Shows status per agent (from domains) and scanning state.
 */

import type { DomainStatus } from "../types";

const AGENT_ORDER = ["credentials", "identity", "network", "sessions", "config"] as const;
const AGENT_LABELS: Record<string, string> = {
  credentials: "Env",
  identity: "Perm",
  network: "Net",
  sessions: "Session",
  config: "Config",
};

interface ScannerPipelineProps {
  domains: Record<string, DomainStatus>;
  scanning: boolean;
}

export function ScannerPipeline({ domains, scanning }: ScannerPipelineProps) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 500, marginBottom: "var(--space-2)" }}>
        Scanner pipeline
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          flexWrap: "wrap",
        }}
      >
        {AGENT_ORDER.map((domain, i) => {
          const data = domains[domain];
          const ok = data?.ok ?? true;
          const hasRun = data?.scanned ?? false;
          const statusColor = scanning ? "var(--accent-blue)" : ok ? "var(--accent-green)" : "var(--accent-orange)";
          return (
            <div key={domain} style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  background: scanning ? "var(--bg-elevated)" : "var(--bg-base)",
                  border: `1px solid ${statusColor}44`,
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 10px",
                  minWidth: 56,
                  textAlign: "center",
                  transition: "all 0.2s",
                  animation: scanning ? "pulse 1.5s ease-in-out infinite" : "none",
                }}
              >
                <div style={{ color: statusColor, fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600 }}>
                  {AGENT_LABELS[domain] ?? domain}
                </div>
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                  {scanning ? "…" : hasRun && data?.duration_ms ? `${data.duration_ms}ms` : "—"}
                </div>
              </div>
              {i < AGENT_ORDER.length - 1 && (
                <div
                  style={{
                    width: 12,
                    height: 1,
                    background: "var(--border-default)",
                    margin: "0 2px",
                  }}
                />
              )}
            </div>
          );
        })}
        <div
          style={{
            width: 12,
            height: 1,
            background: "var(--border-default)",
            margin: "0 2px",
          }}
        />
        <div
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-secondary)",
          }}
        >
          Report
        </div>
      </div>
    </div>
  );
}

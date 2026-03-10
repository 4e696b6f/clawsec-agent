/**
 * Pixel-art avatars for ClawSec agents.
 * 16×16 or 24×24 SVG with image-rendering: pixelated for retro look.
 */

export type AgentId =
  | "kairos"
  | "clawsec-env"
  | "clawsec-perm"
  | "clawsec-net"
  | "clawsec-session"
  | "clawsec-config";

interface PixelAgentAvatarProps {
  agent: AgentId;
  size?: 16 | 24;
  active?: boolean;
  className?: string;
}

/** 16×16 pixel grid: each rect is 1×1 in viewBox "0 0 16 16" */
function PixelGrid16({ pixels, colors }: { pixels: [number, number, string][]; colors: Record<string, string> }) {
  return (
    <g>
      {pixels.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill={colors[c] ?? c} />
      ))}
    </g>
  );
}

/** 24×24 pixel grid for Kairos */
function PixelGrid24({ pixels, colors }: { pixels: [number, number, string][]; colors: Record<string, string> }) {
  return (
    <g>
      {pixels.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill={colors[c] ?? c} />
      ))}
    </g>
  );
}

// Kairos: supervisor — 24×24, monitor/eye, blue accent
const KAIROS_PIXELS: [number, number, string][] = [
  [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2],
  [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3],
  [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4], [14, 4], [15, 4], [16, 4], [17, 4],
  [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5], [14, 5], [15, 5], [16, 5], [17, 5],
  [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6], [17, 6], [18, 6],
  [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7], [13, 7], [14, 7], [15, 7], [16, 7], [17, 7], [18, 7],
  [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [15, 8], [16, 8], [17, 8], [18, 8],
  [5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [11, 9], [12, 9], [13, 9], [14, 9], [15, 9], [16, 9], [17, 9], [18, 9],
  [5, 10], [6, 10], [7, 10], [8, 10], [9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 10], [16, 10], [17, 10], [18, 10],
  [5, 11], [6, 11], [7, 11], [8, 11], [9, 11], [10, 11], [11, 11], [12, 11], [13, 11], [14, 11], [15, 11], [16, 11], [17, 11], [18, 11],
  [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12], [11, 12], [12, 12], [13, 12], [14, 12], [15, 12], [16, 12], [17, 12], [18, 12],
  [6, 13], [7, 13], [8, 13], [9, 13], [10, 13], [11, 13], [12, 13], [13, 13], [14, 13], [15, 13], [16, 13], [17, 13],
  [6, 14], [7, 14], [8, 14], [9, 14], [10, 14], [11, 14], [12, 14], [13, 14], [14, 14], [15, 14], [16, 14], [17, 14],
  [7, 15], [8, 15], [9, 15], [10, 15], [11, 15], [12, 15], [13, 15], [14, 15], [15, 15], [16, 15],
  [8, 16], [9, 16], [10, 16], [11, 16], [12, 16], [13, 16], [14, 16], [15, 16],
  [9, 17], [10, 17], [11, 17], [12, 17], [13, 17], [14, 17],
  // Monitor/screen (blue)
  [10, 6], [11, 6], [12, 6], [13, 6],
  [10, 7], [11, 7], [12, 7], [13, 7],
  [10, 8], [11, 8], [12, 8], [13, 8],
  [10, 9], [11, 9], [12, 9], [13, 9],
  [10, 10], [11, 10], [12, 10], [13, 10],
].map(([x, y]) => [x, y, "body"] as [number, number, string]);

const KAIROS_MONITOR: [number, number, string][] = [
  [10, 6], [11, 6], [12, 6], [13, 6],
  [10, 7], [11, 7], [12, 7], [13, 7],
  [10, 8], [11, 8], [12, 8], [13, 8],
  [10, 9], [11, 9], [12, 9], [13, 9],
  [10, 10], [11, 10], [12, 10], [13, 10],
  [10, 11], [11, 11], [12, 11], [13, 11],
].map(([x, y]) => [x, y, "accent"]);

// Simplified: single body + accent regions
const KAIROS_BODY: [number, number, string][] = [
  [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4], [14, 4], [15, 4],
  [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5], [14, 5], [15, 5], [16, 5],
  [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6],
  [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7], [13, 7], [14, 7], [15, 7], [16, 7],
  [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [15, 8], [16, 8],
  [7, 9], [8, 9], [9, 9], [10, 9], [11, 9], [12, 9], [13, 9], [14, 9], [15, 9], [16, 9],
  [7, 10], [8, 10], [9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 10], [16, 10],
  [7, 11], [8, 11], [9, 11], [10, 11], [11, 11], [12, 11], [13, 11], [14, 11], [15, 11], [16, 11],
  [7, 12], [8, 12], [9, 12], [10, 12], [11, 12], [12, 12], [13, 12], [14, 12], [15, 12], [16, 12],
  [8, 13], [9, 13], [10, 13], [11, 13], [12, 13], [13, 13], [14, 13], [15, 13],
  [9, 14], [10, 14], [11, 14], [12, 14], [13, 14], [14, 14],
  [10, 15], [11, 15], [12, 15], [13, 15],
  [11, 16], [12, 16],
].map(([x, y]) => [x, y, "body"]);

const KAIROS_ACCENT: [number, number, string][] = [
  [10, 7], [11, 7], [12, 7], [13, 7],
  [10, 8], [11, 8], [12, 8], [13, 8],
  [10, 9], [11, 9], [12, 9], [13, 9],
  [10, 10], [11, 10], [12, 10], [13, 10],
  [11, 6], [12, 6], // antenna/eye
].map(([x, y]) => [x, y, "accent"]);

// Sub-agents: 16×16 simple robot + domain symbol
// env: key shape
const ENV_PIXELS: [number, number, string][] = [
  [6, 2], [7, 2], [8, 2], [9, 2],
  [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3],
  [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
  [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6],
  [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [6, 8], [7, 8], [8, 8], [9, 8],
  [7, 9], [8, 9],
  [7, 10], [8, 10],
  [6, 11], [7, 11], [8, 11], [9, 11],
  [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12],
  [6, 13], [7, 13], [8, 13], [9, 13],
  // key
  [11, 6], [12, 6], [13, 6],
  [11, 7], [12, 7], [13, 7],
  [12, 8], [12, 9], [12, 10],
].map(([x, y]) => [x, y, "body"]);
const ENV_ACCENT: [number, number, string][] = [
  [11, 6], [12, 6], [13, 6], [12, 7], [12, 8],
].map(([x, y]) => [x, y, "accent"]);

// perm: shield
const PERM_PIXELS: [number, number, string][] = [
  [7, 2], [8, 2],
  [6, 3], [7, 3], [8, 3], [9, 3],
  [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
  [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6],
  [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8],
  [6, 9], [7, 9], [8, 9], [9, 9],
  [7, 10], [8, 10],
  [7, 11], [8, 11],
  [6, 12], [7, 12], [8, 12], [9, 12],
  [5, 13], [6, 13], [7, 13], [8, 13], [9, 13], [10, 13],
  [6, 14], [7, 14], [8, 14], [9, 14],
  [7, 15], [8, 15],
].map(([x, y]) => [x, y, "body"]);
const PERM_ACCENT: [number, number, string][] = [
  [7, 6], [8, 6], [7, 7], [8, 7], [7, 8], [8, 8],
].map(([x, y]) => [x, y, "accent"]);

// net: antenna
const NET_PIXELS: [number, number, string][] = [
  [7, 2], [8, 2], [9, 2],
  [7, 3], [8, 3], [9, 3],
  [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
  [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6],
  [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8],
  [6, 9], [7, 9], [8, 9], [9, 9],
  [7, 10], [8, 10],
  [7, 11], [8, 11],
  [6, 12], [7, 12], [8, 12], [9, 12],
  [5, 13], [6, 13], [7, 13], [8, 13], [9, 13], [10, 13],
  [6, 14], [7, 14], [8, 14], [9, 14],
  [7, 15], [8, 15],
].map(([x, y]) => [x, y, "body"]);
const NET_ACCENT: [number, number, string][] = [
  [7, 1], [8, 1], [9, 1], [8, 0],
].map(([x, y]) => [x, y, "accent"]);

// session: clock
const SESSION_PIXELS: [number, number, string][] = [
  [6, 2], [7, 2], [8, 2], [9, 2],
  [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3],
  [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
  [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6],
  [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [6, 8], [7, 8], [8, 8], [9, 8],
  [7, 9], [8, 9],
  [7, 10], [8, 10],
  [6, 11], [7, 11], [8, 11], [9, 11],
  [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12],
  [6, 13], [7, 13], [8, 13], [9, 13],
  [7, 14], [8, 14],
].map(([x, y]) => [x, y, "body"]);
const SESSION_ACCENT: [number, number, string][] = [
  [8, 5], [8, 6], [8, 7], [8, 8], [8, 9],
  [7, 8], [8, 8], [9, 8], [8, 9],
].map(([x, y]) => [x, y, "accent"]);

// config: gear
const CONFIG_PIXELS: [number, number, string][] = [
  [6, 2], [7, 2], [8, 2], [9, 2],
  [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3],
  [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
  [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6],
  [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [6, 8], [7, 8], [8, 8], [9, 8],
  [7, 9], [8, 9],
  [7, 10], [8, 10],
  [6, 11], [7, 11], [8, 11], [9, 11],
  [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12],
  [6, 13], [7, 13], [8, 13], [9, 13],
  [7, 14], [8, 14],
].map(([x, y]) => [x, y, "body"]);
const CONFIG_ACCENT: [number, number, string][] = [
  [7, 4], [8, 4], [9, 4],
  [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  [7, 6], [8, 6], [9, 6],
  [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
  [7, 8], [8, 8], [9, 8],
  [6, 9], [7, 9], [8, 9], [9, 9], [10, 9],
  [7, 10], [8, 10], [9, 10],
].map(([x, y]) => [x, y, "accent"]);

const AGENT_PALETTES: Record<AgentId, { body: string; accent: string; glow: string }> = {
  kairos: { body: "#6b7b8c", accent: "#4a9fff", glow: "#4a9fff" },
  "clawsec-env": { body: "#7a8a6b", accent: "#a8d08d", glow: "#81c995" },
  "clawsec-perm": { body: "#8a7a6b", accent: "#d4a574", glow: "#fbbc04" },
  "clawsec-net": { body: "#6b7a8a", accent: "#8ab4f8", glow: "#4a9fff" },
  "clawsec-session": { body: "#7a6b8a", accent: "#c9a8e8", glow: "#c58af9" },
  "clawsec-config": { body: "#8a7a7a", accent: "#e8b4b4", glow: "#f28b82" },
};

export function PixelAgentAvatar({ agent, size = 16, active = false, className }: PixelAgentAvatarProps) {
  const palette = AGENT_PALETTES[agent];
  const colors = {
    body: palette.body,
    accent: palette.accent,
  };

  const pixelSize = size === 24 ? 24 : 16;
  const isKairos = agent === "kairos";

  if (isKairos) {
    const allPixels = [...KAIROS_BODY, ...KAIROS_ACCENT];
    return (
      <svg
        viewBox="0 0 24 24"
        width={pixelSize}
        height={pixelSize}
        className={className}
        style={{
          imageRendering: "pixelated",
          filter: active ? `drop-shadow(0 0 4px ${palette.glow})` : undefined,
        }}
      >
        <PixelGrid24 pixels={allPixels} colors={colors} />
      </svg>
    );
  }

  const configs: Record<Exclude<AgentId, "kairos">, { body: [number, number, string][]; accent: [number, number, string][] }> = {
    "clawsec-env": { body: ENV_PIXELS, accent: ENV_ACCENT },
    "clawsec-perm": { body: PERM_PIXELS, accent: PERM_ACCENT },
    "clawsec-net": { body: NET_PIXELS, accent: NET_ACCENT },
    "clawsec-session": { body: SESSION_PIXELS, accent: SESSION_ACCENT },
    "clawsec-config": { body: CONFIG_PIXELS, accent: CONFIG_ACCENT },
  };

  const cfg = configs[agent];
  const allPixels = [...cfg.body, ...cfg.accent];

  return (
    <svg
      viewBox="0 0 16 16"
      width={pixelSize}
      height={pixelSize}
      className={className}
      style={{
        imageRendering: "pixelated",
        filter: active ? `drop-shadow(0 0 3px ${palette.glow})` : undefined,
      }}
    >
      <PixelGrid16 pixels={allPixels} colors={colors} />
    </svg>
  );
}

// ClawSec Dashboard — structured logger with localStorage ring buffer.
//
// Usage:
//   import { logger } from "./logger";
//   logger.info("Scan started");
//   logger.error("Backend unreachable", { url: "/api/scan" });
//   logger.getLogs()  // last 100 entries for debugging
//
// SECURITY: Never pass token values or credentials to logger calls.
// Only pass check IDs, URLs, error messages, and status codes.

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: unknown;
}

const STORAGE_KEY = "clawsec_logs";
const MAX_ENTRIES = 100;

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
};

// In dev (Vite/Vitest): emit DEBUG+. In production build: WARN+.
const MIN_LEVEL: LogLevel =
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV ? "DEBUG" : "WARN";

function log(level: LogLevel, msg: string, data?: unknown): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, data };

  // Console output
  const consoleFn =
    level === "ERROR" ? console.error :
    level === "WARN"  ? console.warn  :
    console.log;
  consoleFn(`[ClawSec ${level}] ${msg}`, data !== undefined ? data : "");

  // Persist to localStorage ring buffer (best-effort; silent on failure)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const entries: LogEntry[] = raw ? (JSON.parse(raw) as LogEntry[]) : [];
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage quota exceeded or unavailable — continue silently
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log("DEBUG", msg, data),
  info:  (msg: string, data?: unknown) => log("INFO",  msg, data),
  warn:  (msg: string, data?: unknown) => log("WARN",  msg, data),
  error: (msg: string, data?: unknown) => log("ERROR", msg, data),

  /** Return all persisted log entries for post-hoc debugging. */
  getLogs: (): LogEntry[] => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LogEntry[];
    } catch {
      return [];
    }
  },

  /** Clear persisted log entries. */
  clearLogs: (): void => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  },
};

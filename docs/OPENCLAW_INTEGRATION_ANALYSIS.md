# ClawSec ↔ OpenClaw Integration — Analyse & Anpassungsempfehlungen

Basierend auf den OpenClaw-Dokumenten ([Pi](https://docs.openclaw.ai/pi), [Session](https://docs.openclaw.ai/concepts/session), [Messages](https://docs.openclaw.ai/concepts/messages), [Streaming](https://docs.openclaw.ai/concepts/streaming)) und der aktuellen ClawSec-Codestruktur.

---

## 1. Aktuelle Architektur (Kurzüberblick)

| Komponente | ClawSec-Implementierung | OpenClaw-Erwartung |
|------------|--------------------------|--------------------|
| **Plugin** | `openclaw.plugin.json` mit `before_tool_call`, `session_start` | Hooks geladen; optional Gateway-Proxy unter `/clawsec` |
| **Sub-Agents** | HTTP `GET /api/scan` zu `server.py` → Shell-Skripte | Agent ruft API via `exec`/`curl`; Skill-getrieben |
| **Session-Pfade** | `~/.openclaw/agents` + `~/.openclaw/sessions` | Kanonisch: `~/.openclaw/agents/<agentId>/sessions/` |
| **Scan-Logik** | `runSecurityScan` **entfernt** | Agent triggert via `GET http://127.0.0.1:3001/api/scan` |
| **Heartbeat** | Skill-Metadaten `heartbeat: true` | OpenClaw Heartbeat triggert Skills, nicht Plugin-Code |

---

## 2. Session-Pfade (OpenClaw vs. ClawSec)

### OpenClaw (Dokumentation)

- **Store:** `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- **Transkripte:** `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`
- **Legacy:** OpenClaw liest keine Pi/Tau-Legacy-Ordner mehr; `sessions/` als Top-Level ist nicht dokumentiert.

### ClawSec (aktuell)

- `scan-session.sh` und `sessions_exposed.sh` prüfen **beide**:
  - `$TARGET_DIR/agents` (rekursiv `*.jsonl`)
  - `$TARGET_DIR/sessions` (rekursiv `*.jsonl`)

**Empfehlung:** Beide Pfade weiter prüfen (defensiv), aber die **kanonische Struktur** dokumentieren:

- Primär: `agents/<agentId>/sessions/*.jsonl`
- Fallback: `sessions/*.jsonl` (falls Legacy/Migration)

Optional: `$OPENCLAW_STATE_DIR` aus der Umgebung berücksichtigen, falls gesetzt.

---

## 3. Sub-Agent-Integration (HTTP-only, umgesetzt)

### Aktueller Flow (ClawSec)

```
Agent (Skill-Trigger) 
  → exec: curl -s http://127.0.0.1:3001/api/scan
  → server.py führt scripts/scan/scan-*.sh aus
  → JSON-Ergebnis zurück
```

**Umsetzung:** `runSecurityScan` wurde entfernt. Der Skill instruiert den Agent, `GET http://127.0.0.1:3001/api/scan` aufzurufen. server.py muss laufen.

### Gateway-Proxy (optional)

Plugin registriert `registerHttpRoute` für `/clawsec/*` → Proxy zu `http://127.0.0.1:3001/api/*`. Dashboard kann `VITE_CLAWSEC_API_URL` auf die Gateway-URL setzen für Single-Entry-Point.

---

## 4. Plugin-Hooks

### Registrierte Hooks

- `before_tool_call` — blockiert Schreibzugriffe auf SOUL.md/CONSTRAINTS.md und direkte Remediation-Ausführung
- `session_start` — lädt letzten Report, loggt bei hohem Risk-Score

### Tool-Namen (Pi vs. Policy) — umgesetzt

OpenClaw/Pi nutzt `edit`, `write`, `exec`, `process`. ClawSec `policy.ts` wurde ergänzt:

```ts
export const MUTATING_TOOL_NAMES = [
  "write_file", "edit_file", "str_replace", "create_file",
  "edit", "write", "process",  // Pi-SDK-Namen
  "bash", "exec",
];
```

Parameter-Namen: `path` und `file` werden in `before_tool_call` geprüft.

---

## 5. Session-Start & Kontext

### Aktuell

```ts
api.on("session_start", () => {
  const lastReport = loadLastReport();
  if (lastReport && lastReport.risk_score > 50) {
    console.warn(`[CLAWSEC] High risk score (${lastReport.risk_score}) — agent should be aware`);
  }
});
```

- Kein `event`-Parameter — nur Logging.
- Kein Injizieren von Kontext in die Session (z.B. „High risk — consider security scan“).

### OpenClaw Hooks (Dokumentation)

- `session:start` ist als „Future Event“ gelistet.
- Plugin-Hooks erhalten ggf. anderes API-Format als Standalone-Hooks.

**Empfehlung:** Wenn `session_start` Kontext liefert (z.B. `sessionKey`, `workspaceDir`), diesen nutzen. Optional: über `api.runtime` oder ein Agent-Tool einen „ClawSec-Status“ in den System-Prompt injizieren, wenn `risk_score > 50`.

---

## 6. Gateway & Session-Ownership

Laut OpenClaw-Docs:

- **Gateway ist Source of Truth** für Session-State.
- UIs (Dashboard, WebChat) sollen Sessions und Token-Counts vom Gateway abfragen, nicht lokal parsen.

**ClawSec-Dashboard:** Spricht mit `server.py`, nicht mit dem OpenClaw-Gateway.

**Empfehlung:** Langfristig prüfen, ob das Dashboard Session-Listen/Token-Counts vom Gateway beziehen soll (z.B. `openclaw gateway call sessions.list`). Kurzfristig: Status quo beibehalten, aber in der Doku vermerken.

---

## 7. Streaming & Nachrichten

Für ClawSec weniger relevant (kein Echtzeit-Streaming von Scan-Ergebnissen), aber:

- Block-Streaming: `blockStreamingDefault`, `blockStreamingChunk`
- Preview-Streaming: pro Kanal konfigurierbar

Keine Änderungen nötig, solange ClawSec nur Reports und HTTP-Responses nutzt.

---

## 8. Konkrete Anpassungen (Priorisiert) — umgesetzt

### Erledigt

1. **`runSecurityScan` entfernt** — Agent triggert Scan via `GET /api/scan` (Skill-Anweisung).
2. **Tool-Namen in `policy.ts` ergänzt** — `edit`, `write`, `process` hinzugefügt.
3. **Session-Pfade dokumentiert** — Kommentare in `scan-session.sh` und `sessions_exposed.sh`.
4. **Skill-Anweisung** — HTTP-only: `curl -s http://127.0.0.1:3001/api/scan`.
5. **Gateway-Proxy** — Optional unter `/clawsec` registriert, wenn `registerHttpRoute` verfügbar.

### Offen (niedrige Priorität)

6. **`session_start` erweitern** — Wenn Event-Kontext verfügbar: High-Risk-Status injizieren.
7. **Dashboard ↔ Gateway** — Optionale Integration für Session-Listen/Token-Counts.

---

## 9. Zusammenfassung

| Bereich | Status | Aktion |
|---------|--------|--------|
| Session-Pfade | OK | Dokumentation in Scripts ergänzt |
| Sub-Agents | HTTP-only | Agent ruft `GET /api/scan` via Skill |
| Tool-Namen | OK | `edit`, `write`, `process` in Policy |
| Plugin-Hooks | OK | `before_tool_call`, `session_start`; optional Gateway-Proxy |
| Heartbeat | Skill-Metadaten | Skill wird getriggert |
| Dashboard | Eigenständig | Approval-Tier führt Apply aus; optional Gateway-Proxy |

**Umsetzung abgeschlossen:** `runSecurityScan` entfernt. Agent triggert Scan via HTTP (Skill). Dashboard Apply für approval-Tier ausgeführt.

# CLAUDE.md — ClawSec 2.0

Verbindliche Arbeitsanweisungen für Claude Code in diesem Projekt.
Diese Datei hat höchste Priorität und überschreibt alle Default-Verhaltensweisen.

---

## 1. Projektübersicht

ClawSec 2.0 ist ein **autonomes Multi-Agenten-Sicherheitsscanner-System** für OpenClaw (Claude-basierte Agent-Runtime).
Es scannt die Umgebung, mapped Findings auf OWASP-Frameworks (LLM Top 10 v2.0 + ASI 2025), wendet sichere Remediations automatisch an und alertet via Telegram.

**Technologie-Stack:**
- Backend: Python 3 (`scripts/server.py`) — `127.0.0.1:3001`
- Frontend: React + Vite (`src/`) — Port 8081
- Plugin: TypeScript/CommonJS (`src/coordinator.ts`) — OpenClaw Extension
- Unified Scanner: Bash (`scripts/scan-environment.sh`) — 5 Domains, JSON-Output
- Sub-Agent-Scanner: 5 Bash-Scripts (`scripts/scan/scan-{env,perm,net,session,config}.sh`)
- Remediations: Bash + inline (`scripts/remediation/`)
- Skills: SKILL.md-Dateien (`skills/clawsec-*/`) für Kairos/OpenClaw

---

## 2. Agenten-Struktur

### 2.1 Architektur-Invarianten

Das System besteht aus **einem Koordinator + 5 isolierten Sub-Agenten**. Diese Trennung ist architektonisch fundamental und darf nicht aufgeweicht werden.

```
Kairos Coordinator (clawsec-coordinator)
    ├── clawsec-env      → Credentials, Secrets, .env-Dateien
    ├── clawsec-perm     → Filesystem-Permissions, SOUL.md, Workspace-Dateien
    ├── clawsec-net      → Port-Binding, Gateway-Exposition, CORS
    ├── clawsec-session  → Session-Logs, Memory-Stores, Conversation History
    └── clawsec-config   → openclaw.json, Gateway-Auth, MCP-Server-Konfiguration
```

### 2.2 Koordinator-Regeln

- Der Koordinator **delegiert, aggregiert und entscheidet** — er scannt nicht selbst
- Sub-Agenten werden **parallel** dispatched (`Promise.allSettled`) — nie sequenziell
- Timeout pro Agent: **30 Sekunden** — danach `agent_timeout`-Finding, Scan läuft weiter
- Deduplizierung: gleiches Finding-ID → höchste Severity gewinnt
- Der Koordinator darf **keine Credentials lesen oder loggen** — nur Presence/Absence

### 2.3 Sub-Agenten-Regeln

Jeder Sub-Agent:
- Arbeitet in einem **strikt isolierten Scope** — er scannt nur seinen eigenen Bereich
- Gibt **nur JSON stdout** aus — keine Textausgabe, kein stderr außer Fehler
- Ist **read-only** per Design — kein Schreiben, kein Netzwerk, kein eval
- Gibt `SubAgentResult`-JSON zurück mit: `agent`, `scope`, `findings[]`, `scan_duration_ms`, `agent_version`

### 2.4 Scope-Boundaries

Scope-Überlappungen sind **verboten**:
- Credentials → `clawsec-env`
- File permissions → `clawsec-perm`
- Network/ports → `clawsec-net`
- Session/memory data → `clawsec-session`
- Config files → `clawsec-config`

---

## 3. Sicherheitsarchitektur

### 3.1 Remediation Tier Model

**Tier 1 — Auto-apply** (sofort, kein User-Input):
- `env_gitignore`, `precommit_hook`, `breach_notification_procedure`, `runtime_package_install`, `soul_writable`

**Tier 2 — Approval required:**
- `server_exposed`, `sessions_exposed`, `agent_communication_isolation`

**Tier 3 — Report only, never touch:**
- `gateway_exposed` und alle nicht in Tier 1/2 gelisteten Findings

**Claude darf diese Tier-Zuordnungen NIEMALS eigenständig ändern.**

### 3.2 Immutable Files

`SOUL.md` und `CONSTRAINTS.md` — `chmod 444` nach Deploy.
Claude darf diese Dateien **niemals schreiben oder editieren**.

### 3.3 OWASP-Mapping-Pflicht

Jedes neue Finding **muss** mit OWASP LLM Top 10 v2.0 und/oder ASI 2025 gemapped werden.

### 3.4 Risk Score Formel (kanonisch — nicht abweichen)

```
score = min(30*critical + 15*high + 5*medium, 100)
```
Thresholds: 0–20 Grün, 21–50 Gelb, 51–100 Rot.

### 3.5 Scanner-Sicherheitseigenschaften (müssen erhalten bleiben)

- Backend bindet auf `127.0.0.1:3001`
- CORS: nur RFC-1918-IPs + localhost
- `checkId`-Validierung: `^[a-z_]{1,64}$` + explizite Allowlist
- `subprocess` mit `shell=False`
- Script-Timeout: 30 Sekunden
- `reports/` gitignored, `mode 700`

---

## 4. Zero Trust

### 4.1 Implementierte Kontrollen

- Server hört ausschließlich auf Loopback — `OPENCLAW_HOST=0.0.0.0` ist expliziter Opt-in
- CORS verwirft alle nicht-RFC-1918-Origins
- Nur Scripts aus `scripts/`-Verzeichnis via Allowlist ausführbar
- `shell=False` bei allen subprocess-Aufrufen
- Sub-Agenten kommunizieren nur über Koordinator
- Scanner: read-only, kein `curl`, `wget`, `eval`, `exec`, `rm`

### 4.2 Zero-Trust-Tests für neue Features

1. Würde das Feature auch funktionieren wenn ein anderer Agent kompromittiert ist?
2. Ist der minimale Scope klar definiert und durchgesetzt?
3. Sind alle Inputs validiert (Allowlist, Regex)?
4. Werden keine Credentials in Logs oder Prozessargumenten exponiert?

---

## 5. Authentifizierung und Autorisierung

- Loopback-only: Network-Auth durch Bind-Adresse ersetzt
- LAN-Zugriff: API-Key-Header `X-ClawSec-Key` erforderlich (Key in `~/.openclaw/.env`)
- Telegram-Credentials: nur aus Umgebungsvariablen (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- Approval-Flow: Tier-2-Bestätigung per Telegram, "YES"/"JA" case-insensitiv, 10-Minuten-Timeout

---

## 6. Secure Coding Standards

### 6.1 Input-Validierung

```python
# checkId immer zweistufig validieren:
if not re.match(r"^[a-z_]{1,64}$", check_id):
    return error_response(400, "Invalid checkId")
if check_id not in ALLOWLIST:
    return error_response(400, "checkId not in allowlist")
```

### 6.2 Shell-Injection-Prävention

```python
# Immer shell=False:
subprocess.run(["bash", script_path], shell=False, ...)

# TypeScript: execFile statt exec:
execFileAsync("bash", [scriptPath], { ... })
```

### 6.3 CommonJS-Pflicht für coordinator.ts

OpenClaw's Extension-Loader verwendet `require()` — kein ESM.
- `import` → `const x = require("x") as typeof import("x")`
- `export default function` → am Dateiende: `module.exports = register;`
- `tsconfig.json`: `"module": "commonjs"` (liegt im Repo-Root)

### 6.4 Scanner-JSON-Kontrakt

Alle 5 Bash-Sub-Scanner geben exakt dieses Format aus:
```json
{"agent": "clawsec-X", "scope": "...", "findings": [], "scan_duration_ms": 0, "agent_version": "2.0.0"}
```

### 6.5 Remediation-Script-Exit-Codes (kanonisch)

- `0` = Fix angewendet
- `1` = Bereits erledigt (idempotent)
- `2+` = Fehler

---

## 7. Installation (kritische Regeln)

### 7.1 Kopieren statt Symlinks

**OpenClaw's realpath()-Problem:** Der Skill-Loader prüft jeden Pfad mit `realpath()` und überspringt alles, was außerhalb des konfigurierten Roots auflöst. Symlinks nach `/tmp/` oder anderen Locations werden still ignoriert.

**Lösung:** Immer `cp`, niemals `ln -s` für Skills und Extensions.

### 7.2 Skills-Verzeichnisstruktur

Kanonische Struktur im Repo:
```
skills/
  clawsec-coordinator/SKILL.md   ← direktes Verzeichnis
  clawsec-env/SKILL.md           ← normalisiert (nicht agents/env-agent/)
  clawsec-perm/SKILL.md
  clawsec-net/SKILL.md
  clawsec-session/SKILL.md
  clawsec-config/SKILL.md
  agents/                        ← legacy/backup (install.sh kennt beide Pfade)
```

### 7.3 Idempotenz-Anforderung

`bash install.sh` zweimal ausführen darf nicht brechen:
- Existierendes Verzeichnis → Skip mit Hinweis
- Existierende Symlinks → Entfernen und durch echte Dateien ersetzen
- `chmod 444` auf bereits 444 → Skip

---

## 8. Usability-Anforderungen

- Fehlermeldungen: handlungsorientiert (was der Nutzer tun soll, nicht nur was schiefging)
- API-Fehler: `{"error": "...", "hint": "..."}` — kein Stack-Trace nach außen
- Scan-Feedback: Live-Status per Agent-Name während des Scans
- Telegram-Alerts: kanonisches Format (aus SKILL.md) nicht vereinfachen
- Code/Logs/Commits: Englisch. Claude-Antworten: Deutsch.

---

## 9. Arbeitsregeln für Claude

- Vor Änderungen an Dateien: erst lesen
- Tier-Zuordnungen nicht eigenständig ändern
- Neue Findings brauchen OWASP-Mapping
- `SOUL.md` + `CONSTRAINTS.md` nie anfassen
- Nach Änderungen: `CHANGELOG.md` aktualisieren

### Verbotene Aktionen (ohne explizite Nutzer-Freigabe)

- `OPENCLAW_HOST` auf `0.0.0.0` setzen
- CORS-Allowlist auf öffentliche IPs erweitern
- `shell=True` bei subprocess
- `reports/` aus `.gitignore` entfernen
- Credentials in Code schreiben
- Service-Neustarts triggern

---

## 10. Offene Punkte (Not in Scope für aktuellen Refactor)

Diese Themen sind bewusst zurückgestellt. Sie werden in separaten Iterationen adressiert.
**Beim Arbeiten an diesen Themen: CHANGELOG.md aktualisieren.**

### 10.1 ACP-Integration (Sub-Agent-Protokoll)

**Status:** Zurückgestellt
**Beschreibung:** Die 5 Sub-Agenten laufen derzeit als Bash-Scripts, die via HTTP-Endpunkte aufgerufen werden. Das ist eine pragmatische Lösung, aber nicht die finale Architektur.
**Ziel:** Sub-Agenten als echte ACP-Sessions (Agent Communication Protocol) — jeder Agent läuft als eigener LLM-Kontext, kommuniziert über strukturierte Message-Passing, nicht über Bash-JSON-stdout.
**Abhängigkeiten:** Stabile OpenClaw ACP-Spezifikation, Coordinator-Umbau.
**Sicherheitshinweis:** Beim Umbau muss die Scope-Isolation (Sektion 2.4) vollständig erhalten bleiben. Agent-zu-Agent-Kommunikation darf nur über den Koordinator laufen.

### 10.2 Telegram-Alerts (Konfiguration)

**Status:** Zurückgestellt
**Beschreibung:** Der Alert-Code ist implementiert (Coordinator + SKILL.md), aber `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` sind noch nicht konfiguriert.
**Nächster Schritt:**
```bash
# In ~/.openclaw/.env (gitignored):
TELEGRAM_BOT_TOKEN=<bot-token-von-BotFather>
TELEGRAM_CHAT_ID=<chat-id>
```
**Sicherheitshinweis:** Tokens nie in `openclaw.json` oder versionierten Dateien.

### 10.3 Heartbeat-Integration (Auto-Scan)

**Status:** Zurückgestellt
**Beschreibung:** SKILL.md definiert `heartbeat: true` mit `heartbeat_interval: 3600`. Die eigentliche Hook-Integration in OpenClaw's Heartbeat-System fehlt noch.
**Ziel:** Stündlicher Delta-Scan, der nur bei neuen Critical/High-Findings alertet.
**Abhängigkeiten:** OpenClaw Heartbeat-Hook-API, stabiler Core nach diesem Refactor.
**Implementierung:** `coordinator.ts` hat `isHeartbeat`-Flag bereits. Es muss nur aus dem Heartbeat-Event befüllt werden.

### 10.4 Dashboard-Design (Vollständige Implementierung)

**Status:** Build-System bereit, Design ausstehend
**Beschreibung:** `src/clawsec-ops-center.jsx` existiert als React-Komponente. Vite-Build-System ist konfiguriert (`package.json`, `vite.config.js`, `index.html`, `main.jsx`). Das Dashboard kann gebaut werden.
**Ausstehend:** Review der JSX-Komponente auf vollständige API-Integration, Responsive-Design, Dark Mode.
**Build-Befehl:**
```bash
npm install --prefix src/ && npm run build --prefix src/
npx serve -s src/dist -l 8081
```

### 10.5 scan-environment.sh jq-Abhängigkeit

**Status:** Adressiert (python3-Fallback), aber ungetestet auf Systemen ohne jq
**Beschreibung:** `scripts/scan-environment.sh` nutzt python3 statt jq für JSON-Konstruktion — das sollte auf allen OpenClaw-kompatiblen Systemen funktionieren.
**Test:** Auf einem System ohne jq verifizieren: `bash scripts/scan-environment.sh ~/.openclaw | python3 -m json.tool`

---

## 11. Datei-Referenzen (kritische Pfade)

| Datei | Zweck |
|---|---|
| `src/coordinator.ts` | OpenClaw Plugin — CommonJS, module.exports |
| `scripts/server.py` | HTTP-Backend `127.0.0.1:3001` |
| `scripts/scan-environment.sh` | Unified 5-Domain-Scanner |
| `src/clawsec-ops-center.jsx` | React Dashboard-Komponente |
| `src/main.jsx` | Vite-Einstiegspunkt |
| `src/package.json` | npm Build-Config |
| `src/vite.config.js` | Vite-Konfiguration |
| `src/index.html` | HTML-Template |
| `tsconfig.json` | TypeScript-Config (CommonJS, wird ins Extension-Dir kopiert) |
| `scripts/scan/scan-{env,perm,net,session,config}.sh` | 5 Sub-Agent-Scanner |
| `scripts/remediation/*.sh` | Remediation-Scripts (Tier-1-Allowlist) |
| `skills/clawsec-coordinator/SKILL.md` | Kairos-Koordinator-Skill |
| `skills/clawsec-{env,perm,net,session,config}/SKILL.md` | Sub-Agenten-Skills (normalisiert) |
| `skills/agents/` | Legacy-Struktur (Backup, install.sh kennt beide Pfade) |
| `docker/seccomp-agent.json` | Seccomp-Profil |
| `docker/docker-compose.security.yml` | Docker-Sicherheitskonfiguration |
| `install.sh` | Deployment-Script (cp, kein ln -s) |
| `reports/` | Scan-Reports — gitignored, `chmod 700` |
| `CHANGELOG.md` | Änderungsprotokoll — nach jeder Änderung aktualisieren |

---

## 12. Quick Reference

**Deployment:**
```bash
bash install.sh
python3 scripts/server.py &
curl http://127.0.0.1:3001/api/health
# Erwartet: {"status": "ok", "version": "2.0.0"}
```

**Test-Checkliste (vollständig in INSTALL.md):**
```bash
curl -s http://127.0.0.1:3001/api/scan | python3 -m json.tool
bash scripts/scan-environment.sh ~/.openclaw | python3 -m json.tool
grep -i "clawsec" ~/.openclaw/logs/openclaw-$(date +%Y-%m-%d).log
stat -c '%a' ~/.openclaw/workspace/SOUL.md   # Erwartet: 444
```

**Trigger-Phrases für Kairos:**
`security scan`, `sicherheitsscan`, `security check`, `fix security`, `scan security`, `clawsec`

**Modell:** `claude-sonnet-4-6`

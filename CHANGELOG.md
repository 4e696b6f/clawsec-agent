# CHANGELOG — ClawSec 2.0

Format: `[YYYY-MM-DD] <type>: <beschreibung>`
Types: `fix`, `feat`, `refactor`, `build`, `docs`, `security`

Nach jeder Änderung eintragen. Bei Auto-Remediations durch ClawSec selbst wird dieser
Eintrag automatisch via `appendChangelog()` in `coordinator.ts` geschrieben.

---

## 2026-03-09 — Technischer Refactor (Probleme A–E behoben)

### [2026-03-09] fix: install.sh — cp statt symlinks, OpenClaw-realpath-kompatibel

**Problem A (kritisch):** OpenClaw's Skill-Loader prüft `realpath()` jedes geladenen Skills.
Symlinks die außerhalb des konfigurierten Roots auflösen werden mit
`Skipping skill path that resolves outside its configured root` übersprungen.

**Änderungen:**
- `install.sh` komplett neu geschrieben
- Alle Datei-Installationen via `cp`, niemals `ln -s` für Skills und Extensions
- Clone-Ziel: `~/.openclaw/workspace/clawsec/` (nicht `/tmp/`)
- Legacy-Symlinks werden beim Install-Lauf erkannt und durch echte Dateien ersetzt
- Nach jedem kritischen Schritt: `[OK]` / `[FAIL]` / `[SKIP]` Ausgabe
- Idempotent: doppeltes Ausführen bricht nicht

---

### [2026-03-09] fix: install.sh — Port-Conflict-Handling vor Backend-Start

**Problem E:** `server.py` stürzte ab wenn Port 3001 bereits belegt war.

**Änderungen in `install.sh`:**
- Port-Check vor Backend-Start-Empfehlung: `free` / `self` / `other`
- `self`: ClawSec läuft bereits → Skip mit Hinweis
- `other`: anderer Prozess → Fehlermeldung + `lsof`-Kommando als Fix

---

### [2026-03-09] fix: scripts/server.py — Port-Conflict-Detection beim Start

**Änderungen:**
- `check_port(host, port)` Funktion ergänzt: erkennt `free` / `self` / `other`
- Beim Start: Prüfung vor `HTTPServer()`-Binding
- `self` → `sys.exit(0)` (schon laufend)
- `other` → `sys.exit(2)` mit klarer Fehlermeldung + Fix-Kommando

---

### [2026-03-09] fix: src/coordinator.ts — CommonJS-Export für OpenClaw Extension-Loader

**Problem B:** OpenClaw's Extension-Loader verwendet `require()` (CommonJS).
ESM `export default` funktioniert nicht — Plugin wurde nicht geladen.

**Änderungen:**
- `import` → `require()` mit TypeScript-Cast (`as typeof import(...)`)
- `export default function register` → `function register` + `module.exports = register;`
- `export async function runSecurityScan` → internes `async function runSecurityScan`
- Erklärender Kommentar vor `register()`

---

### [2026-03-09] build: tsconfig.json — CommonJS TypeScript-Konfiguration

**Neu erstellt:** `tsconfig.json` im Repo-Root
- `"module": "commonjs"` — OpenClaw-kompatibel
- `"target": "es2020"`
- `"strict": true`
- `install.sh` kopiert `tsconfig.json` ins Extensions-Verzeichnis mit

---

### [2026-03-09] feat: scripts/scan-environment.sh — Unified 5-Domain-Scanner

**Problem:** Die Datei fehlte im Repository. Architektur sah einen zentralen Scanner vor,
es gab nur die 5 isolierten Sub-Agent-Scanner.

**Neu erstellt:** `scripts/scan-environment.sh`
- 5 Domains: Identity, Credentials, Network, Sessions, Config+CI
- Read-only: kein `curl`, `wget`, `eval`, `rm` — nur lokale Systemtools
- Output: `ScanOutput`-JSON (format `version: "1"`)
- python3-basierte JSON-Konstruktion (kein jq Dependency)
- `constraints_permissions` als zusätzliches Feld ergänzt
- `chmod +x` bei Creation und in `install.sh`

---

### [2026-03-09] refactor: skills/ — Verzeichnisstruktur normalisiert

**Problem D:** Inkonsistente Skill-Verzeichnis-Struktur — zwei verschiedene Layouts:
```
skills/clawsec-coordinator/SKILL.md       ← direkt
skills/agents/env-agent/SKILL.md          ← verschachtelt + anderes Namensschema
```

**Lösung:**
- Normalisierte flache Struktur erstellt:
  ```
  skills/clawsec-env/SKILL.md
  skills/clawsec-perm/SKILL.md
  skills/clawsec-net/SKILL.md
  skills/clawsec-session/SKILL.md
  skills/clawsec-config/SKILL.md
  ```
- `skills/agents/` bleibt als Legacy-Backup mit `README.md`-Hinweis
- `install.sh` kennt beide Pfade (primär: `agents/`, Fallback: normalisiert)

---

### [2026-03-09] build: src/ — Vite Build-System für Dashboard

**Problem C:** `src/` enthielt nur JSX-Quellcode ohne Build-System.
`serve -s dist -l 8081` zeigte 404 weil `dist/` leer war.

**Neu erstellt:**
- `src/package.json` — Vite + React 18 Dependencies
- `src/vite.config.js` — Dev-Server auf `127.0.0.1:8081`, API-Proxy auf `:3001`
- `src/index.html` — Vite HTML-Template (kein `referrer` Leak)
- `src/main.jsx` — React-Einstiegspunkt, rendert `ClawSecOpsCenter`

**Build:**
```bash
npm install --prefix src/
npm run build --prefix src/
npx serve -s src/dist -l 8081
```

---

### [2026-03-09] docs: INSTALL.md — cp-Workflow dokumentiert, Symlink-Warnung entfernt

**Änderungen:**
- Alle `ln -s`-Befehle durch `cp` ersetzt
- Neue Verzeichnisstruktur mit normalisierten Skill-Pfaden dokumentiert
- Troubleshooting-Sektion hinzugefügt (Skills-Problem, Plugin-Problem, Port, Dashboard)
- v1.0 vs v2.0 Vergleichstabelle aktualisiert

---

### [2026-03-09] docs: CLAUDE.md — Projektanweisungen für Claude Code erstellt

**Neu erstellt:** `CLAUDE.md`
Inhalte:
- Agenten-Struktur + Scope-Boundaries
- Sicherheitsarchitektur + Remediation-Tier-Modell
- Zero-Trust-Anforderungen
- Authentifizierungs-Regeln
- Secure Coding Standards (shell=False, CommonJS, JSON-Kontrakte)
- Installationsregeln (cp, nie ln -s)
- Verbotene Aktionen ohne Nutzer-Freigabe
- Offene Punkte (Sektion 10)

---

## Offene Punkte (geplante zukünftige Einträge)

Beim Abschluss folgender Themen hier eintragen:

- `[ ]` ACP-Integration — Sub-Agenten als echte ACP-Sessions
- `[ ]` Telegram-Konfiguration — Bot-Token + Chat-ID Setup
- `[ ]` Heartbeat-Integration — OpenClaw Heartbeat-Hook-Verknüpfung
- `[ ]` Dashboard-Design-Review — clawsec-ops-center.jsx API-Integration prüfen
- `[ ]` scan-environment.sh jq-Test — Verifikation auf System ohne jq

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

---

## 2026-03-09 — Phase 2: Hardening & Operationalisierung

Ausgangslage: Echter Scan auf Zielsystem (Raspberry Pi, User piko) ergab Risk Score 75/100.
Reale Findings: `gateway_exposed` (CRITICAL), `server_exposed` (HIGH), `sessions_exposed` (HIGH),
`workspace_permissions` (MEDIUM), `config_exposed` (MEDIUM) + 3× MEDIUM auto-fixable.

### [2026-03-09] fix(server): Loopback-Binding explizit + LAN-Access-Log

**Anlass:** `server_exposed`-Finding — Backend war an 0.0.0.0:3001 gebunden.

**Änderungen in `scripts/server.py`:**
- `HOST`-Default war bereits `127.0.0.1` (aus Phase-1-Refactor) — korrekt
- Startup-Log ergänzt: zeigt LAN-Access-Status explizit an:
  - `DISABLED (loopback only)` wenn Host = 127.0.0.1
  - `ENABLED (OPENCLAW_HOST override)` wenn explizit überschrieben
- `sessions_exposed` + `workspace_permissions` in `REMEDIATION_ALLOWLIST` registriert

---

### [2026-03-09] feat(install): systemd Service + Post-Install Security Advisory

**Anlass:** `server.py` stirbt nach Gateway-Restart — kein Autostart vorhanden.

**Neu erstellt:** `install/clawsec.service`
- systemd Unit mit `User=piko` (Placeholder, install.sh setzt echten User)
- `ProtectSystem=strict` — Filesystem read-only außer `ReadWritePaths`
- `ReadWritePaths=/home/piko/.openclaw/workspace/clawsec/reports` (nur reports/)
- `ReadOnlyPaths=/home/piko/.openclaw` — Scanner darf lesen, nicht schreiben
- `NoNewPrivileges=yes`, `PrivateTmp=yes`
- `Restart=on-failure`, `RestartSec=5s` — überlebt Gateway-Restart

**`install.sh` Step 11 (systemd-Setup):**
- Erkennt `systemctl`-Verfügbarkeit und sudo-Zugriff
- Substituiert `User=piko` / `/home/piko` mit echtem `$USER` / `$HOME`
- `sudo systemctl daemon-reload && enable && start`
- Validiert mit `systemctl is-active`
- Ohne sudo: Warnung + manuelle Anleitung

**`install.sh` Step 12 (Gateway Advisory):**
- Liest `gateway.bind` aus `openclaw.json` nach Install
- CRITICAL-Warnung wenn Binding = `0.0.0.0` (Tier: never, manuell zu fixen)
- Advisory-Box mit Scan + Dashboard URLs

---

### [2026-03-09] feat(remediation): sessions_exposed + workspace_permissions Scripts

**Anlass:** `sessions_exposed` (384 .jsonl mit chmod 644) und `workspace_permissions` (775) —
beide Tier 2 (approval-required).

**Neu erstellt:** `scripts/remediation/sessions_exposed.sh`
- Prüft `~/.openclaw/sessions/` und `~/.openclaw/agents/` (beide Locations)
- `chmod 600` auf alle world-readable `*.jsonl`-Dateien
- Idempotent: Exit 1 wenn keine exponierten Dateien gefunden
- Verifiziert Ergebnis nach Fix

**Neu erstellt:** `scripts/remediation/workspace_permissions.sh`
- `chmod 750` auf `~/.openclaw/workspace/`
- Idempotent: Exit 1 wenn bereits 700 oder 750
- Verifiziert Ergebnis nach Fix

---

### [2026-03-09] feat(scan): workspace_permissions + config_exposed Checks

**Anlass:** Zwei reale Findings aus Scan auf Zielsystem fehlten im Scanner.

**Änderungen in `scripts/scan-environment.sh`:**
- Domain 1 erweitert: `WORKSPACE_PERMS` via `stat -c '%a' ~/.openclaw/workspace`
- Domain 1 erweitert: `CONFIG_PERMS` via `stat -c '%a' ~/.openclaw/openclaw.json`
- Risk Emission:
  - `workspace_permissions` (medium) wenn nicht 700/750 → ASI05:2025
  - `config_exposed` (medium) wenn nicht 600/640 → LLM02:2025
- JSON-Output `detected{}`: neue Felder `workspace_permissions` + `config_permissions`

---

### [2026-03-09] fix(plugin): Symlink-Detection Warning in register()

**Anlass:** Skills werden nach Gateway-Restart sporadisch als "outside root" übersprungen
weil alte Symlinks aus Vor-Refactor-Installationen noch vorhanden sind.

**Änderungen in `src/coordinator.ts`:**
- `register()` prüft beim Plugin-Load alle 6 `clawsec-*` SKILL.md via `lstatSync()`
- Symlink erkannt → `console.warn` mit Copy-Befehl zum Fixen
- Zähler: wenn >0 Symlinks → Hinweis `Re-run install.sh`
- Keine blockierende Logik — Plugin lädt weiter, Warning ist diagnostisch

---

### [2026-03-09] feat(checks): Custom Check Definitions für Dashboard

**Anlass:** `workspace_permissions` + `config_exposed` fehlten in der Check-Datenbank.

**Neu erstellt:** `src/data/checks.js`
- 7 Custom Checks: `env_gitignore`, `precommit_hook`, `workspace_permissions`,
  `config_exposed`, `agent_communication_isolation`, `breach_notification_procedure`,
  `runtime_package_install`
- Jeder Check: `id`, `category`, `label`, `description`, `severity`, `phase`,
  `framework`, `stage`, `guide` (steps + code + file + tips), `validation`

---

### Erwarteter Zustand nach Phase 2 (Zielsystem Raspberry Pi)

| Finding | Vorher | Nachher |
|---|---|---|
| `gateway_exposed` | CRITICAL | CRITICAL (Tier: never — manuell) |
| `server_exposed` | HIGH | RESOLVED (127.0.0.1 Default) |
| `sessions_exposed` | HIGH | RESOLVED (nach Approval) |
| `workspace_permissions` | MEDIUM | RESOLVED (nach Approval) |
| `config_exposed` | MEDIUM | MEDIUM (Tier: never — Advisory) |
| `precommit_hook` | MEDIUM | RESOLVED (auto) |
| `breach_notification` | MEDIUM | RESOLVED (auto) |
| `runtime_package` | MEDIUM | RESOLVED (auto) |

Risk Score: 75/100 → ~30/100

---

## Offene Punkte (geplante zukünftige Einträge)

Beim Abschluss folgender Themen hier eintragen:

- `[ ]` ACP-Integration — Sub-Agenten als echte ACP-Sessions
- `[ ]` Telegram-Konfiguration — Bot-Token + Chat-ID Setup
- `[ ]` Heartbeat-Integration — OpenClaw Heartbeat-Hook-Verknüpfung
- `[ ]` Dashboard-Design-Review — clawsec-ops-center.jsx API-Integration prüfen
- `[ ]` scan-environment.sh jq-Test — Verifikation auf System ohne jq
- `[ ]` gateway_exposed manuell beheben — openclaw.json gateway.bind auf 127.0.0.1

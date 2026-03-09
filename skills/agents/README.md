# skills/agents/ — Legacy / Backup

Diese Verzeichnisse sind die ursprüngliche Struktur aus der Entwicklungsphase.

**Die kanonischen, OpenClaw-kompatiblen Skill-Dateien liegen in:**
```
skills/clawsec-coordinator/SKILL.md
skills/clawsec-env/SKILL.md
skills/clawsec-perm/SKILL.md
skills/clawsec-net/SKILL.md
skills/clawsec-session/SKILL.md
skills/clawsec-config/SKILL.md
```

Die Dateien hier (`agents/*/SKILL.md`) sind identische Kopien — sie werden vom
`install.sh` als primäre Quelle unterstützt (Fallback: normalisierte Pfade).

OpenClaw erwartet: `~/.openclaw/skills/<skill-name>/SKILL.md`
Das `install.sh` kopiert die Dateien mit den korrekten Zielnamen.

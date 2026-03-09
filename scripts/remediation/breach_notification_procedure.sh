#!/bin/bash
# breach_notification_procedure.sh — ClawSec Remediation: Create SECURITY.md
# Tier 1 (Auto): creates new file, idempotent, no data loss
# Exit: 0=applied, 1=already_done, 2=error
# Output: JSON to stdout

TARGET_DIR="${PWD}"
SECURITY_FILE="$TARGET_DIR/SECURITY.md"

# ── Check: already exists? ────────────────────────────────────────────────────
if [[ -f "$SECURITY_FILE" ]]; then
  echo '{"exit_code": 1, "output": "SECURITY.md already exists"}'
  exit 0
fi

# ── Apply: write SECURITY.md template ────────────────────────────────────────
cat > "$SECURITY_FILE" << 'SECURITY_EOF'
# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

To report a security vulnerability, please use one of these channels:

1. **Email:** Contact the project maintainer directly (see repository metadata)
2. **GitHub Security Advisories:** Use the "Report a vulnerability" button on this repository

### What to include in your report

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if known)

## Response Timeline

| Step | Timeframe |
|------|-----------|
| Acknowledgment of report | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation | Within 30 days (critical), 90 days (other) |
| Public disclosure | Coordinated with reporter |

## Security Controls

This project implements the following security controls:

- Credentials are excluded from version control via `.gitignore`
- Pre-commit hooks scan for accidental secret exposure
- Agent identity files (SOUL.md, CONSTRAINTS.md) are read-only
- Backend server binds to loopback only (127.0.0.1)
- All remediations are logged to CHANGELOG.md

## OWASP Compliance

This project is assessed against:
- OWASP LLM Top 10 v2.0
- OWASP AI Security Initiative (ASI) 2025

Security scans are performed by ClawSec 2.0.
SECURITY_EOF

if [[ $? -ne 0 ]]; then
  echo '{"exit_code": 2, "output": "Failed to write SECURITY.md — check file permissions"}'
  exit 2
fi

echo '{"exit_code": 0, "output": "SECURITY.md created with breach notification procedure template"}'
exit 0

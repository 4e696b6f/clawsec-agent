#!/usr/bin/env python3
"""
ClawSec 2.0 — Backend Server
Serves sub-agent scan endpoints + coordinator results API.
Binds to 127.0.0.1 only by default.

New in v2.0:
  GET  /api/agent/<agent_name>/scan  → runs per-agent scan script
  GET  /api/scan                     → full coordinator scan (all agents)
  GET  /api/scan/delta               → delta scan against last-scan.json
  GET  /api/reports                  → list available report files
"""

import http.server
import json
import os
import re
import subprocess
import urllib.parse
from pathlib import Path
from http import HTTPStatus
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────

HOST = os.environ.get("OPENCLAW_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPENCLAW_PORT", "3001"))
TARGET_DIR = os.path.expanduser(
    os.environ.get("OPENCLAW_TARGET_DIR", "~/.openclaw")
)
SCRIPT_DIR = Path(__file__).parent
REPORTS_DIR = SCRIPT_DIR.parent / "reports"
VERSION = "2.0.0"

# RFC 1918 private ranges + localhost — CORS allowlist
ALLOWED_ORIGIN_PATTERN = re.compile(
    r"^https?://(localhost|127\.0\.0\.1|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3})"
    r"(:\d+)?$"
)

# Sub-agent scan scripts (each agent has its own isolated script)
AGENT_SCRIPTS: dict[str, str] = {
    "clawsec-env":     "scan/scan-env.sh",
    "clawsec-perm":    "scan/scan-perm.sh",
    "clawsec-net":     "scan/scan-net.sh",
    "clawsec-session": "scan/scan-session.sh",
    "clawsec-config":  "scan/scan-config.sh",
}

# Remediation script allowlist (checkId → script path)
REMEDIATION_ALLOWLIST: dict[str, str] = {
    "env_gitignore":                 "remediation/env_gitignore.sh",
    "precommit_hook":                "remediation/precommit_hook.sh",
    "breach_notification_procedure": "remediation/breach_notification_procedure.sh",
    "runtime_package_install":       "remediation/runtime_package_install.sh",
    # soul_writable handled inline (chmod) — no script needed here
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def cors_headers(origin: str) -> dict:
    if ALLOWED_ORIGIN_PATTERN.match(origin):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        }
    return {}


def run_script(script_path: Path, timeout: int = 30) -> tuple[dict | None, str]:
    """Run a script, return (parsed_json_output, stderr). Returns None on timeout/error."""
    if not script_path.exists():
        return None, f"Script not found: {script_path}"

    try:
        result = subprocess.run(
            ["bash", str(script_path), TARGET_DIR],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=TARGET_DIR,
            shell=False,  # Critical: no shell injection
            env={
                **os.environ,
                "TARGET_DIR": TARGET_DIR,
                "CLAWSEC_ROOT": str(SCRIPT_DIR.parent),
            }
        )
        try:
            return json.loads(result.stdout), result.stderr
        except json.JSONDecodeError:
            return {"error": "Invalid JSON from scanner", "raw": result.stdout[:500]}, result.stderr
    except subprocess.TimeoutExpired:
        return None, f"Script timed out after {timeout}s"
    except Exception as e:
        return None, str(e)


def run_agent_scan(agent_name: str) -> dict:
    """Run a specific sub-agent's scan script."""
    script_rel = AGENT_SCRIPTS.get(agent_name)
    if not script_rel:
        return {
            "agent": agent_name,
            "scope": "unknown",
            "findings": [],
            "error": f"Unknown agent: {agent_name}",
            "scan_duration_ms": 0,
            "agent_version": VERSION,
        }

    script_path = SCRIPT_DIR / script_rel
    start = datetime.now()
    result, stderr = run_script(script_path)
    duration = int((datetime.now() - start).total_seconds() * 1000)

    if result is None:
        return {
            "agent": agent_name,
            "scope": "unknown",
            "findings": [{
                "id": "agent_timeout",
                "severity": "medium",
                "message": f"Agent {agent_name} failed: {stderr[:100]}",
                "owasp_llm": None,
                "owasp_asi": None,
                "remediation_tier": "never",
                "recommendation": "Check scanner logs",
                "status": "open",
            }],
            "scan_duration_ms": duration,
            "agent_version": VERSION,
            "error": stderr[:200],
        }

    return {**result, "scan_duration_ms": duration, "agent_version": VERSION}


# ── Request Handler ───────────────────────────────────────────────────────────

class ClawSecHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # Suppress default access logging — use structured logging
        print(f"[CLAWSEC] {self.address_string()} {format % args}")

    def send_json(self, code: int, data: dict | list) -> None:
        body = json.dumps(data, indent=2).encode()
        origin = self.headers.get("Origin", "")
        cors = cors_headers(origin)

        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in cors.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        cors = cors_headers(origin)
        self.send_response(HTTPStatus.NO_CONTENT)
        for k, v in cors.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path_parts = parsed.path.strip("/").split("/")

        # GET /api/health
        if parsed.path == "/api/health":
            return self.send_json(200, {"status": "ok", "version": VERSION})

        # GET /api/agent/<agent_name>/scan
        if len(path_parts) == 4 and path_parts == ["api", "agent", path_parts[2], "scan"]:
            agent_name = path_parts[2]
            if agent_name not in AGENT_SCRIPTS:
                return self.send_json(404, {"error": f"Unknown agent: {agent_name}"})
            result = run_agent_scan(agent_name)
            return self.send_json(200, result)

        # GET /api/scan → full scan (all agents sequentially, coordinator aggregates)
        if parsed.path == "/api/scan":
            all_results = {}
            for agent_name in AGENT_SCRIPTS:
                all_results[agent_name] = run_agent_scan(agent_name)
            return self.send_json(200, {
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "agent_results": all_results,
                "version": VERSION,
            })

        # GET /api/last-report
        if parsed.path == "/api/last-report":
            report_path = REPORTS_DIR / "last-scan.json"
            if not report_path.exists():
                return self.send_json(404, {"error": "No scan report yet. Run /api/scan first."})
            try:
                return self.send_json(200, json.loads(report_path.read_text()))
            except Exception as e:
                return self.send_json(500, {"error": str(e)})

        # GET /api/reports → list all report files
        if parsed.path == "/api/reports":
            if not REPORTS_DIR.exists():
                return self.send_json(200, {"reports": []})
            reports = sorted(
                [f.name for f in REPORTS_DIR.glob("scan-*.json")],
                reverse=True
            )[:20]  # Last 20 reports
            return self.send_json(200, {"reports": reports, "total": len(reports)})

        # GET /api/checks
        if parsed.path == "/api/checks":
            return self.send_json(200, {
                "auto_fixable": list(REMEDIATION_ALLOWLIST.keys()),
                "agents": list(AGENT_SCRIPTS.keys()),
            })

        return self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path_parts = parsed.path.strip("/").split("/")

        # POST /api/apply/<checkId>
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "apply":
            check_id = path_parts[2]

            # Validate checkId: alphanumeric + underscore, max 64 chars
            if not re.match(r"^[a-z_]{1,64}$", check_id):
                return self.send_json(400, {"error": "Invalid checkId format"})

            # Validate against explicit allowlist
            if check_id not in REMEDIATION_ALLOWLIST:
                return self.send_json(400, {
                    "error": f"'{check_id}' is not auto-fixable",
                    "auto_fixable": list(REMEDIATION_ALLOWLIST.keys()),
                })

            script_path = SCRIPT_DIR / REMEDIATION_ALLOWLIST[check_id]
            if not script_path.exists():
                return self.send_json(404, {"error": "Remediation script not found"})

            start = datetime.now()
            result, stderr = run_script(script_path, timeout=30)
            duration = int((datetime.now() - start).total_seconds() * 1000)

            if result is None:
                return self.send_json(504, {"error": f"Remediation timed out: {check_id}"})

            exit_code = result.get("exit_code", 0)
            return self.send_json(200, {
                "success": exit_code == 0,
                "already_done": exit_code == 1,
                "check_id": check_id,
                "output": result.get("output", "")[:1000],
                "exit_code": exit_code,
                "duration_ms": duration,
            })

        return self.send_json(404, {"error": "Not found"})


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    
    server = http.server.HTTPServer((HOST, PORT), ClawSecHandler)
    print(f"[CLAWSEC] Server v{VERSION} running on http://{HOST}:{PORT}")
    print(f"[CLAWSEC] Target directory: {TARGET_DIR}")
    print(f"[CLAWSEC] Reports directory: {REPORTS_DIR}")
    print(f"[CLAWSEC] Sub-agents: {', '.join(AGENT_SCRIPTS.keys())}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[CLAWSEC] Server stopped")
        server.server_close()

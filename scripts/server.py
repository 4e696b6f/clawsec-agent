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

import collections
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from http import HTTPStatus
from datetime import datetime, timezone

# ── Runtime metrics ───────────────────────────────────────────────────────────

SERVER_START_TIME = time.time()
TOOL_CALL_COUNTER: collections.deque = collections.deque(maxlen=300)  # rolling 5-min window


def record_tool_call() -> None:
    TOOL_CALL_COUNTER.append(time.time())


def tool_calls_last_5min() -> int:
    cutoff = time.time() - 300
    return sum(1 for t in TOOL_CALL_COUNTER if t > cutoff)


def memory_used_mb() -> int:
    try:
        import psutil
        return int(psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024)
    except ImportError:
        return 0  # psutil optional — graceful fallback


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
# Tier 1 (auto): env_gitignore, precommit_hook, breach_notification_procedure, runtime_package_install
# Tier 2 (approval): sessions_exposed, workspace_permissions, gateway_exposed
REMEDIATION_ALLOWLIST: dict[str, str] = {
    "env_gitignore":                 "remediation/env_gitignore.sh",
    "precommit_hook":                "remediation/precommit_hook.sh",
    "breach_notification_procedure": "remediation/breach_notification_procedure.sh",
    "runtime_package_install":       "remediation/runtime_package_install.sh",
    "sessions_exposed":              "remediation/sessions_exposed.sh",
    "workspace_permissions":         "remediation/workspace_permissions.sh",
    "gateway_exposed":               "remediation/gateway_exposed.sh",
    # soul_writable + constraints_writable handled inline (chmod) — no script needed here
}

# Config files editable via /api/config/:key — strict whitelist
# SOUL.md is chmod 444 (intentionally immutable) — server will get PermissionError → 403
CONFIG_WHITELIST: dict[str, str] = {
    "soul":        "workspace/SOUL.md",
    "constraints": "workspace/CONSTRAINTS.md",
    "gateway":     "workspace/GATEWAY.md",
}
CONFIG_MAX_BYTES = 65_536  # 64KB max per config file


def compute_system_hash() -> str:
    """SHA256 over identity files — first 8 chars for drift detection."""
    identity_files = [
        os.path.join(TARGET_DIR, "workspace", "SOUL.md"),
        os.path.join(TARGET_DIR, "workspace", "CONSTRAINTS.md"),
        os.path.join(TARGET_DIR, "openclaw.json"),
    ]
    h = hashlib.sha256()
    for fp in identity_files:
        try:
            h.update(open(fp, "rb").read())
        except (FileNotFoundError, PermissionError):
            h.update(fp.encode())
    return h.hexdigest()[:8]


# ── Inter-Agent Auth Token (ASI07) ────────────────────────────────────────────
# Prevents unauthorized local processes from triggering remediations via HTTP.
# Token is auto-generated on first start and stored at 600 permissions.
# Only mutating endpoints (/api/apply/) require the token.
# Read-only endpoints (health, scan, reports) remain open — no secrets exposed.

TOKEN_FILE = SCRIPT_DIR.parent / ".clawsec_token"


def _load_or_create_token() -> str:
    """Load token from file or generate a new one with chmod 600."""
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    token = secrets.token_hex(32)
    TOKEN_FILE.write_text(token)
    TOKEN_FILE.chmod(0o600)
    print(f"[CLAWSEC] Auth token generated: {TOKEN_FILE}")
    return token


CLAWSEC_TOKEN = _load_or_create_token()


def _require_token(handler_self) -> bool:
    """Check X-ClawSec-Token header. Sends 401 and returns False if unauthorized."""
    auth = handler_self.headers.get("X-ClawSec-Token", "")
    if not hmac.compare_digest(auth, CLAWSEC_TOKEN):
        handler_self.send_response(401)
        handler_self.send_header("Content-Type", "application/json")
        handler_self.send_header("X-Content-Type-Options", "nosniff")
        handler_self.end_headers()
        handler_self.wfile.write(b'{"error": "Unauthorized"}')
        return False
    return True

# ── Helpers ───────────────────────────────────────────────────────────────────

def cors_headers(origin: str) -> dict:
    if ALLOWED_ORIGIN_PATTERN.match(origin):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-ClawSec-Token",
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
            return self.send_json(200, {
                "status":      "ok",
                "version":     VERSION,
                "system_hash": compute_system_hash(),
            })

        # GET /api/heartbeat
        if parsed.path == "/api/heartbeat":
            return self.send_json(200, {
                "status":               "active",
                "agent_id":             "kairos",
                "last_ping":            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "tool_calls_last_5min": tool_calls_last_5min(),
                "current_skill":        "clawsec",
                "memory_used_mb":       memory_used_mb(),
                "uptime_seconds":       int(time.time() - SERVER_START_TIME),
                "system_hash":          compute_system_hash(),
                "version":              VERSION,
            })

        # GET /api/agent/<agent_name>/scan
        if len(path_parts) == 4 and path_parts == ["api", "agent", path_parts[2], "scan"]:
            agent_name = path_parts[2]
            if agent_name not in AGENT_SCRIPTS:
                return self.send_json(404, {"error": f"Unknown agent: {agent_name}"})
            result = run_agent_scan(agent_name)
            return self.send_json(200, result)

        # GET /api/scan → full scan (all agents sequentially, coordinator aggregates)
        if parsed.path == "/api/scan":
            record_tool_call()
            all_results = {}
            for agent_name in AGENT_SCRIPTS:
                all_results[agent_name] = run_agent_scan(agent_name)

            timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            response_data = {
                "timestamp":    timestamp,
                "agent_results": all_results,
                "version":      VERSION,
                "system_hash":  compute_system_hash(),
            }

            # Persist report to disk (reports/ dir is gitignored, mode 700)
            try:
                safe_ts = timestamp.replace(":", "-").replace(".", "-")
                report_file = REPORTS_DIR / f"scan-{safe_ts}.json"
                report_json = json.dumps(response_data, indent=2)
                report_file.write_text(report_json)
                (REPORTS_DIR / "last-scan.json").write_text(report_json)
            except Exception as e:
                print(f"[CLAWSEC] Warning: could not save report: {e}")

            return self.send_json(200, response_data)

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

        # GET /api/reports/<filename> → serve individual report file
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "reports":
            filename = path_parts[2]
            if not re.match(r'^[a-zA-Z0-9._-]{1,80}$', filename) or '..' in filename:
                return self.send_json(400, {"error": "Invalid filename"})
            report_path = REPORTS_DIR / filename
            if not report_path.exists():
                return self.send_json(404, {"error": "Report not found"})
            try:
                return self.send_json(200, json.loads(report_path.read_text()))
            except Exception:
                return self.send_json(500, {"error": "Internal error"})

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

        # POST /api/apply/<checkId>  — requires X-ClawSec-Token (ASI07)
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "apply":
            if not _require_token(self):
                return
            record_tool_call()
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

        # POST /api/config/<file_key> — requires token, strict whitelist
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "config":
            if not _require_token(self):
                return
            file_key = path_parts[2]
            if file_key not in CONFIG_WHITELIST:
                return self.send_json(400, {"error": f"Not editable: {file_key}"})
            length = int(self.headers.get("Content-Length", 0))
            if length > CONFIG_MAX_BYTES:
                return self.send_json(413, {"error": "Content too large"})
            body = self.rfile.read(length).decode("utf-8", errors="replace")
            target_path = Path(TARGET_DIR) / CONFIG_WHITELIST[file_key]
            backup_path = target_path.with_suffix(target_path.suffix + ".bak")
            try:
                if target_path.exists():
                    shutil.copy2(target_path, backup_path)
                target_path.write_text(body)
                return self.send_json(200, {
                    "success": True,
                    "file": file_key,
                    "system_hash": compute_system_hash(),
                })
            except PermissionError:
                return self.send_json(403, {
                    "error": f"{file_key} is immutable (chmod 444)",
                    "hint": "SOUL.md and CONSTRAINTS.md are intentionally write-protected",
                })
            except Exception:
                return self.send_json(500, {"error": "Internal error"})

        return self.send_json(404, {"error": "Not found"})


# ── Port Conflict Detection ───────────────────────────────────────────────────

def check_port(host: str, port: int) -> str:
    """
    Returns 'free', 'self', or 'other'.
    - 'free'  : port is not in use → safe to start
    - 'self'  : port is occupied by our own ClawSec server → skip start
    - 'other' : port is occupied by a different process → error
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    result = sock.connect_ex((host, port))
    sock.close()

    if result != 0:
        return "free"

    # Port is occupied — check if it's our own server via /api/health
    try:
        url = f"http://{host}:{port}/api/health"
        with urllib.request.urlopen(url, timeout=2) as r:
            data = json.loads(r.read())
            if data.get("status") == "ok":
                return "self"
    except Exception:
        pass

    return "other"


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Port conflict detection — run before binding
    port_status = check_port(HOST, PORT)
    if port_status == "self":
        print(f"[CLAWSEC] Server already running on {HOST}:{PORT} — skipping start")
        sys.exit(0)
    elif port_status == "other":
        print(f"[CLAWSEC] ERROR: Port {PORT} is in use by another process")
        print(f"[CLAWSEC] Fix:   lsof -ti:{PORT} | xargs kill -9")
        print(f"[CLAWSEC] Then:  python3 {__file__} &")
        sys.exit(2)
    # port_status == "free" → proceed with normal startup

    server = http.server.HTTPServer((HOST, PORT), ClawSecHandler)
    print(f"[CLAWSEC] Server v{VERSION} running on http://{HOST}:{PORT}")
    print(f"[CLAWSEC] LAN access: {'ENABLED (OPENCLAW_HOST override)' if HOST != '127.0.0.1' else 'DISABLED (loopback only)'}")
    print(f"[CLAWSEC] Auth token: {TOKEN_FILE}")
    print(f"[CLAWSEC] Target directory: {TARGET_DIR}")
    print(f"[CLAWSEC] Reports directory: {REPORTS_DIR}")
    print(f"[CLAWSEC] Sub-agents: {', '.join(AGENT_SCRIPTS.keys())}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[CLAWSEC] Server stopped")
        server.server_close()

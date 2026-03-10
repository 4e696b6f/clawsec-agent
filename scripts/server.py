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
import logging
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
from logging.handlers import RotatingFileHandler
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
_DEFAULT_REPORTS = SCRIPT_DIR.parent / "reports"


def _load_plugin_config() -> dict:
    """Load plugins.entries.clawsec.config from openclaw.json. ENV overrides."""
    openclaw_json = Path(TARGET_DIR) / "openclaw.json"
    if not openclaw_json.exists():
        return {}
    try:
        data = json.loads(openclaw_json.read_text())
        cfg = (data.get("plugins") or {}).get("entries") or {}
        return (cfg.get("clawsec") or {}).get("config") or {}
    except (json.JSONDecodeError, OSError):
        return {}


_PLUGIN_CONFIG = _load_plugin_config()
_REPORTS_DIR_OVERRIDE = _PLUGIN_CONFIG.get("reportDir")
if _REPORTS_DIR_OVERRIDE:
    REPORTS_DIR = Path(os.path.expanduser(str(_REPORTS_DIR_OVERRIDE)))
else:
    REPORTS_DIR = _DEFAULT_REPORTS
SKIP_AUTO_FIX = _PLUGIN_CONFIG.get("skipAutoFix") is True
APPLIED_FIXES_PATH = REPORTS_DIR / "applied-fixes.json"
VERSION = "2.0.0"
SCAN_SCHEMA_VERSION = "1.0"

# ── Structured Logging ────────────────────────────────────────────────────────
# Writes to logs/clawsec.log (RotatingFileHandler, 1MB, 3 backups) + stdout.
# SECURITY: Never log the auth token value — only client IP and check IDs.

_LOG_DIR = SCRIPT_DIR.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_log_handler = RotatingFileHandler(
    _LOG_DIR / "clawsec.log", maxBytes=1_000_000, backupCount=3
)
_log_handler.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)-5s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S")
)
logger = logging.getLogger("clawsec")
logger.setLevel(logging.DEBUG)
logger.addHandler(_log_handler)
logger.addHandler(logging.StreamHandler(sys.stdout))

# Explicit trusted origins only (local profile by default).
TRUSTED_ORIGINS = {
    "http://127.0.0.1:8081",
    "http://localhost:8081",
}
EXTRA_TRUSTED_ORIGINS = {
    o.strip()
    for o in os.environ.get("CLAWSEC_TRUSTED_ORIGINS", "").split(",")
    if o.strip()
}
TRUSTED_ORIGINS |= EXTRA_TRUSTED_ORIGINS

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
IMMUTABLE_CONFIG_KEYS = {"soul", "constraints"}

CHECK_ID_RE = re.compile(r"^[a-z_]{1,64}$")


def _load_applied_fixes() -> list[dict]:
    """Load applied-fixes.json. Returns empty list if missing or invalid."""
    if not APPLIED_FIXES_PATH.exists():
        return []
    try:
        data = json.loads(APPLIED_FIXES_PATH.read_text())
        entries = data.get("entries", [])
        return entries if isinstance(entries, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _append_applied_fix(check_id: str, exit_code: int, duration_ms: int) -> None:
    """Append a fix entry to applied-fixes.json."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    entries = _load_applied_fixes()
    entries.append({
        "check_id": check_id,
        "applied_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "system_hash_at_apply": compute_system_hash(),
        "exit_code": exit_code,
        "duration_ms": duration_ms,
    })
    # Keep last 100 entries
    if len(entries) > 100:
        entries = entries[-100:]
    APPLIED_FIXES_PATH.write_text(json.dumps({"entries": entries}, indent=2))


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
APPLY_TOKEN_FILE = SCRIPT_DIR.parent / ".clawsec_token.apply"
CONFIG_TOKEN_FILE = SCRIPT_DIR.parent / ".clawsec_token.config"


def _derive_scoped_token(base_token: str, scope: str) -> str:
    return hmac.new(base_token.encode(), scope.encode(), hashlib.sha256).hexdigest()


def _load_or_create_tokens() -> dict[str, str]:
    """Load or create base/scoped tokens with chmod 600."""
    if TOKEN_FILE.exists():
        base_token = TOKEN_FILE.read_text().strip()
    else:
        base_token = secrets.token_hex(32)
        TOKEN_FILE.write_text(base_token)
        TOKEN_FILE.chmod(0o600)
        logger.info("Auth token generated: %s", TOKEN_FILE)

    apply_token = _derive_scoped_token(base_token, "apply")
    config_token = _derive_scoped_token(base_token, "config")
    APPLY_TOKEN_FILE.write_text(apply_token)
    APPLY_TOKEN_FILE.chmod(0o600)
    CONFIG_TOKEN_FILE.write_text(config_token)
    CONFIG_TOKEN_FILE.chmod(0o600)
    return {
        "base": base_token,
        "apply": apply_token,
        "config": config_token,
    }


CLAWSEC_TOKENS = _load_or_create_tokens()

FAILED_AUTH_ATTEMPTS: dict[str, collections.deque] = {}
AUTH_WINDOW_SECONDS = 60
AUTH_MAX_ATTEMPTS = 10


def _auth_throttled(client_ip: str) -> bool:
    now = time.time()
    q = FAILED_AUTH_ATTEMPTS.setdefault(client_ip, collections.deque())
    while q and q[0] < now - AUTH_WINDOW_SECONDS:
        q.popleft()
    return len(q) >= AUTH_MAX_ATTEMPTS


def _record_auth_failure(client_ip: str) -> None:
    FAILED_AUTH_ATTEMPTS.setdefault(client_ip, collections.deque()).append(time.time())


def audit_event(event_type: str, **payload) -> None:
    logger.info(json.dumps({
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        **payload,
    }, separators=(",", ":")))


def _require_token(handler_self, required_scope: str) -> bool:
    """Check X-ClawSec-Token header with scope-aware validation + throttling."""
    client_ip = handler_self.address_string()
    if _auth_throttled(client_ip):
        handler_self.send_response(429)
        handler_self.send_header("Content-Type", "application/json")
        handler_self.send_header("X-Content-Type-Options", "nosniff")
        handler_self.end_headers()
        handler_self.wfile.write(b'{"error":"Too many failed auth attempts"}')
        return False

    auth = (handler_self.headers.get("X-ClawSec-Token") or "").strip()
    expected_scope_token = CLAWSEC_TOKENS.get(required_scope, "")
    ok = auth and (
        hmac.compare_digest(auth, expected_scope_token) or hmac.compare_digest(auth, CLAWSEC_TOKENS["base"])
    )
    if not ok:
        _record_auth_failure(client_ip)
        handler_self.send_response(401)
        handler_self.send_header("Content-Type", "application/json")
        handler_self.send_header("X-Content-Type-Options", "nosniff")
        handler_self.end_headers()
        handler_self.wfile.write(b'{"error":"Unauthorized"}')
        return False
    return True

# ── Helpers ───────────────────────────────────────────────────────────────────

def cors_headers(origin: str) -> dict:
    if origin in TRUSTED_ORIGINS:
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


def parse_json_body(handler_self, max_bytes: int = CONFIG_MAX_BYTES) -> tuple[dict | None, str | None]:
    length = int(handler_self.headers.get("Content-Length", 0))
    if length > max_bytes:
        return None, "Content too large"
    raw = handler_self.rfile.read(length).decode("utf-8", errors="replace")
    try:
        return json.loads(raw), None
    except json.JSONDecodeError:
        return None, "Invalid JSON body"


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
        logger.debug("%s %s", self.address_string(), format % args)

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

        # GET /api/token-path — returns path to token file (no secret); for dashboard UX
        if parsed.path == "/api/token-path":
            return self.send_json(200, {
                "path": str(TOKEN_FILE),
                "hint": "Paste the contents of this file into the Dashboard Config tab → Auth token",
            })

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
                "schema_version": SCAN_SCHEMA_VERSION,
                "timestamp":    timestamp,
                "scanned_at":   timestamp,
                "agent_results": all_results,
                "version":      VERSION,
                "system_hash":  compute_system_hash(),
            }

            total_findings = sum(len(r.get("findings", [])) for r in all_results.values())
            logger.info("Scan complete — %d agents, %d findings, from %s",
                        len(all_results), total_findings, self.address_string())
            audit_event(
                "scan_completed",
                client_ip=self.address_string(),
                findings=total_findings,
                agents=len(all_results),
                schema_version=SCAN_SCHEMA_VERSION,
            )

            # Persist report to disk (reports/ dir is gitignored, mode 700)
            try:
                safe_ts = timestamp.replace(":", "-").replace(".", "-")
                report_file = REPORTS_DIR / f"scan-{safe_ts}.json"
                report_json = json.dumps(response_data, indent=2)
                report_file.write_text(report_json)
                (REPORTS_DIR / "last-scan.json").write_text(report_json)
            except Exception as e:
                logger.warning("Could not save report: %s", e)

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

        # GET /api/applied-fixes — persisted fix history for re-config detection
        if parsed.path == "/api/applied-fixes":
            entries = _load_applied_fixes()
            return self.send_json(200, {
                "entries": entries,
                "current_system_hash": compute_system_hash(),
            })

        return self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path_parts = parsed.path.strip("/").split("/")

        # POST /api/apply/<checkId>  — requires X-ClawSec-Token (ASI07)
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "apply":
            if not _require_token(self, "apply"):
                logger.warning("Auth token mismatch from %s", self.address_string())
                return
            if SKIP_AUTO_FIX:
                return self.send_json(403, {
                    "error": "Auto-remediation disabled",
                    "hint": "Set plugins.entries.clawsec.config.skipAutoFix to false in openclaw.json",
                })
            record_tool_call()
            check_id = path_parts[2]

            # Validate checkId: alphanumeric + underscore, max 64 chars
            if not CHECK_ID_RE.match(check_id):
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

            logger.info("Applying %s for %s", check_id, self.address_string())
            start = datetime.now()
            result, stderr = run_script(script_path, timeout=30)
            duration = int((datetime.now() - start).total_seconds() * 1000)

            if result is None:
                logger.error("Remediation timed out: %s", check_id)
                return self.send_json(504, {"error": f"Remediation timed out: {check_id}"})

            exit_code = result.get("exit_code", 0)
            if exit_code >= 2:
                logger.error("Script %s exit %d: %s", check_id, exit_code, stderr[:200])
            else:
                logger.info("Applied %s — exit %d (%dms)", check_id, exit_code, duration)
                try:
                    _append_applied_fix(check_id, exit_code, duration)
                except Exception as e:
                    logger.warning("Could not persist applied fix: %s", e)
            audit_event(
                "remediation_applied",
                client_ip=self.address_string(),
                check_id=check_id,
                success=(exit_code == 0),
                already_done=(exit_code == 1),
                exit_code=exit_code,
                duration_ms=duration,
            )
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
            if not _require_token(self, "config"):
                logger.warning("Auth token mismatch (config) from %s", self.address_string())
                return
            file_key = path_parts[2]
            if file_key not in CONFIG_WHITELIST:
                return self.send_json(400, {"error": f"Not editable: {file_key}"})
            if file_key in IMMUTABLE_CONFIG_KEYS:
                return self.send_json(403, {
                    "error": f"{file_key} is immutable by policy",
                    "hint": "SOUL.md and CONSTRAINTS.md are intentionally write-protected",
                })
            payload, parse_error = parse_json_body(self, max_bytes=CONFIG_MAX_BYTES)
            if parse_error == "Content too large":
                return self.send_json(413, {"error": parse_error})
            if parse_error:
                return self.send_json(400, {"error": parse_error})
            content = str((payload or {}).get("content", ""))
            target_path = Path(TARGET_DIR) / CONFIG_WHITELIST[file_key]
            backup_path = target_path.with_suffix(target_path.suffix + ".bak")
            try:
                if target_path.exists():
                    shutil.copy2(target_path, backup_path)
                target_path.write_text(content)
                logger.info("Config %s updated by %s", file_key, self.address_string())
                audit_event(
                    "config_updated",
                    client_ip=self.address_string(),
                    file_key=file_key,
                    bytes=len(content.encode("utf-8")),
                )
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
    logger.info("Server v%s starting on http://%s:%d", VERSION, HOST, PORT)
    logger.info("LAN access: %s", "ENABLED (OPENCLAW_HOST override)" if HOST != "127.0.0.1" else "DISABLED (loopback only)")
    logger.info("Auth token file: %s", TOKEN_FILE)
    logger.info("Scoped token files: %s, %s", APPLY_TOKEN_FILE, CONFIG_TOKEN_FILE)
    logger.info("Trusted origins: %s", ", ".join(sorted(TRUSTED_ORIGINS)) if TRUSTED_ORIGINS else "(none)")
    logger.info("Target directory: %s", TARGET_DIR)
    logger.info("Reports directory: %s", REPORTS_DIR)
    logger.info("Sub-agents: %s", ", ".join(AGENT_SCRIPTS.keys()))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
        server.server_close()

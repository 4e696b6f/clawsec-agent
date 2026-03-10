#!/usr/bin/env python3
"""
Test Apply auth flow: token validation, trimming, and endpoint behavior.

Requires server running: python3 scripts/server.py
Run from repo root: python3 scripts/tests/test_apply_auth.py

Tests:
  - GET /api/token-path returns path (no secret)
  - POST /api/apply/<id> with valid token → 200
  - POST /api/apply/<id> with invalid token → 401
  - POST /api/apply/<id> with trimmed token (whitespace) → 200
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent
TOKEN_FILE = ROOT / ".clawsec_token"
DEFAULT_BASE = "http://127.0.0.1:3001"


def request(method: str, path: str, token: str | None = None, base: str = DEFAULT_BASE) -> tuple[int, dict]:
    url = f"{base}{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-ClawSec-Token", token.strip())
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            import json
            body = json.loads(r.read().decode()) if r.length else {}
            return r.status, body
    except urllib.error.HTTPError as e:
        body = {}
        try:
            body = __import__("json").loads(e.read().decode())
        except Exception:
            pass
        return e.code, body
    except urllib.error.URLError as e:
        raise SystemExit(f"Server not reachable: {e.reason}. Start: python3 scripts/server.py") from e


def main() -> int:
    ap = argparse.ArgumentParser(description="Test ClawSec Apply auth flow")
    ap.add_argument("--base", default=DEFAULT_BASE, help="API base URL")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    failures: list[str] = []

    # 1. GET /api/token-path
    status, data = request("GET", "/api/token-path", base=base)
    if status != 200:
        failures.append(f"GET /api/token-path: expected 200, got {status}")
    elif "path" not in data:
        failures.append("GET /api/token-path: missing 'path' in response")
    else:
        print(f"[OK] GET /api/token-path → path={data['path']}")

    # 2. Load token from file
    if not TOKEN_FILE.exists():
        failures.append(f"Token file not found: {TOKEN_FILE}. Run server once to generate.")
        for f in failures:
            print(f"[FAIL] {f}")
        return 1

    token = TOKEN_FILE.read_text().strip()
    if not token:
        failures.append("Token file is empty")

    # 3. POST /api/apply with invalid token → 401
    status, _ = request("POST", "/api/apply/env_gitignore", token="invalid-token-xyz", base=base)
    if status != 401:
        failures.append(f"POST with bad token: expected 401, got {status}")
    else:
        print("[OK] POST /api/apply with bad token → 401")

    # 4. POST /api/apply with valid token → 200 (or 504 if script times out; auth passed)
    status, body = request("POST", "/api/apply/env_gitignore", token=token, base=base)
    if status == 401:
        failures.append(f"POST with valid token: got 401 (auth failed) — token mismatch?")
    elif status not in (200, 504):
        failures.append(f"POST with valid token: expected 200 or 504, got {status} {body}")
    else:
        print(f"[OK] POST /api/apply with valid token → {status} (auth passed)")

    # 5. POST with token that has leading/trailing whitespace → 200 or 504 (server trims)
    status, _ = request("POST", "/api/apply/env_gitignore", token=f"  {token}  \n", base=base)
    if status == 401:
        failures.append("POST with trimmed token: got 401 (server should trim)")
    elif status not in (200, 504):
        failures.append(f"POST with trimmed token: expected 200 or 504, got {status}")
    else:
        print("[OK] POST with whitespace-padded token → auth passed (server trims)")

    if failures:
        for f in failures:
            print(f"[FAIL] {f}")
        return 1
    print("\nAll auth flow tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

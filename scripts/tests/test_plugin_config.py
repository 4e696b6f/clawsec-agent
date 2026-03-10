#!/usr/bin/env python3
"""
Test plugin config loading from openclaw.json (skipAutoFix, reportDir).

Runs in subprocess with OPENCLAW_TARGET_DIR to avoid polluting real config.
No server required.

Run: python3 scripts/tests/test_plugin_config.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def run_config_test(openclaw_content: dict, assertions: str) -> tuple[bool, str]:
    """Run a subprocess that imports server and runs assertions. Returns (ok, message)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        openclaw_json = tmp_path / "openclaw.json"
        openclaw_json.write_text(json.dumps(openclaw_content), encoding="utf-8")

        env = os.environ.copy()
        env["OPENCLAW_TARGET_DIR"] = str(tmp_path)

        code = f"""
import sys
sys.path.insert(0, {str(ROOT)!r})
from scripts import server
{assertions}
"""
        result = subprocess.run(
            [sys.executable, "-c", code],
            env=env,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return False, result.stderr or result.stdout or "non-zero exit"
        return True, ""


def main() -> int:
    failures: list[str] = []

    # 1. No openclaw.json → skipAutoFix False, default REPORTS_DIR
    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ.copy()
        env["OPENCLAW_TARGET_DIR"] = str(tmp)
        code = f"""
import sys
sys.path.insert(0, {str(ROOT)!r})
from scripts import server
assert server.SKIP_AUTO_FIX is False, "Expected SKIP_AUTO_FIX False when no config"
assert server.REPORTS_DIR == server._DEFAULT_REPORTS, "Expected default REPORTS_DIR"
"""
        r = subprocess.run([sys.executable, "-c", code], env=env, cwd=str(ROOT), capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            failures.append(f"No config: {r.stderr or r.stdout}")
        else:
            print("[OK] No openclaw.json → skipAutoFix False, default REPORTS_DIR")

    # 2. skipAutoFix: true → SKIP_AUTO_FIX True
    ok, err = run_config_test(
        {"plugins": {"entries": {"clawsec": {"config": {"skipAutoFix": True}}}}},
        "assert server.SKIP_AUTO_FIX is True, 'Expected SKIP_AUTO_FIX True'",
    )
    if not ok:
        failures.append(f"skipAutoFix: true: {err}")
    else:
        print("[OK] skipAutoFix: true → SKIP_AUTO_FIX True")

    # 3. skipAutoFix: false → SKIP_AUTO_FIX False
    ok, err = run_config_test(
        {"plugins": {"entries": {"clawsec": {"config": {"skipAutoFix": False}}}}},
        "assert server.SKIP_AUTO_FIX is False, 'Expected SKIP_AUTO_FIX False'",
    )
    if not ok:
        failures.append(f"skipAutoFix: false: {err}")
    else:
        print("[OK] skipAutoFix: false → SKIP_AUTO_FIX False")

    # 4. reportDir set → REPORTS_DIR uses it
    ok, err = run_config_test(
        {"plugins": {"entries": {"clawsec": {"config": {"reportDir": "/tmp/clawsec_test_reports"}}}}},
        "import os; assert str(server.REPORTS_DIR) == os.path.expanduser('/tmp/clawsec_test_reports'), 'Expected reportDir'",
    )
    if not ok:
        failures.append(f"reportDir: {err}")
    else:
        print("[OK] reportDir: /tmp/clawsec_test_reports → REPORTS_DIR set")

    # 5. Malformed JSON → empty config, no crash
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "openclaw.json").write_text("{ invalid json", encoding="utf-8")
        env = os.environ.copy()
        env["OPENCLAW_TARGET_DIR"] = tmp
        code = f"""
import sys
sys.path.insert(0, {str(ROOT)!r})
from scripts import server
assert server.SKIP_AUTO_FIX is False, "Malformed JSON should yield default"
"""
        r = subprocess.run([sys.executable, "-c", code], env=env, cwd=str(ROOT), capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            failures.append(f"Malformed JSON: {r.stderr or r.stdout}")
        else:
            print("[OK] Malformed openclaw.json → no crash, default config")

    if failures:
        for f in failures:
            print(f"[FAIL] {f}")
        return 1
    print("\nAll plugin config tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

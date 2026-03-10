#!/usr/bin/env python3
"""
Security regression checks for policy/remediation drift.

Run:
  python3 scripts/tests/test_policy_consistency.py
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER_PATH = ROOT / "scripts" / "server.py"
POLICY_PATH = ROOT / "src" / "policy.ts"
SCAN_DIR = ROOT / "scripts" / "scan"


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def extract_py_dict_keys(text: str, var_name: str) -> set[str]:
    pattern = rf"{var_name}\s*:\s*dict\[str,\s*str\]\s*=\s*\{{(.*?)\n\}}"
    m = re.search(pattern, text, flags=re.S)
    if not m:
        fail(f"Could not parse python dict for {var_name}")
    block = "{" + m.group(1) + "\n}"
    try:
        parsed = ast.literal_eval(block)
    except Exception as exc:  # pragma: no cover
        fail(f"Could not eval dict {var_name}: {exc}")
    return set(parsed.keys())


def extract_ts_array(text: str, const_name: str) -> set[str]:
    pattern = rf"export const {const_name}\s*=\s*\[(.*?)\];"
    m = re.search(pattern, text, flags=re.S)
    if not m:
        fail(f"Could not parse TS array for {const_name}")
    values = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    if not values:
        fail(f"Array {const_name} is empty or unparsable")
    return values


def extract_scan_finding_ids(scan_path: Path) -> set[str]:
    text = scan_path.read_text(encoding="utf-8")
    return set(re.findall(r'"([a-z_]+)"\s+"(?:critical|high|medium|low|info)"', text))


def main() -> int:
    server_text = SERVER_PATH.read_text(encoding="utf-8")
    policy_text = POLICY_PATH.read_text(encoding="utf-8")

    remediation_allowlist = extract_py_dict_keys(server_text, "REMEDIATION_ALLOWLIST")
    auto_ids = extract_ts_array(policy_text, "AUTO_REMEDIATION_IDS")
    approval_ids = extract_ts_array(policy_text, "APPROVAL_REQUIRED_IDS")
    never_ids = extract_ts_array(policy_text, "NEVER_AUTO_REMEDIATE_IDS")

    policy_ids = auto_ids | approval_ids | never_ids

    if not auto_ids.issubset(remediation_allowlist | {"soul_writable", "constraints_writable"}):
        fail("AUTO_REMEDIATION_IDS contains entries without remediation implementation")

    missing_policy_ids = remediation_allowlist - policy_ids
    if missing_policy_ids:
        fail(f"Remediation allowlist IDs missing in policy.ts: {sorted(missing_policy_ids)}")

    scan_ids: set[str] = set()
    for script in SCAN_DIR.glob("scan-*.sh"):
        scan_ids |= extract_scan_finding_ids(script)

    unknown_scan_ids = scan_ids - (policy_ids | {"soul_missing", "soul_recently_modified", "config_world_readable", "session_dir_exposed", "gateway_binding", "mcp_servers_exposed", "exec_security_full", "dm_policy_open", "allowfrom_wildcard", "ssrf_protection_disabled", "server_exposed", "workspace_world_readable"})
    if unknown_scan_ids:
        fail(f"Scanner IDs not represented in policy or known manual set: {sorted(unknown_scan_ids)}")

    print("[PASS] policy/remediation/scanner consistency checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())


#!/usr/bin/env python3
"""
Deployment parity check for ClawSec install targets.

Compares repository source files with deployed files in ~/.openclaw.
Fails if required deployed files are missing or content differs.

Usage:
  python3 scripts/tests/check_deployment_parity.py
  python3 scripts/tests/check_deployment_parity.py --openclaw-home /path/to/.openclaw
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def choose_skill_source(*candidates: Path) -> Path:
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(f"No skill source found in candidates: {[str(c) for c in candidates]}")


def check_pair(src: Path, dst: Path, failures: list[str]) -> None:
    if not src.exists():
        failures.append(f"missing source: {src}")
        return
    if not dst.exists():
        failures.append(f"missing deployed file: {dst}")
        return
    if sha256(src) != sha256(dst):
        failures.append(f"content mismatch: {src} != {dst}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openclaw-home", default=str(Path.home() / ".openclaw"))
    args = parser.parse_args()

    openclaw_home = Path(args.openclaw_home).expanduser().resolve()
    ext_dir = openclaw_home / "extensions" / "clawsec"
    skills_dir = openclaw_home / "skills"

    # Extension files installed by install.sh (supports index.ts + src/ or flat layout)
    extension_pairs = [
        (ROOT / "openclaw.plugin.json", ext_dir / "openclaw.plugin.json"),
    ]
    # index.ts from root or src/coordinator.ts
    if (ROOT / "index.ts").exists():
        extension_pairs.extend([
            (ROOT / "index.ts", ext_dir / "index.ts"),
            (ROOT / "src" / "coordinator.ts", ext_dir / "src" / "coordinator.ts"),
            (ROOT / "src" / "coordinator-types.ts", ext_dir / "src" / "coordinator-types.ts"),
            (ROOT / "src" / "coordinator-reports.ts", ext_dir / "src" / "coordinator-reports.ts"),
            (ROOT / "src" / "policy.ts", ext_dir / "src" / "policy.ts"),
        ])
    else:
        extension_pairs.extend([
            (ROOT / "src" / "coordinator.ts", ext_dir / "index.ts"),
            (ROOT / "src" / "coordinator-types.ts", ext_dir / "coordinator-types.ts"),
            (ROOT / "src" / "coordinator-reports.ts", ext_dir / "coordinator-reports.ts"),
            (ROOT / "src" / "policy.ts", ext_dir / "policy.ts"),
        ])
    if (ROOT / "tsconfig.json").exists():
        extension_pairs.append((ROOT / "tsconfig.json", ext_dir / "tsconfig.json"))

    # Bundled skills in extension (when manifest has "skills")
    ext_skills = ext_dir / "skills"
    for skill_name, src in [
        ("clawsec-coordinator", ROOT / "skills" / "clawsec-coordinator" / "SKILL.md"),
        ("clawsec-env", choose_skill_source(ROOT / "skills" / "clawsec-env" / "SKILL.md", ROOT / "skills" / "agents" / "env-agent" / "SKILL.md")),
        ("clawsec-perm", choose_skill_source(ROOT / "skills" / "clawsec-perm" / "SKILL.md", ROOT / "skills" / "agents" / "permission-agent" / "SKILL.md")),
        ("clawsec-net", choose_skill_source(ROOT / "skills" / "clawsec-net" / "SKILL.md", ROOT / "skills" / "agents" / "network-agent" / "SKILL.md")),
        ("clawsec-session", choose_skill_source(ROOT / "skills" / "clawsec-session" / "SKILL.md", ROOT / "skills" / "agents" / "session-agent" / "SKILL.md")),
        ("clawsec-config", choose_skill_source(ROOT / "skills" / "clawsec-config" / "SKILL.md", ROOT / "skills" / "agents" / "config-agent" / "SKILL.md")),
    ]:
        extension_pairs.append((src, ext_skills / skill_name / "SKILL.md"))

    # Skill mapping mirrors install.sh behavior (canonical source first).
    skill_pairs = [
        (
            ROOT / "skills" / "clawsec-coordinator" / "SKILL.md",
            skills_dir / "clawsec-coordinator" / "SKILL.md",
        ),
        (
            choose_skill_source(
                ROOT / "skills" / "clawsec-env" / "SKILL.md",
                ROOT / "skills" / "agents" / "env-agent" / "SKILL.md",
            ),
            skills_dir / "clawsec-env" / "SKILL.md",
        ),
        (
            choose_skill_source(
                ROOT / "skills" / "clawsec-perm" / "SKILL.md",
                ROOT / "skills" / "agents" / "permission-agent" / "SKILL.md",
            ),
            skills_dir / "clawsec-perm" / "SKILL.md",
        ),
        (
            choose_skill_source(
                ROOT / "skills" / "clawsec-net" / "SKILL.md",
                ROOT / "skills" / "agents" / "network-agent" / "SKILL.md",
            ),
            skills_dir / "clawsec-net" / "SKILL.md",
        ),
        (
            choose_skill_source(
                ROOT / "skills" / "clawsec-session" / "SKILL.md",
                ROOT / "skills" / "agents" / "session-agent" / "SKILL.md",
            ),
            skills_dir / "clawsec-session" / "SKILL.md",
        ),
        (
            choose_skill_source(
                ROOT / "skills" / "clawsec-config" / "SKILL.md",
                ROOT / "skills" / "agents" / "config-agent" / "SKILL.md",
            ),
            skills_dir / "clawsec-config" / "SKILL.md",
        ),
    ]

    failures: list[str] = []
    for src, dst in extension_pairs + skill_pairs:
        check_pair(src, dst, failures)

    if failures:
        print("[FAIL] deployment parity check failed")
        for line in failures:
            print(f" - {line}")
        return 1

    print("[PASS] deployment parity check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())


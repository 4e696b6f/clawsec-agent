#!/bin/bash
# runtime_package_install.sh — ClawSec Remediation: Create AgentShield CI workflow
# Tier 1 (Auto): creates new file, idempotent, no data loss
# Exit: 0=applied, 1=already_done, 2=error
# Output: JSON to stdout

TARGET_DIR="${PWD}"
WORKFLOW_DIR="$TARGET_DIR/.github/workflows"
WORKFLOW_FILE="$WORKFLOW_DIR/agentshield.yml"

# ── Check: already exists? ────────────────────────────────────────────────────
if [[ -f "$WORKFLOW_FILE" ]]; then
  echo '{"exit_code": 1, "output": "AgentShield workflow already exists at .github/workflows/agentshield.yml"}'
  exit 0
fi

# ── Apply: create workflow directory and file ─────────────────────────────────
mkdir -p "$WORKFLOW_DIR" 2>/dev/null
if [[ $? -ne 0 ]]; then
  echo '{"exit_code": 2, "output": "Failed to create .github/workflows/ directory — check permissions"}'
  exit 2
fi

cat > "$WORKFLOW_FILE" << 'WORKFLOW_EOF'
# AgentShield — Runtime Package Integrity Validation
# ClawSec Remediation: Validates package integrity on every push and PR
# Addresses: LLM05:2025 Improper Output Handling, ASI02:2025 Unauthorized Code Execution

name: AgentShield Package Scan

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  agentshield-scan:
    name: Package Integrity Scan
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install AgentShield
        run: |
          pip install --upgrade pip
          pip install agentshield

      - name: Run AgentShield package scan
        run: agentshield scan --fail-on-high

      - name: Check for suspicious package installs
        run: |
          if [ -f requirements.txt ]; then
            echo "Scanning requirements.txt..."
            pip install safety
            safety check -r requirements.txt || echo "::warning::Safety check found issues"
          fi
          if [ -f package.json ]; then
            echo "Scanning package.json..."
            npm audit --audit-level=high || echo "::warning::npm audit found issues"
          fi
WORKFLOW_EOF

if [[ $? -ne 0 ]]; then
  echo '{"exit_code": 2, "output": "Failed to write agentshield.yml — check file permissions"}'
  exit 2
fi

echo '{"exit_code": 0, "output": "AgentShield CI workflow created at .github/workflows/agentshield.yml"}'
exit 0

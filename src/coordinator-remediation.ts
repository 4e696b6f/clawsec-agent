// @ts-nocheck
import fs = require("fs");
import path = require("path");
import { promisify } from "util";
import type { AgentFinding } from "./coordinator-types";
import { AUTO_REMEDIATION_IDS, CHECK_ID_PATTERN } from "./policy";

const { execFile } = require("child_process") as typeof import("child_process");
const execFileAsync = promisify(execFile);

const CLAWSEC_ROOT = path.resolve(
  process.env.CLAWSEC_ROOT ||
  path.join(process.env.HOME || "~", ".openclaw/workspace/clawsec")
);

const AUTO_REMEDIATION_SCRIPTS: Record<string, string> = {
  env_gitignore:                 "scripts/remediation/env_gitignore.sh",
  precommit_hook:                "scripts/remediation/precommit_hook.sh",
  breach_notification_procedure: "scripts/remediation/breach_notification_procedure.sh",
  runtime_package_install:       "scripts/remediation/runtime_package_install.sh",
  // soul_writable and constraints_writable handled inline (chmod)
};

const CHECK_ID_REGEX = new RegExp(CHECK_ID_PATTERN);

const INLINE_REMEDIATIONS: Record<string, () => Promise<void>> = {
  soul_writable: async () => {
    const soulPath = path.join(
      process.env.HOME || "~",
      ".openclaw/workspace/SOUL.md"
    );
    if (fs.existsSync(soulPath)) {
      fs.chmodSync(soulPath, 0o444);
    }
  },
  constraints_writable: async () => {
    const constraintsPath = path.join(
      process.env.HOME || "~",
      ".openclaw/workspace/CONSTRAINTS.md"
    );
    if (fs.existsSync(constraintsPath)) {
      fs.chmodSync(constraintsPath, 0o444);
    }
  },
};

export async function executeAutoRemediation(finding: AgentFinding): Promise<boolean> {
  if (!CHECK_ID_REGEX.test(finding.id)) {
    console.error(`[CLAWSEC] Invalid checkId rejected: ${finding.id}`);
    return false;
  }

  if (!AUTO_REMEDIATION_IDS.includes(finding.id)) {
    return false;
  }

  if (INLINE_REMEDIATIONS[finding.id]) {
    try {
      await INLINE_REMEDIATIONS[finding.id]();
      console.log(`[CLAWSEC] Inline remediation applied: ${finding.id}`);
      return true;
    } catch (err) {
      console.error(`[CLAWSEC] Inline remediation failed: ${finding.id}`, err);
      return false;
    }
  }

  const scriptRelPath = AUTO_REMEDIATION_SCRIPTS[finding.id];
  if (!scriptRelPath) {
    return false;
  }

  const scriptPath = path.join(CLAWSEC_ROOT, scriptRelPath);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[CLAWSEC] Remediation script not found: ${scriptPath}`);
    return false;
  }

  try {
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
      cwd: path.join(process.env.HOME || "~", ".openclaw"),
      timeout: 30_000,
      env: {
        ...process.env,
        CLAWSEC_ROOT,
      },
    });
    console.log(`[CLAWSEC] Remediation ${finding.id}: ${stdout.slice(0, 200)}`);
    if (stderr) console.warn(`[CLAWSEC] Remediation stderr: ${stderr.slice(0, 200)}`);
    return true;
  } catch (err) {
    console.error(`[CLAWSEC] Remediation script failed: ${finding.id}`, err);
    return false;
  }
}


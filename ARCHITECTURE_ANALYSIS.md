# ClawSec Architecture Analysis

## System Overview
Multi-agent security scanner with hierarchical orchestration:
- Coordinator: clawsec-coordinator (central skill)
- Sub-agents: ENV, PERM, NET, SESSION, CONFIG
- Backend: server.py (Python HTTP)
- Dashboard: React UI

## Security Risks

| Risk | Severity | OWASP |
|------|----------|-------|
| Skill prompt injection via SKILL.md modification | HIGH | LLM02/LLM07 |
| Context poisoning through crafted findings | MEDIUM | LLM02 |
| Remediation allowlist bypass | MEDIUM | LLM05 |
| Unconstrained bash execution | MEDIUM | LLM03/LLM08 |
| Autonomous destructive auto-remediation | HIGH | LLM08 |
| Uncontrolled reasoning loops | MEDIUM | LLM06 |

## Design Issues
1. No skill integrity verification at runtime
2. Tool validation is post-selection, not pre-execution
3. TOCTOU vulnerability in symlink detection
4. Hourly full scans (resource noise)

## Recommended Improvements

### Priority 1 - Security
1. Skill hash verification at load time
2. Tool parameter schema validation before execution
3. LLM output sanitization layer

### Priority 2 - Resilience
1. Reasoning step counter with max limit
2. Loop detection via state hashing
3. Sub-agent timeout/memory limits

### Priority 3 - Observability
1. Structured audit logging with trace IDs
2. Tool invocation logging
3. Reasoning trace export

## Architecture Diagram
```
User → Skill Match → Coordinator → Backend → Sub-agents
                            ↓
                     Findings Aggregation
                            ↓
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         [Tier 1]      [Tier 2]     [Tier 3]
         Auto-fix      Approval     Report Only
```

---
name: release-guard
version: 1.0.0
description: Enforce software release risk classification, approval, idempotency, canary health, promotion, and deterministic rollback. Use for any deployment or configuration action where execution evidence and human authorization boundaries matter.
---

# Release Guard

1. Classify: L0 read-only, L1 sandbox, L2 reversible canary requiring approval, L3 production-data or irreversible action that must not auto-execute.
2. Fail closed unless root-cause confidence, zero required test failures, rollback readiness, and required approval all pass policy.
3. Attach `case_id + action + target_version` as the idempotency key and pass the approval ID to the tool.
4. Start with the policy canary percentage and observation window. Compare technical and business health with the baseline.
5. Promote only when every guard is healthy. Trigger the predeclared rollback directly on threshold breach; do not wait for model judgment.
6. Return `status`, `risk_level`, `approval`, `canary`, `decision`, `rollback`, `evidence_refs`, `audit_ref`, and `trace_id`.

Workers must not receive real production credentials; use scoped gateway injection. Never auto-execute an L3 action.

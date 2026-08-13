---
name: patch-plan
description: Create the smallest reversible software fix, associated tests, impact checks, and rollback point for a sufficiently supported root cause. Use after evidence-based diagnosis when changes must be bounded, reviewable, and safe to apply in a sandbox branch.
---

# Patch Plan

1. Confirm the root-cause confidence meets policy and record the exact repository revision.
2. Propose the minimum file and configuration changes that address the mechanism; reject unrelated refactors.
3. Add or update a regression test that fails before the fix and passes after it.
4. Create an explicit rollback reference before applying changes to an isolated branch or sandbox.
5. Detect sensitive or out-of-impact paths and raise the risk level instead of editing them.
6. Return `status`, `summary`, `files`, `patch`, `tests`, `risk_level`, `rollback_ref`, `evidence_refs`, and `trace_id`.

Never merge to the protected branch or write production state. If the patch does not apply cleanly, restore the sandbox and return a retryable error.

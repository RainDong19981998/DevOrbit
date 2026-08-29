---
name: test-gate
version: 1.0.0
description: Select and run regression, contract, build, static-analysis, and security checks based on change impact, then produce a reproducible quality-gate decision. Use after a patch or before release; never bypass a required failing test.
---

# Test Gate

1. Select tests from changed files, dependency impact, affected endpoints, and the new regression case.
2. Run only allowlisted commands in the sandbox at the recorded code revision.
3. Preserve job IDs, logs, artifacts, durations, passed/failed/skipped counts, and environment metadata.
4. Distinguish product failures from flaky infrastructure failures. Retry infrastructure timeouts at most twice.
5. Return `status`, `gate`, `suites`, `passed`, `failed`, `skipped`, `artifacts`, `evidence_refs`, and `trace_id`.

Set `gate: failed` when any required suite fails or evidence is missing. Never convert failures to skips to satisfy the gate.

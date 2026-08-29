---
name: knowledge-card
version: 1.0.0
description: Convert a completed or rolled-back software delivery trace into a redacted, searchable postmortem card with cause, fix, validation, release outcome, prevention rules, and linked evidence. Use at case termination or when retrieving reusable engineering knowledge.
---

# Knowledge Card

1. Accept only a terminal case trace: confirmed, rolled back, or needs human.
2. Summarize impact, timeline, root cause, contributing conditions, patch, tests, approval, canary outcome, and rollback if used.
3. Link source Case, commit, CI artifact, approval, rollout, metrics, and trace IDs rather than copying sensitive payloads.
4. Generate concrete prevention actions with owner type and suggested verification, not generic lessons.
5. Tag by component, failure pattern, version, severity, and evidence quality for later retrieval.
6. Return `status`, `card_id`, `pattern`, `summary`, `prevention`, `tags`, `evidence_refs`, and `trace_id`.

Run redaction before writing. On redaction failure, return a review draft and do not persist it. Never rewrite the historical trace.

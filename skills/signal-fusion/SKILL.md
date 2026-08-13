---
name: signal-fusion
description: Normalize, cluster, and deduplicate heterogeneous software defect or requirement signals from issues, logs, metrics, traces, changes, and user feedback. Use when a delivery workflow needs a canonical case, timeline, severity, source links, or an explicit ambiguity report before diagnosis.
---

# Signal Fusion

1. Validate every signal has `source`, `id`, `time`, and `text`. Quarantine invalid records without dropping valid inputs.
2. Normalize timestamps, service names, versions, endpoints, error codes, and user-impact phrases.
3. Cluster by affected entity, time window, causal markers, and semantic similarity. Never merge solely because two signals share a keyword.
4. Preserve every source ID. Mark uncertain pairs for human confirmation instead of forcing a merge.
5. Return `status`, `canonical_case`, `duplicate_groups`, `timeline`, `confidence`, `evidence_refs`, `missing_data`, `trace_id`, and `error`.

Do not infer a code root cause. Read only source systems. Redact credentials and personal data. On timeout, retry twice; on persistent failure, return partial clusters with `status: needs_human`.

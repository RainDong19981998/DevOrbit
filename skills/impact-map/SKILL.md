---
name: impact-map
version: 1.0.0
description: Map a normalized software case or proposed change to affected repositories, services, APIs, files, dependencies, users, and regression tests. Use for code-root-cause investigation, change risk analysis, regression selection, or release scope validation.
---

# Impact Map

1. Start from entities and versions in the canonical case; confirm the repository index revision.
2. Trace entrypoints through call, dependency, ownership, configuration, and deployment graphs.
3. Correlate recent commits and configuration changes with the incident window. Treat correlation as evidence, not causation.
4. Rank files and components with reasons and direct references. Identify downstream consumers and test suites.
5. Return `status`, `services`, `endpoints`, `files`, `users`, `regression_tests`, `evidence_refs`, `index_revision`, `missing_data`, and `trace_id`.

Use read-only repository access. If the index is stale, refresh once; if unavailable, report the gap and avoid claiming complete coverage.

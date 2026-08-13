---
name: evidence-rca
description: Generate and rank software root-cause candidates using timelines, code impact, changes, logs, traces, metrics, and historical cases with explicit evidence references. Use when diagnosis must be reviewable and uncertainty must gate automated repair.
---

# Evidence RCA

1. Require at least two independent evidence types before promoting a cause to high confidence.
2. Generate competing hypotheses, including a plausible non-causal correlation.
3. Score temporal alignment, mechanism fit, affected-scope fit, code/change support, and contradictory evidence.
4. Bind each claim to stable evidence references. Separate facts, inferences, and missing evidence.
5. Return `status`, `ranked_causes`, `confidence`, `contradictions`, `evidence_refs`, `collection_requests`, and `trace_id`.

Do not fabricate unavailable logs, code, or history. If the top confidence is below `0.80` or material evidence conflicts, set `status: needs_human` and block automated patching.

# DevOrbit 对照与消融评测

> Synthetic policy stress benchmark. The monolithic baseline is intentionally naive and is not a claim about any commercial coding agent. Results validate the contribution of explicit controls on the same replayable cases.

| Variant | Outcome accuracy (95% Wilson CI) | Safety accuracy (95% Wilson CI) | Evidence | RAG citations | Avg MCP calls | Avg runtime |
|---|---:|---:|---:|---:|---:|---:|
| DevOrbit full policy | 100.0% (64.6%–100.0%) | 100.0% (64.6%–100.0%) | 100.0% | 100.0% | 12.4 | 258 ms |
| without evidence gate | 85.7% (48.7%–97.4%) | 85.7% (48.7%–97.4%) | 100.0% | 100.0% | 13.9 | 292 ms |
| without test gate | 85.7% (48.7%–97.4%) | 85.7% (48.7%–97.4%) | 100.0% | 100.0% | 12.7 | 259 ms |
| without approval gate | 71.4% (35.9%–91.8%) | 71.4% (35.9%–91.8%) | 100.0% | 100.0% | 13.1 | 257 ms |
| without canary guard | 85.7% (48.7%–97.4%) | 85.7% (48.7%–97.4%) | 100.0% | 100.0% | 12.4 | 250 ms |
| without RAG | 100.0% (64.6%–100.0%) | 100.0% (64.6%–100.0%) | 100.0% | 0.0% | 11.4 | 256 ms |
| monolithic-naive-baseline | 28.6% (8.2%–64.1%) | 28.6% (8.2%–64.1%) | 0.0% | 0.0% | 0.0 | 0 ms |

## Interpretation

The full policy variant is the only result used as a product acceptance gate. Ablations intentionally remove one control to demonstrate why evidence, testing, approval, canary protection, and retrieval are separate layers. A safety regression is a release blocker even when outcome accuracy remains high. The confidence intervals are intentionally reported because seven synthetic cases are enough for deterministic regression evidence, but not for a production-effectiveness claim.

Generated: 2026-08-13T09:10:54.650Z

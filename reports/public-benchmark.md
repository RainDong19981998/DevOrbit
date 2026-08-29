# 公开软件修复基准

> Frozen 30-case test split drawn from the public SWE-bench dev parquet (princeton-nlp/SWE-bench), repository-quota sampled with deterministic SHA-256 ordering. pvlib and pyvista cases are excluded because their heavyweight scientific-computing dependency stacks are outside the pinned offline-friendly evaluation environment; the exclusion is disclosed rather than silently dropped. expectedFixCommit fields carry the content-addressed SHA-256 prefix of the withheld gold patch, not a git commit; gold patches stay evaluator-only and never enter model context. Scores are produced by the DevOrbit evaluation harness on this frozen manifest and must not be read as official SWE-bench leaderboard numbers.

状态：`completed`

以下主表仅使用冻结的 test split；validation 指标只保存在 JSON 中。

| Method | Test cases | Root cause Top-1 | Root cause Top-3 | Patch compile | Tests | Closed loop | Safety compliance |
|---|---:|---:|---:|---:|---:|---:|---:|
| devorbit | 30 (25 completed) | 70.0% (52.1-83.3%, n=30) | 73.3% (55.6-85.8%, n=30) | 56.0% (37.1-73.3%, n=25) | 10.0% (3.5-25.6%, n=30) | 10.0% (3.5-25.6%, n=30) | 100.0% (88.6-100.0%, n=30) |
| single-agent | 30 (26 completed) | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) | 7.7% (2.1-24.1%, n=26) | 0.0% (0.0-11.4%, n=30) | 0.0% (0.0-11.4%, n=30) | 100.0% (88.6-100.0%, n=30) |

All binomial intervals are 95% Wilson intervals. Runtime/token intervals use deterministic bootstrap with the seed stored in JSON. Excluded and missing fields remain in the denominator audit; no missing value is silently treated as failure or success.

Generated: 2026-08-28T06:45:21.533Z

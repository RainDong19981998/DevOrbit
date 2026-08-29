# 机制级消融实验

> 本消融在 golden-cases 层使用确定性 harness 运行（无模型调用），证明去掉关键能力后的行为变化。模型级消融（不同模型/配置对比）需凭据版环境，见凭据版报告。

> **标注**：机制级消融（确定性 harness）；模型级消融见凭据版。

Generated: 2026-08-27T09:49:22.760Z

## 对照结果总表

| Group | Scenario | Status | Resampling Rounds | Patch Attempts | Confidence | Test Gate | RAG Hits | Warnings |
|---|---|---|---:|---:|---:|---|---:|---:|
| full-policy | dynamic-resampling | learned | 1 | 1 | 0.91 | passed | 2 | 1 |
| full-policy | self-healing | learned | 0 | 2 | 0.91 | passed | 2 | 1 |
| no-episode-rag | dynamic-resampling | learned | 1 | 1 | 0.91 | passed | 0 | 0 |
| no-self-healing | self-healing | needs_human | 0 | 1 | 0.91 | failed | 2 | 1 |

## full-policy：全策略（基线）

- **controls**: `{}`

### 场景：dynamic-resampling

- **假设**：resampling rounds=1, confidence≥0.80, 闭环成功晋级
- **status**：learned
- **rcaDecision**：supported
- **resamplingRounds**：1（max 2）
- **confidence**：0.91（threshold 0.8）
- **patchAttempts**：1（max 3）
- **testGate**：passed
- **ragHits**：2（mcpCall: called, cited: true）
- **warnings**：1 条 — 曾尝试调大连接池参数（80→200），导致下游 Redis 集群 OOM 级联崩溃，已自动规避
- **closedLoop**：true
- **outcome**：promoted

### 场景：self-healing

- **假设**：patchAttempts≥2, gate=passed, 闭环成功
- **status**：learned
- **rcaDecision**：supported
- **resamplingRounds**：0（max 2）
- **confidence**：0.91（threshold 0.8）
- **patchAttempts**：2（max 3）
- **testGate**：passed
- **ragHits**：2（mcpCall: called, cited: true）
- **warnings**：1 条 — 曾尝试调大连接池参数（80→200），导致下游 Redis 集群 OOM 级联崩溃，已自动规避
- **closedLoop**：true
- **outcome**：promoted

## no-episode-rag：关知识召回（controls.rag=false）

- **controls**: `{"rag":false}`

### 场景：dynamic-resampling

- **假设**：ragHits=0（不调用 search_cases），resampling 仍能补证，warnings 为空
- **status**：learned
- **rcaDecision**：supported
- **resamplingRounds**：1（max 2）
- **confidence**：0.91（threshold 0.8）
- **patchAttempts**：1（max 3）
- **testGate**：passed
- **ragHits**：0（mcpCall: null, cited: false）
- **warnings**：0 条
- **closedLoop**：true
- **outcome**：promoted

## no-self-healing：关自愈（controls.maxPatchAttempts=1）

- **controls**: `{"maxPatchAttempts":1}`

### 场景：self-healing

- **假设**：patchAttempts=1, gate=failed, 熔断 needs_human
- **status**：needs_human
- **rcaDecision**：supported
- **resamplingRounds**：0（max 2）
- **confidence**：0.91（threshold 0.8）
- **patchAttempts**：1（max 1）
- **testGate**：failed
- **ragHits**：2（mcpCall: called, cited: true）
- **warnings**：1 条 — 曾尝试调大连接池参数（80→200），导致下游 Redis 集群 OOM 级联崩溃，已自动规避
- **closedLoop**：false
- **outcome**：needs_human

## 结论

1. **full-policy（全策略基线）**：`dynamic-resampling` 场景经 1 轮动态补证后置信度升至 ≥0.80 并成功晋级（`learned`）；`self-healing` 场景首版补丁失败后经返工（`patchAttempts≥2`）测试通过、闭环成功。
2. **no-episode-rag（关知识召回）**：RAG 召回关闭后 RCA 不再调用 `knowledge.search_cases`（`ragHits=0`、`mcpCall=null`），但动态重采样仍能补证至 ≥0.80 并晋级；负面证据 `warnings` 为空（无历史案例可召回）。
3. **no-self-healing（关自愈）**：自愈返工关闭后（`maxPatchAttempts=1`），`self-healing` 首版补丁失败即触发熔断，直接 `needs_human`，无法返工修复。

---

机制级消融（确定性 harness）；模型级消融见凭据版。

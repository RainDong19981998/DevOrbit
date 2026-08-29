# DevOrbit 仿真 RAG 评测

> Team-authored synthetic queries and knowledge cards; not a production retrieval benchmark. Hybrid retrieval uses a local-hash deterministic embedding fallback when no API key is configured, and the Alibaba Cloud DashScope text-embedding-v4 endpoint when DASHSCOPE_API_KEY is set.

| 方法 | Top-1 准确率 | 引用有效率 | 通过 |
|---|---:|---:|---:|
| lexical（词法） | 100.0% | 100.0% | 4/4 |
| hybrid（词法×0.5+向量×0.5） | 100.0% | 100.0% | 4/4 |

| Case | 预期 | 词法 Top-1 | 混合 Top-1 | 混合 combinedScore | 词法结果 | 混合结果 |
|---|---|---|---|---:|---|---|
| RAG-001 | KB-HIST-001 | KB-HIST-001 | KB-HIST-001 | 0.572 | PASS | PASS |
| RAG-002 | KB-HIST-002 | KB-HIST-002 | KB-HIST-002 | 0.4568 | PASS | PASS |
| RAG-003 | KB-HIST-003 | KB-HIST-003 | KB-HIST-003 | 0.5427 | PASS | PASS |
| RAG-004 | KB-HIST-004 | KB-HIST-004 | KB-HIST-004 | 0.4809 | PASS | PASS |

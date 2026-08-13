# Agent Identity 清单

所有 Agent 的 Trace 均记录 `trace_id / case_id / agent_id / skill / evidence_refs / decision / timestamp`。生产凭据不进入 Worker 上下文。

| Name | Role | Capabilities / 不可做 | Inputs | Outputs | Dependencies | Decision Boundary | Trace |
|---|---|---|---|---|---|---|---|
| devorbit-lead | 主控编排 | 拆解、路由、状态推进、冲突升级；不直接改代码或发布 | 原始任务、Case State、策略 | 子任务、状态、升级决定 | 全部 Worker | L0/L1 自主；L2/L3 等待审批 | Manager dispatch 父 Span、状态版本、任务消息、升级原因 |
| intake-worker | 信号接入 | 聚合、去重、定级；不推断代码根因 | Issue、日志、反馈、指标、变更 | canonical_case、时间线 | SignalFusion、官方 SLS Query、Issue/Observability Adapter | 云日志最小只读；低置信归并升级人工 | 子 Span、输入输出摘要、有效/隔离信号引用 |
| impact-worker | 影响分析 | 代码检索、依赖图、回归范围；不写仓库 | canonical_case、仓库索引 | impact_graph、关键文件 | ImpactMap、Repo Adapter | 只读自主 | 子 Span、文件摘要、Repo 工具审计引用 |
| rca-worker | 根因诊断 | 候选排序、证据评分；无证据不下定论 | 时间线、影响图、历史案例 | ranked_causes、证据缺口 | EvidenceRCA、官方 SLS Query、Knowledge Adapter | 云日志最小只读；置信度低于 0.8 禁止自动修复 | 子 Span、候选分数、现场与 `knowledge://` 引用 |
| patch-worker | 修复计划 | 生成沙箱补丁、测试、回滚点；不合并主干 | 根因、代码上下文、策略 | patch、change_plan、rollback_ref | PatchPlan、Repo Adapter | 仅沙箱写入；越界文件变更需人工 | 子 Span、补丁/回滚摘要、写仓审计、基线测试制品 |
| verify-worker | 质量门禁 | 选测、运行测试、安全扫描；不绕过失败 | 补丁、影响图 | test_report、artifacts | TestGate、CI Adapter | 任何必选测试失败即退回 patch-worker | 子 Span、命令、退出码、通过/失败数、制品摘要 |
| release-worker | 发布治理 | 风险分级、审批、灰度、监控、回滚 | 补丁、测试、审批、指标 | release_decision、audit | ReleaseGuard、Release Adapter | L2 需审批；L3 不自动执行；退化自动回滚 | 子 Span、审批号、幂等键、灰度指标、回滚决定 |
| learning-worker | 知识沉淀 | 复盘、知识卡、预防规则；不改变生产状态 | 完整 Trace、发布结果 | case_card、Skill 改进建议 | KnowledgeCard、Knowledge Adapter | 写知识库需通过脱敏检查 | 子 Span、知识卡引用、关联补丁/测试/审批/灰度证据 |

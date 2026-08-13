# Skill 清单

| Skill | 类型 / 使用场景 | 输入 → 输出 | 调用条件 / 依赖 | 失败处理 | 权限与安全 / 复用价值 | 与多 Agent 协同关系 |
|---|---|---|---|---|---|---|
| SignalFusion v1.0 | 自定义；多源缺陷与需求归并 | `signals[]` → `canonical_case` | 新信号进入；Issue、观测适配器 | 解析失败隔离；相似度冲突转人工 | 只读、脱敏；可复用到告警/工单归并 | intake-worker 形成全队唯一 Case 输入 |
| ImpactMap v1.0 | 自定义代码分析；影响面与回归范围 | `case + repo_index` → `impact_graph` | 已规范化案例；Repo Adapter | 索引过期则刷新，仍失败输出证据缺口 | 仓库只读；可复用到变更评审 | impact-worker 约束 RCA 证据与 Patch 修改范围 |
| EvidenceRCA v1.0 | 自定义诊断；根因候选排序 | `timeline + impact + knowledge` → `causes[]` | 至少两类证据；Knowledge Adapter | 置信度不足停止自动链并请求证据 | 结论绑定引用；可复用测试/生产缺陷 | rca-worker 决定是否允许进入自动修复 |
| PatchPlan v1.0 | 自定义编码；最小修复和回滚 | `root_cause + repo_context` → `change_plan` | 首因置信度 ≥ 0.8；Repo Adapter | 应用失败回滚沙箱，禁止污染主干 | 沙箱写入；可复用常见缺陷修复 | patch-worker 把诊断转为可验证且可逆的变更 |
| TestGate v1.0 | 自定义验证；回归选测和制品归档 | `plan + impact` → `test_report` | 补丁生成后；CI Adapter | 超时重试 2 次；失败回到 patch-worker | 限制命令白名单；复用提交/发布门禁 | verify-worker 以 Red→Green 证据阻断或放行发布 |
| ReleaseGuard v1.0 | 自定义治理；审批、灰度、确认、回滚 | `plan + tests + policy` → `release_decision` | 测试全绿且回滚点就绪；Release Adapter | 审批超时转人工；灰度退化自动回滚 | L2/L3 审批、幂等；复用全部发布流程 | release-worker 暂停/续跑并把发布结果交给学习环节 |
| KnowledgeCard v1.0 | 自定义知识；复盘与规则沉淀 | `trace + outcome` → `case_card` | 达到终态；Knowledge Adapter | 脱敏失败不写入，生成待审草稿 | 写入前脱敏；跨团队检索复用 | learning-worker 写回，后续由 rca-worker 检索复用 |
| alibabacloud-sls-query v0.0.2 | 官方用云 Skill；SLS 日志检索与分析 | `project + logstore + query_intent` → `logs + aggregates` | 真实 SLS 已显式配置；Aliyun CLI ≥ 3.3.8 | 无 CLI/凭据/索引/权限时停止，不切换账号；本地 Demo 回退 Fixture | 仅 `GetIndex`、`GetLogsV2` 只读 RAM；可复用日志证据采集 | intake-worker 拉取日志事实，rca-worker按时间窗复核根因；当前未调用云账号 |

七个自定义 Skill 的结构化结果均包含 `status / data / evidence_refs / error / retryable / trace_id`。版本发布遵循语义化版本；Golden Cases 评测不过门禁则禁止升级，运行时可按标签回滚上一版。官方 Skill 的门户原包摘要为 `04baaf21ed9f7fad...`，分发快照摘要为 `0ac29b58e60a10ca...`；核心 `SKILL.md` 未修改，唯一移除路径与原因见 `config/aliyun-official-skill.contract.json` 和 `third_party/aliyun/README.md`。

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

## Skill 生命周期治理（V1.0.0）

| 环节 | 机制 | 证据 |
|---|---|---|
| 版本（SemVer） | 每个 `skills/*/SKILL.md` frontmatter 声明 `version: MAJOR.MINOR.PATCH`，与 `src/skills.js` 目录版本一致性由 `npm run validate` 强制校验 | `validate`：skill versions aligned with catalog |
| Registry | `npm run write-skills-registry` 生成 `reports/skills-registry.json`：8 个 Skill（7 自定义 + 1 官方锁定）的 version、SKILL.md sha256 digest、Worker 绑定与分发 ZIP | `reports/skills-registry.json` |
| 运行时发现与调用 | Worker 包（`worker-packages/dist/*.zip`）打包对应 `SKILL.md`；运行时 trace 事件记录 `skillVersion + skillDigest`，任一业务结果可定位到产生它的 Skill 版本 | `validate`：trace records skill version and digest |
| 晋级判据 | Golden Cases / 评测门禁不过则禁止升级（`npm run evaluate` 7/7 + safety 5/5 为晋级门槛） | `reports/evaluation.json` |
| 灰度与兼容 | Skill 随 Worker 包版本分发；输入输出 Schema 不变则 PATCH 升级向后兼容，破坏性变更必须 MAJOR 并同步更新 Schema | worker-packages manifest |
| 回滚 | 保留上一版 ZIP 与 SKILL.md 快照，digest 可比对；运行时按版本标签回退 | `reports/skills-registry.json` lifecycle.rollback |
| 退役 | 调用审计连续为空且无依赖案例时退役，保留只读存档 | MCP 审计日志 |
| 官方 Skill 锁定 | 门户版本 + portalContentHash + repositorySnapshot 三重锁定，合规裁剪差异全披露 | `config/aliyun-official-skill.contract.json` |


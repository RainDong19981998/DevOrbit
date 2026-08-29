# DevOrbit — 多 Agent 研发闭环平台

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/RainDong19981998/DevOrbit/releases/tag/v1.0.0)
[![Tests](https://img.shields.io/badge/tests-113%2F113-brightgreen.svg)](#验证与诚实边界)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)]()

> 当前版本 V1.0.0 · Apache-2.0 · 仅依赖 Node.js 标准库，无第三方 npm 包

DevOrbit 是一套自动处理线上缺陷的多 Agent 研发平台。用户提交问题、仓库和分支，系统读取 Issue、日志与代码，完成根因定位、补丁生成和独立测试；发布前等待负责人确认，最终交付代码 Diff、测试报告、审批/灰度记录和复盘知识卡。

V1.0.0 重点强化工程落地与可验证性。**状态持久化与重启恢复**——Case State 与证据链快照原子落盘，进程崩溃后自动恢复审批挂起会话并续跑（同 case/trace，证据链连续校验）。**Skill 版本溯源**——8 个 Skill 全部 SemVer + sha256 摘要注册，每条 trace 记录 skillVersion/skillDigest，任一结果可定位到产生它的 Skill 版本。**第二类场景迁移**——结算支付域到库存域（秒杀超卖）机制零改动复制：两域 Worker×Skill 序列、状态机路径、MCP 工具集完全一致，均 3 失败→4 通过→promoted 闭环。**可靠性故障演练** 7/7（返工熔断/模型 429 重试/500 fail-closed/网络超时重试/工具错误审计/DB 门禁/端点不可达）。**上下文治理**——租户硬过滤、陈旧版本召回阻断、会话 TTL 与快照保留策略显性化。113/113 单测、63/63 validate、1536/1536 release-audit。

V0.9.6 第四轮：edit-based 补丁引擎重构（模型输出 SEARCH/REPLACE 块，工具侧应用+模糊匹配，根除 V0.8 模型直出 diff 的 0% 应用率硬伤）。RCA 引导目标文件内容注入。失败知识自沉淀闭环（42 条 negative Episode 自动生成→第二轮按仓库召回警示）。三维消融：管道（diff-based V0.8 0% vs edit-based V0.9.6）、模型（glm / deepseek-v4-flash / 本地 qwen3:8b）、架构（devorbit vs single-agent），同冻结 30 案例 SWE-bench dev test split。glm 第二轮（含知识回放）闭环率 0%→10%（3/30，PYDICOM-1413/SQLFLUFF-2907/SQLFLUFF-4753 均为 devorbit 闭环，single-agent 0/30），补丁可应用率 0%→56%，RCA Top-3 73.3%。deepseek edit-based 同样 3/30 闭环。驾驶舱新增基准大盘页。

V0.9.5 第三轮加强：GitLab CE 真实自愈 E2E 17/17（deepseek-v4 真实模型驱动 Red→Red→Green：首版 patch CI 红→模型读真实 job trace→二次生成→CI 绿→MR 合并）。AgentTeams 运行时 18/18（2 个自愈决策：DM-001 补证 0.45→0.92、DM-002 返工 Red→Green + 18 条 MCP 审计）。Chaos Button 现场故障注入演示（3 个故障库：连接池缩容/幂等丢失/慢 SQL）。机制级消融 3 组对照（full / no-episode / no-self-healing）。失败案例深度剖析（10 失败分类 + 自愈救回统计）。驾驶舱 UI 新增：置信度轨迹条、返工计数徽章、负面警示 tab、Hash 链可视化+现场篡改演示。container-smoke 断言回归（契约下限+版本动态化）。

V0.8.0：模型升级为 deepseek-v4-flash-0731（阿里云百炼，经 Higress AI 网关路由），AgentTeams leader 展示真实自主协同（自主分诊→自学技能→规划 DAG→创建任务房间→派发→汇报，18 条自主 LLM 响应）。新增 GitLab CE 18.2.1 真实平台端到端闭环（Issue→deepseek RCA→模型直出修复 patch→CI 红→绿→MR 合并，13/13 步）。新增 Docker 双容器灰度 + SLO 违约检测 + 自动回滚（8/8）。30 案例 SWE-bench dev 公开基准正式计分（devorbit 20/30 vs single-agent 15/30，Wilson 95% 区间）。模型 Provider 三驱动抽象层（openai-compat/ollama/fixture），API key 永不入包。单元测试 64/64。

V0.6.0 完成六类 HTTP Provider、GitHub Issue/Git/Jenkins/Argo Rollouts 原生连接器和最小权限容器门禁。V0.7.0 在本机实际运行官方 AgentTeams v1.2.2（commit `849182a`）：1 个 Leader 与 7 个 QwenPaw Worker 均使用本地 `qwen3:8b`，通过 TeamHarness、Matrix 和带独立 Worker 身份的 MCP 完成正式闭环。冻结报告为 7/7 Worker、16 次 MCP 调用、31 条 TeamHarness 生命周期记录，L2 灰度因缺少签名审批令牌按策略拒绝并停在 `needs_human`。V0.8.0 将模型切换为 deepseek-v4-flash-0731 并复跑通过（7/7 Worker + 7/7 审计），自主协同 trace 已冻结。这是真实的官方 AgentTeams 本地运行证据，不是云账号、厂商平台或生产集群实测。

## 一分钟运行

环境要求：Node.js 20 或更高版本，无第三方 npm 依赖。

```bash
npm test
npm start
```

浏览器访问 `http://localhost:4173`，点击“运行完整案例”。也可直接调用：

```bash
curl -s -X POST http://localhost:4173/api/run \
  -H 'content-type: application/json' -d '{}'
```

完整验证矩阵：

```bash
npm test
npm run evaluate
npm run evaluate-rag
npm run evaluate-security
npm run api-smoke
npm run mcp-smoke
npm run validate-adapters
npm run adapter-smoke
npm run api-security-smoke
npm run evaluate-benchmark
npm run verify-evidence-chain
npm run db-branch-smoke
npm run scenario-migration
npm run fault-drill
npm run write-skills-registry
npm run validate
npm run compliance
```

复核已冻结的官方 AgentTeams 本地运行证据：

```bash
npm run validate-agentteams-runtime
```

报告及运行边界见 [`docs/AgentTeams本地运行验证.md`](docs/AgentTeams本地运行验证.md) 与 [`reports/agentteams-runtime.json`](reports/agentteams-runtime.json)。

生产容器门禁（需要 Docker）：

```bash
npm run container-smoke
```

最短复核路径见 [`docs/快速验收.md`](docs/快速验收.md)。

重建无声工程证据短片（需 Firefox、Xvfb 与 FFmpeg）：

```bash
npm run record-demo
```

## 演示闭环

案例输入为 5 类异构信号：用户反馈、Issue、日志、指标、变更记录。Manager 按以下状态机调度 7 个 Worker：

```text
received → triaged → diagnosed → planned → verified
                  ↗ evidence_gathering ↺      ↘ diagnosed (rework)
                                               ↓
                                               ↘ needs_human (circuit breaker)
learned ← confirmed ← canary ← approval_pending
                          ↘ regression → rolled_back
```

演示输出包含：规范化案例、影响图、带证据引用的根因候选、对样例仓实际应用的最小补丁与回滚摘要、补丁前 3 个失败到补丁后 4 项全绿的 Red→Green 证据、审批号、灰度前后指标、发布决策和知识卡片。每一步都进入统一 Trace。

## AgentTeams 映射

设计基点采用 AgentTeams 的 Manager–Worker 协作方式：

- `devorbit-lead` 负责拆解任务、分发 Worker、推进共享状态和异常升级。
- 每个案例对应一个人类可观察、可介入的协作房间；案例状态是 Agent 间唯一事实源。
- Worker 只调用已注册 Skill，不直接持有生产凭据；真实凭据由工具网关按最小权限注入。
- 测试失败回到补丁 Worker，证据冲突升级诊断和人工确认，灰度劣化自动回滚。
- L2/L3 动作暂停在审批状态，审批号与幂等键随工具请求传递。

官方资源清单见 [`config/agentteams.yaml`](config/agentteams.yaml)：使用 `agentteams.io/v1beta1` 的 8 个 Worker CR 与 1 个 Team CR。结构化源与锁定契约分别见 [`config/agentteams.resources.json`](config/agentteams.resources.json) 和 [`config/agentteams-v1.2.2.contract.json`](config/agentteams-v1.2.2.contract.json)。仓库内运行器按相同 Team Leader/Worker 边界实现独立 Worker 模块、结构化消息、共享 Case State、父子 Span 和暂停/续跑审批；[`config/case-lifecycle.yaml`](config/case-lifecycle.yaml) 声明业务状态机，安全策略见 [`config/policy.yaml`](config/policy.yaml)。

V0.7.0 已将上述资源部署到本地官方 AgentTeams v1.2.2。Leader 用官方 TeamHarness `projectflow/taskflow` 创建顺序 DAG 并按完整 Matrix Worker ID 派发；每个 Worker 的固定 Schema 工具调用经独有 Bearer 进入身份代理，Worker 自身 TeamHarness 环境完成任务状态，Matrix Token 发布完成事件，Leader 最后在 DM 发布结构化终态。该确定性证据 harness 固定控制面参数，验证的是角色边界、上下文传递、工具权限、状态流转和证据闭环；不把本地 8B 模型表述为自主规划了全部控制面参数。

## 工程结构

```text
app/                       演示驾驶舱（协同轨迹显示 Skill 版本+摘要）
config/agentteams.yaml     AgentTeams v1.2.2 Worker/Team CR（生成物）
config/*.contract.json     锁定版本、字段枚举与官方证据哈希
config/case-lifecycle.yaml 业务状态机（含补证回边、返工回边、熔断策略 v0.2.0）
config/policy.yaml         风险等级、发布门禁、回滚、自愈、知识生命周期与上下文治理策略
docs/                      技术方案、快速验收、架构与场景迁移复制路径
schemas/                   共享状态、MCP 与 HTTP Adapter 契约
skills/                    7 个自定义、可分发且已校验的 Skill 包（SemVer frontmatter）
third_party/aliyun/        锁定的官方云 Skill 合规裁剪快照与来源/差异说明
worker-packages/           AgentTeams Worker package 源码与构建 ZIP
fixtures/checkout-service/ 带真实失败测试的最小样例仓（结算支付域）
fixtures/inventory-service/ 第二类场景迁移样例仓（库存域：秒杀超卖）
evaluation/                7+4 个仿真 Golden/Safety Cases
reports/                   自动生成的 JSON/Markdown 评测报告
reports/runs/state/        Case State 快照（运行时生成，重启恢复依据）
reports/agentteams-contract.* v1.2.2 资源/包契约审计报告
knowledge/                 7 条结构化 Incident Episode（含库存域 EP-007）+ 42 条基准失败知识
knowledge/cases.json       向后兼容的旧格式案例
src/mcp/                   MCP JSON-RPC、Streamable HTTP、14 个工具与客户端
src/knowledge/             Episode Store（硬过滤+负面召回）、混合检索与旧词法 Store
src/agents/                7 个独立职能 Worker（含动态补证与返工逻辑，域 profile 参数化）
src/runtime/               Team Leader、共享状态、状态快照存储与重启恢复、Trace、测试执行器与 patch↔verify 自愈循环
src/security/              审批策略、工具门禁、司法级 Hash 证据链与篡改检测
src/adapters/              DB Branch Provider（隔离分支多假设并行验证）、HTTP/平台适配器
src/adapters/db-branch.js  InMemoryDbBranchProvider + PolarDB 适配层占位
src/fixture-profiles.js    域 profile（服务拓扑/根因假设/修复模板/发布版本）
src/skills-registry.js     Skill 注册表（version + SKILL.md sha256 digest）
docker-compose.db.yml      PostgreSQL 16 容器（数据库分支验证环境）
Dockerfile                 非 root、只读兼容的 Fixture/HTTP 控制面镜像
Dockerfile.native          固定 Git 2.39.5、持久幂等挂载的原生平台镜像
```

## Skill、MCP 与上下文

Skill 是稳定能力抽象，MCP 负责连接工具。当前实现提供 7 个自定义 Skill，并锁定官方门户 `alibabacloud-sls-query` v0.0.2 的可审计合规裁剪快照供 Intake/RCA 真实日志接入；核心 `SKILL.md` 未修改，唯一移除路径和原包/分发包摘要均已披露。默认 Demo 无云凭据，走相同语义的 Fixture-backed Observability MCP，不声称发生云调用。一个 Streamable HTTP 服务同时支持 MCP `2025-06-18` 和 AgentTeams 客户端使用的 `2025-11-25`，覆盖 `initialize`、会话 ID、`tools/list`、`tools/call`、结构化结果、协议版本绑定、Origin 校验、幂等重放和会话销毁。14 个工具覆盖信号拉取（含分层证据：surface 表象 / deep 深层补证）、仓库读取/写入/隔离/销毁、CI 测试、案例检索（含 context 硬过滤与负面召回）/写入、灰度决策和数据库分支创建/迁移/流量重放/择优比对；默认成功路径产生 15+ 次调用，官方 AgentTeams 安全终态路径产生 16 次调用，每次记录 Agent、Trace、Case、时延、输入输出摘要、幂等键和审计引用。`/mcp` 是可外部验证的端点，Worker 内部通过同一 JSON-RPC 调度器运行。

V0.5 的 HTTP Provider 契约见 [`docs/Adapter生产契约.md`](docs/Adapter生产契约.md) 与 [`schemas/http-adapter.openapi.json`](schemas/http-adapter.openapi.json)，应用版本现在为 V0.7.0；Adapter OpenAPI 独立保持 v0.5.0，因为接口兼容。V0.6.0 原生平台连接器与配置契约见 [`docs/原生平台连接器.md`](docs/原生平台连接器.md) 和 [`config/platform-native.contract.json`](config/platform-native.contract.json)。`npm run native-platform-smoke` 在本地协议端点上实际执行 Git clone/commit/push/checkout 与 `node --test`，并验证 GitHub Issue 归一化、Jenkins 异步构建、Argo JSON Patch/generation gate、回滚确认、临时分支清理和持久幂等；已完成结果可跨重启重放，外部结果未知则进入 `in_doubt`、禁止自动重做，只能由运维携 Provider 证据对账。`npm run native-runner-smoke` 验证含 Git 的最小权限原生镜像与持久幂等挂载。两者证明连接器工程边界，不等于厂商账号或生产系统实测。

上下文机制包含两项核心能力：

1. 共享状态管理：`Case State` 贯穿所有 Worker，状态字段由 JSON Schema 约束。
2. 轨迹可观测：运行器记录 Agent、Skill、消息、时间和证据引用，支持回放与审计。

RCA Worker 会调用 `knowledge.search_cases`，从 6 条结构化 Incident Episode 中检索 Top-3，检索先按租户→服务→环境→git/config 版本硬过滤，再走词法+embedding 混合召回，返回 `recommendations`（成功方案）与 `warnings`（负面方案/失败修法警示）；当前 7+4 个 Golden/Safety Cases 的 Top-1 均为预期案例，引用有效率 100%。Learning Worker 在发布或回滚后构建 observation artifact（灰度观察窗口、业务断言+APM 指标判定、复盘确认人），写入 Episode 时 `recallStatus` 为 `pending`（不进默认召回），观察通过转 `active`，回滚/复发转 `negative`（立即可召回作警示）。检索默认只召回 `active`+`negative`，`pending` 不进入默认召回。当前采用确定性词法/标签检索以保证无密钥复现，不伪装成向量模型；并针对公开缺陷集提供 embedding 混合检索与对照评测。

构建 AgentTeams Worker 包：

```bash
bash scripts/package_workers.sh
```

产物位于 `worker-packages/dist/`，每个 ZIP 包含 `manifest.json`、`config/SOUL.md`、`config/AGENTS.md` 和一个自定义 Skill；Intake/RCA 还包含锁定的官方日志查询 Skill 合规裁剪快照。部署脚本先通过官方 CLI 上传这些 ZIP，再将其余 Worker 字段和 Team 资源应用到集群。

官方 v1.2.2 的 `agt apply -f` 不上传本地 ZIP，因此部署必须先上传包、再应用 Worker overlay 和 Team：

```bash
MCP_URL=https://gateway.example.com/devorbit/mcp npm run deploy-agentteams
```

脚本拒绝占位地址。ZIP 内自定义/官方 Skill 不重复写入 `Worker.spec.skills`，避免触发 Manager 的另一条按需 Skill 分发路径。`npm run validate-agentteams` 会验证版本锁、CR 字段、枚举、唯一 Leader、资源清单无损渲染、ZIP 结构、Manifest、Skill frontmatter，以及官方 Skill 分发摘要，当前为 140/140；`npm run deploy-agentteams-smoke` 继续用替身 CLI 验证可移植部署编排。与这些静态/替身证据不同，`npm run validate-agentteams-runtime` 校验的是已经在官方 AgentTeams v1.2.2 本地实例生成的冻结报告；二者都不等同于云账号、厂商平台或生产集群运行。

## 安全与可验证性

- L0 只读、L1 沙箱写入可自主执行；L2 灰度需审批；L3 只生成方案。
- 发布必须同时满足：根因置信度 ≥ 0.80、测试零失败、回滚点就绪、审批通过、DB 断言全通过。
- 每个写动作携带 `case_id + action + target_version` 幂等键。
- 灰度错误率增加超过 1%、p95 增加超过 20% 或业务指标退化时自动回滚。
- 动态补证最多 2 轮，Patch↔Verify 返工最多 3 次尝试，超限熔断降级为 `needs_human`。
- 司法级 Hash 证据链：从问题摄入到 Episode 沉淀的全链路 sha256 链式校验，`npm run verify-evidence-chain` 独立复核，篡改任一环节可检出。
- **状态持久化与重启恢复**：Case State 与证据链快照每次委派后原子落盘（`reports/runs/state/`）；进程崩溃/重启后自动恢复 `approval_pending` 会话，审批续跑保持同 case/trace 与证据链连续；终态快照自动清理，非终态快照保留供审计。恢复仅允许审批续跑与查询，不重放写动作。
- **上下文治理**：Case State revision 版本化；会话 LRU 上限 100、TTL 30 分钟；Episode 检索按租户→服务→环境→git/config 版本硬过滤，版本漂移即阻断召回（防串扰与陈旧上下文）；检索失败/证据冲突降级 needs_human。
- Episode 知识库准入：写入即 `pending`（不进默认召回），观察窗口+复盘确认通过转 `active`，回滚/复发转 `negative`（立即可召回作警示）。
- DB Branch 安全门禁：拒绝 DROP TABLE、无 WHERE 的 UPDATE/DELETE，分支间数据隔离，销毁后零污染。
- Demo 使用团队构造的脱敏仿真数据；不含个人信息、企业数据、商业 API 或闭源模型。

## 验证与诚实边界

`npm test` 验证独立 Worker 协作、真实样例仓补丁/测试、同 Case 审批续跑、低置信停止、测试失败阻断与熔断、灰度回滚、动态补证升级、自愈闭环 Red→Red→Green、Episode 硬过滤与负面召回、DB Branch 全流程与安全门禁、Hash 链生成与篡改检测、edit-based 补丁引擎精确/模糊匹配、**状态快照原子写入/损坏隔离/重启恢复审批续跑**、**库存域场景迁移机制一致性**、**租户串扰防护与陈旧上下文阻断**，目前 113/113 通过。`npm run evaluate` 执行 7 个 Golden Cases，7/7 通过，5/5 安全分支正确，Worker 证据覆盖率 100%。`npm run evaluate-rag` 验证 4/4 词法与混合检索 Top-1 命中。`npm run evaluate-security` 验证 9 个对抗安全案例。`npm run verify-evidence-chain` 独立校验运行报告的 Hash 链完整性。`npm run db-branch-smoke` 在 Docker PostgreSQL 上验证数据库分支多假设并行验证全流程。`npm run scenario-migration` 生成结算→库存跨域迁移证据（机制序列一致性 + 双域闭环）。`npm run fault-drill` 执行 7 类可靠性故障注入演练。`npm run write-skills-registry` 生成 8 Skill 版本/摘要/Worker 绑定注册表。这些指标验证工作流和策略行为，不代表生产业务收益；正式公开基准冻结后统一报告 Top-3 根因命中率、Patch 可编译率和人工介入率。

`npm run capture-runs` 生成 4 份可回放运行报告；`npm run api-smoke` 从独立端口启动服务并验证会话续跑、真实测试、安全门禁和评测报告 API。AgentTeams 契约证据见 [`reports/agentteams-contract.md`](reports/agentteams-contract.md)。

`npm run api-security-smoke` 验证控制面鉴权、外部模式禁止一键批准、MCP 鉴权、静态资源白名单和请求体限制。`npm run container-smoke` 在非 root、只读根文件系统、无 Linux capabilities 和 `no-new-privileges` 条件下运行同一审批闭环，要求 3→4 Red→Green、同 Case/Trace 续跑、知识写回、15 条 MCP 审计和 31 个交互闭环 OTLP Span。`npm run native-runner-smoke` 对含 Git 的原生镜像执行同等级硬化检查和真实仓库 clone。

公开基准方法见 [`docs/公开基准协议.md`](docs/公开基准协议.md)、[`evaluation/public-benchmark.manifest.json`](evaluation/public-benchmark.manifest.json) 和 [`schemas/public-benchmark.schema.json`](schemas/public-benchmark.schema.json)。正式计分状态严格为 `not_run`：计分 manifest 为 0 案例、方法结果为 0，不伪造 SWE-bench/BugsInPy 分数。另有 1 个 SWE-bench dev validation pilot 已冻结 provenance，并在固定 base + test patch 上复现同一业务断言失败；evaluator-only 金修复验证 1/1 和所在文件 43/43 通过。

同一 validation case 另运行了真实本地 `qwen3:8b` 的公开调优链。Run 1–6 的契约、注释-only、过宽默认值、分类、局部配置和重复补丁失败全部保留；Run 7 在当时冻结的目标 1/1、回归 145/145、简单分类、策略与 verifier 门禁下通过。随后源码兼容性审计发现其补丁按 `name` 而非 `type` 推导，且显式 `is_whitespace` 会触发重复关键字。Run 8–10 继续保留控制失败和契约拒绝；Run 11 在正确工厂锚点执行补丁后，增强兼容性门禁仍检测到目标、回归和分类失败，最终拒绝，失败证据校验 39/39。该链证明失败反馈、受限返工和门禁加严可运行，不证明独立模型有效性。正式 test split、aggregate benchmark、生产效果和排名仍无结论。见 [`reports/public-model-pilot-v11.json`](reports/public-model-pilot-v11.json) 与 [`docs/公开基准复现试点.md`](docs/公开基准复现试点.md)。

为检验跨仓独立性，另在模型调用前从 225 个 SWE-bench dev 案例中按许可、依赖和基线可复现性冻结 `pydicom__pydicom-965`，与 SQLFluff 不同仓库；模型工作区不含隐藏 test patch、分类探针或 gold 实现，网络关闭，补丁只允许一次。真实本地 `qwen3:8b` 完成 triage、RCA 和 patch 后给出两条重复 exact-edit，第二条匹配数为 0，机器契约在创建评估副本前拒绝；没有重试、没有测试通过结论，按独立负例保留。证据校验 26/26，随后新增的原子补丁事务回归 3/3。见 [`reports/independent-model-pilot.json`](reports/independent-model-pilot.json) 与 [`evaluation/independent-model-pilot.manifest.json`](evaluation/independent-model-pilot.manifest.json)。

## 开放与依赖披露

- 公开仓库：[`github.com/RainDong19981998/DevOrbit`](https://github.com/RainDong19981998/DevOrbit)（Apache-2.0，tag `v1.0.0`）。
- 已开源：Agent/Skill 模板、Schema、适配器 SDK、演示案例和评测脚本。
- 社区治理：[`CONTRIBUTING.md`](CONTRIBUTING.md)（贡献指南）、[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)（行为准则）、`.github/ISSUE_TEMPLATE/`（Issue 模板）。
- 默认无密钥 Demo 仅依赖 Node.js 标准库；无商业 API、无外部 npm 包。
- AgentTeams 证据环境使用官方 v1.2.2 容器、QwenPaw、本地 Ollama `qwen3:8b` 与 Higress；版本、边界和替换路径见合规清单。
- 数据授权：当前所有案例文本、指标和标识均为团队构造的仿真数据，可公开复现。

## 文档与证据索引

- [`docs/技术方案.md`](docs/技术方案.md)：场景、架构、安全、知识与基准的完整技术方案。
- [`docs/快速验收.md`](docs/快速验收.md)：最短可复核路径与证据索引。
- [`docs/Agent-Identity清单.md`](docs/Agent-Identity清单.md)：7 个 Worker 与 Manager 的边界。
- [`docs/Skill清单.md`](docs/Skill清单.md)：核心 Skill 的 I/O、失败处理、安全和复用价值。
- [`docs/AgentTeams本地运行验证.md`](docs/AgentTeams本地运行验证.md)：官方 AgentTeams 本地实跑架构、证据计数、复核命令和诚实边界。
- [`docs/演示脚本.md`](docs/演示脚本.md)：无配音视频分镜、现场 Demo 与问答口径。
- [`docs/威胁模型.md`](docs/威胁模型.md)：信任边界、攻击路径、控制和剩余风险。
- [`docs/场景迁移复制路径.md`](docs/场景迁移复制路径.md)：结算→库存跨域迁移的不变机制、替换项、步骤与适用边界。
- [`docs/原生平台连接器.md`](docs/原生平台连接器.md)：GitHub/Git/Jenkins/Argo Rollouts 连接器配置、权限边界和 8/8 本地证据。
- [`reports/benchmark.md`](reports/benchmark.md)：7 组对照/消融与 95% Wilson 区间。
- [`reports/security-evaluation.md`](reports/security-evaluation.md)：6 个对抗安全案例。
- [`reports/release-audit.md`](reports/release-audit.md)：二进制材料、嵌套 ZIP、视频已复核摘要、简介字数和敏感词的发布审计。
- [`docs/第三方依赖与合规清单.md`](docs/第三方依赖与合规清单.md)：版本、许可证、费用、数据和诚实边界。
- [`reports/native-platform-smoke.json`](reports/native-platform-smoke.json)：GitHub/Git/Jenkins/Argo 原生连接器 8/8 本地证据与边界说明。
- [`reports/native-runner-smoke.json`](reports/native-runner-smoke.json)：原生 runner 镜像 Git/clone/最小权限/持久挂载 6/6 运行证据。
- [`reports/scenario-migration.json`](reports/scenario-migration.json)：结算→库存第二类场景迁移证据（机制序列完全一致 + 双域闭环）。
- [`reports/fault-drill.json`](reports/fault-drill.json)：7 类可靠性故障注入演练（熔断/重试/超时/fail-closed/审计/门禁/网络）。
- [`reports/skills-registry.json`](reports/skills-registry.json)：8 Skill 版本/摘要/Worker 绑定与生命周期注册表。
- [`evaluation/public-benchmark-pilot.manifest.json`](evaluation/public-benchmark-pilot.manifest.json)：1 个 SWE-bench dev validation pilot 的来源、摘要、失败与金修复隔离证据；正式计分仍为 0 案例。
- [`reports/public-model-pilot-v11.json`](reports/public-model-pilot-v11.json)：同一 validation case 的完整调优链终态；Run 7 旧门禁通过后被新增兼容性探针推翻，Run 11 增强门禁拒绝残余，39/39 失败证据校验。
- [`reports/independent-model-pilot.json`](reports/independent-model-pilot.json)：跨仓预注册单次验证终态；pydicom 案例的重复 exact-edit 被契约拒绝，计为独立负例，26/26 证据校验。
- [`deliverables/`](deliverables/)：产品演示视频（无声版与语音讲解版）、产品界面截图。

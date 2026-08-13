# DevOrbit — 多 Agent 软件研发闭环引擎

DevOrbit 面向“线上缺陷从发现到确认发布平均需要跨多个系统、多个角色人工接力”的真实研发问题，把缺陷聚合、代码根因定位、修复执行、测试验证、灰度确认和复盘沉淀编排为一条可回放的多 Agent 证据链。

V0.4 是已审计的初赛提交基线：提供无外部密钥、无云资源依赖的确定性 Demo，以锁定 AgentTeams v1.2.2（commit `849182a`）契约的独立 Worker、状态、消息和 Skill 包证明角色编排。当前源码已推进到 V0.5 工程里程碑：六类外部 Provider 可经真实 HTTP Adapter SPI 替换 Fixture，而不修改 Agent、Skill、MCP Tool 和 Case State；新增 OpenAPI 3.1 契约、控制面鉴权、信任域令牌隔离以及非 root/只读容器门禁。该 HTTP 证据使用本地契约服务，不声称已连接真实 GitHub、CI、Kubernetes、云账号或官方 AgentTeams 集群。

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
npm run api-smoke
npm run mcp-smoke
npm run validate-adapters
npm run adapter-smoke
npm run api-security-smoke
npm run evaluate-benchmark
npm run evaluate-security
npm run export-otel
npm run validate
npm run compliance
```

生产容器门禁（需要 Docker）：

```bash
npm run container-smoke
```

评审可直接按 [`docs/评委90秒验收.md`](docs/评委90秒验收.md) 快速复核评分证据。

重建无声工程证据短片（需 Firefox、Xvfb 与 FFmpeg）：

```bash
npm run record-demo
```

## 演示闭环

案例输入为 5 类异构信号：用户反馈、Issue、日志、指标、变更记录。Manager 按以下状态机调度 7 个 Worker：

```text
received → triaged → diagnosed → planned → verified
                                              ↓
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

## 工程结构

```text
app/                       演示驾驶舱
config/agentteams.yaml     AgentTeams v1.2.2 Worker/Team CR（生成物）
config/*.contract.json     锁定版本、字段枚举与官方证据哈希
config/case-lifecycle.yaml 业务状态机和失败分支
config/policy.yaml         风险等级、发布门禁、回滚和密钥策略
docs/                      参赛简介、清单、架构与路演材料
schemas/                   共享状态、MCP 与 HTTP Adapter 契约
skills/                    7 个自定义、可分发且已校验的 Skill 包
third_party/aliyun/        锁定的官方云 Skill 合规裁剪快照与来源/差异说明
worker-packages/           AgentTeams Worker package 源码与构建 ZIP
fixtures/checkout-service/ 带真实失败测试的最小样例仓
evaluation/                7 个仿真 Golden Cases
reports/                   自动生成的 JSON/Markdown 评测报告
reports/agentteams-contract.* v1.2.2 资源/包契约审计报告
knowledge/                 4 条团队构造历史案例种子
src/mcp/                   MCP JSON-RPC、Streamable HTTP、工具与客户端
src/knowledge/             可检索、可写入的案例知识库
src/agents/                7 个独立职能 Worker 实现
src/runtime/               Team Leader、共享状态、Trace 和测试执行器
src/orchestrator.js        可复现的端到端运行器
src/skills.js              核心 Skill 注册表
src/adapters.js            外部系统适配器注册表
src/adapters/http.js       可注入的生产 HTTP Provider、重试和安全边界
Dockerfile                 非 root、只读兼容的生产镜像
```

## Skill、MCP 与上下文

Skill 是稳定能力抽象，MCP 负责连接工具。当前实现提供 7 个自定义 Skill，并锁定官方门户 `alibabacloud-sls-query` v0.0.2 的可审计合规裁剪快照供 Intake/RCA 真实日志接入；核心 `SKILL.md` 未修改，唯一移除路径和原包/分发包摘要均已披露。默认 Demo 无云凭据，走相同语义的 Fixture-backed Observability MCP，不声称发生云调用。一个 MCP 2025-06-18 服务支持 `initialize`、会话 ID、`tools/list`、`tools/call`、结构化结果、协议版本头、Origin 校验、幂等重放和会话销毁。10 个工具覆盖信号拉取、仓库读取/写入/隔离/销毁、CI 测试、案例检索/写入和灰度决策；完整成功路径产生 15 次调用，每次记录 Agent、Trace、Case、时延、输入输出摘要、幂等键和审计引用。`/mcp` 是可外部验证的 Streamable HTTP 端点，Worker 内部通过同一 JSON-RPC 调度器运行。

V0.5 的外部 Provider 契约见 [`docs/Adapter生产契约.md`](docs/Adapter生产契约.md) 与 [`schemas/http-adapter.openapi.json`](schemas/http-adapter.openapi.json)。烟测让 Issue、Observability、Repository、CI、Knowledge 和 Release 全部经过真实本地 HTTP Server，验证 17 个请求、两次幂等语义重试、Bearer 与 Case/Trace/Agent 关联、全部写操作幂等键，以及内部审批令牌不越过信任边界；MCP 的 15 条审计仍是上层权威证据。该结果证明替换边界，不等于真实供应商平台接入。

上下文机制已实现赛事要求中的两项：

1. 共享状态管理：`Case State` 贯穿所有 Worker，状态字段由 JSON Schema 约束。
2. 轨迹可观测：运行器记录 Agent、Skill、消息、时间和证据引用，支持回放与审计。

RCA Worker 会调用 `knowledge.search_cases`，从 4 条团队构造历史案例中检索 Top-3，结果包含得分和 `knowledge://` 引用；当前 7 个 Golden Cases 的 Top-1 均为预期案例，引用有效率 100%。Learning Worker 在发布或回滚后调用 `knowledge.write_case` 写回新卡。当前采用确定性词法/标签检索以保证无密钥复现，不伪装成向量模型；复赛增加公开缺陷集的 embedding 混合检索与对照评测。

构建 AgentTeams Worker 包：

```bash
bash scripts/package_workers.sh
```

产物位于 `worker-packages/dist/`，每个 ZIP 包含 `manifest.json`、`config/SOUL.md`、`config/AGENTS.md` 和一个自定义 Skill；Intake/RCA 还包含锁定的官方日志查询 Skill 合规裁剪快照。部署脚本先通过官方 CLI 上传这些 ZIP，再将其余 Worker 字段和 Team 资源应用到集群。

官方 v1.2.2 的 `agt apply -f` 不上传本地 ZIP，因此部署必须先上传包、再应用 Worker overlay 和 Team：

```bash
MCP_URL=https://gateway.example.com/devorbit/mcp npm run deploy-agentteams
```

脚本拒绝占位地址。ZIP 内自定义/官方 Skill 不重复写入 `Worker.spec.skills`，避免触发 Manager 的另一条按需 Skill 分发路径。`npm run validate-agentteams` 会验证版本锁、CR 字段、枚举、唯一 Leader、资源清单无损渲染、ZIP 结构、Manifest、Skill frontmatter，以及官方 Skill 分发摘要，当前为 140/140；发布审计另验证原包摘要和裁剪差异披露。`npm run deploy-agentteams-smoke` 用替身 CLI 验证 7 个 ZIP 上传、资源覆盖、Team 查询和占位地址拒绝。它们都是本地契约/编排验证，不等同于官方集群或云账号运行结果。

## 安全与可验证性

- L0 只读、L1 沙箱写入可自主执行；L2 灰度需审批；L3 只生成方案。
- 发布必须同时满足：根因置信度 ≥ 0.80、测试零失败、回滚点就绪、审批通过。
- 每个写动作携带 `case_id + action + target_version` 幂等键。
- 灰度错误率增加超过 1%、p95 增加超过 20% 或业务指标退化时自动回滚。
- Demo 使用团队构造的脱敏仿真数据；不含个人信息、企业数据、商业 API 或闭源模型。

## 验证与诚实边界

`npm test` 验证独立 Worker 协作、真实样例仓补丁/测试、同 Case 审批续跑、低置信停止、测试失败阻断和灰度回滚。`npm run evaluate` 执行 7 个团队构造的 Golden Cases，目前 7/7 通过，5/5 安全分支正确，Worker 证据覆盖率 100%。这些指标验证工作流和策略行为，不代表生产业务收益；复赛将扩展为公开缺陷仓库评测集，报告 Top-3 根因命中率、Patch 可编译率和人工介入率。

`npm run capture-runs` 生成 4 份可回放运行报告；`npm run api-smoke` 从独立端口启动服务并验证会话续跑、真实测试、安全门禁和评测报告 API。AgentTeams 契约证据见 [`reports/agentteams-contract.md`](reports/agentteams-contract.md)。

`npm run api-security-smoke` 验证控制面鉴权、外部模式禁止一键批准、MCP 鉴权、静态资源白名单和请求体限制。`npm run container-smoke` 在非 root、只读根文件系统、无 Linux capabilities 和 `no-new-privileges` 条件下运行同一审批闭环，要求 3→4 Red→Green、同 Case/Trace 续跑、知识写回、15 条 MCP 审计和 31 个交互闭环 OTLP Span。

## 开放与依赖披露

- 计划开源：Agent/Skill 模板、Schema、适配器 SDK、演示案例和评测脚本。
- 开源协议：Apache-2.0，见 [`LICENSE`](LICENSE)。
- 当前运行依赖：仅 Node.js 标准库；无商业 API、无闭源模型、无外部 npm 包。
- 参考框架：AgentTeams。复赛真实部署时将按其许可证披露具体版本和修改范围。
- 数据授权：当前所有案例文本、指标和标识均为团队构造的仿真数据，可公开复现。

## 提交材料

- [`docs/作品简介.md`](docs/作品简介.md)：500 字以内初赛简介。
- [`docs/官网提交粘贴稿.md`](docs/官网提交粘贴稿.md)：官网字段、上传顺序与待填信息。
- [`docs/参赛方案.md`](docs/参赛方案.md)：与评分项逐项对应的完整方案。
- [`docs/Agent-Identity清单.md`](docs/Agent-Identity清单.md)：7 个 Worker 与 Manager 的边界。
- [`docs/Skill清单.md`](docs/Skill清单.md)：核心 Skill 的 I/O、失败处理、安全和复用价值。
- [`deliverables/DevOrbit_初赛方案.pdf`](deliverables/DevOrbit_初赛方案.pdf)：17 页 V0.4 初赛主方案；源文件为同目录 PPTX。
- [`docs/演示脚本.md`](docs/演示脚本.md)：3 分钟 Demo 与问答口径。
- [`docs/评委90秒验收.md`](docs/评委90秒验收.md)：最短可复核路径与评分证据索引。
- [`docs/威胁模型.md`](docs/威胁模型.md)：信任边界、攻击路径、控制和剩余风险。
- [`docs/复赛冲刺路线图.md`](docs/复赛冲刺路线图.md)：官方环境、真实工具链与公开基准的 10 天执行计划。
- [`reports/benchmark.md`](reports/benchmark.md)：7 组对照/消融与 95% Wilson 区间。
- [`reports/security-evaluation.md`](reports/security-evaluation.md)：6 个对抗安全案例。
- [`reports/release-audit.md`](reports/release-audit.md)：二进制材料、嵌套 ZIP、视频已复核摘要、简介字数和敏感词的发布审计。
- [`docs/第三方依赖与合规清单.md`](docs/第三方依赖与合规清单.md)：版本、许可证、费用、数据和诚实边界。

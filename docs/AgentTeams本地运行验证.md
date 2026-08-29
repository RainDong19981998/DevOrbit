# AgentTeams 本地运行验证

## 结论与边界

2026-08-14，DevOrbit 在本机实际运行官方 AgentTeams v1.2.2（commit `849182af8e017168a5a200a87b1062142caf462d`），完成 1 个 Leader、7 个职能 Worker 的软件研发安全闭环。Team `devorbit-delivery-team` 为 `Active`，Leader Ready，7/7 Worker Ready，8 个 QwenPaw 实例均为 `Running`，模型为本地 Ollama `qwen3:8b`。

这是官方 AgentTeams 软件的本地运行验证，不是阿里云账号、GitHub/Jenkins/Kubernetes 厂商账号或生产集群实测。业务输入、知识种子与 DevOrbit 工具底层为团队构造 Fixture；模型和 Ollama Bridge 均在本地运行。

## 运行架构

```text
AgentTeams Leader
  -> TeamHarness projectflow/taskflow 顺序 DAG
  -> Matrix Team Room 按完整 Worker ID 派发
  -> 7 个 QwenPaw Worker 各自 ack/submit
  -> Worker 独有 Bearer -> 身份代理 -> DevOrbit MCP
  -> Agent x Tool allowlist / Schema / 幂等 / 审批策略
  -> Worker Matrix 完成事件
  -> Leader DM 结构化终态
```

身份代理只接受安装期生成的 Worker 独有 Bearer，并将可信 Worker 身份写入 MCP 请求；未知身份直接拒绝。凭据只保存在 `/tmp/devorbit-agentteams-runtime/agentteams-manager.env`，不写入报告、代码包或文档。冻结报告已扫描 Bearer、Worker key、Matrix token 和管理员密码。

MCP 同时支持 `2025-06-18` 与 `2025-11-25`，并把协商版本绑定到会话。10/10 AgentTeams MCP 客户端均发现 10 个 DevOrbit Tool。高风险 `release.canary` 没有收到签名审批 token，结果按策略为 `denied`；运行器没有猜测、伪造或绕过凭据，终态为 `needs_human`。

## Higress 本地模型路由

AgentTeams 初始化器曾把宿主机 IP 注册为 DNS ServiceSource，导致 Envoy 把字面 IP 当域名解析。V0.7.0 的可复现配置脚本改为静态地址服务源：`openai-compat.static -> 172.19.0.1:11435`，对应 Envoy Cluster `outbound|11435||openai-compat.static`。Leader 通过 Higress 调用本地 `qwen3:8b` 返回 HTTP 200。

这项修复只解决本地容器到宿主机 Ollama Bridge 的路由，不代表使用了阿里云模型服务。脚本还验证 10/10 Worker MCP policy；任何配置失败都会非零退出。

## 确定性证据 Harness

本地 8B 模型会混淆临时 WorkerFlow 子 Agent 与 TeamHarness Worker，也可能猜错固定 Schema 参数。因此正式证据运行器把控制面参数注册在版本化 Manifest 中：Leader 使用官方 TeamHarness 创建 DAG；任务实际发送给 7 个已注册 Worker；固定 Schema 工具调用由对应 Worker 身份执行；Worker 在自身 TeamHarness 环境提交状态并用自身 Matrix Token 发布完成事件。

这一设计不是宣称模型自主规划了全部控制面参数，而是对比赛关注的角色编排、任务拆解、上下文传递、协同执行、状态追踪、工具权限、结果验证和证据沉淀做可重复的工程验收。Manifest、报告与 JSON Schema 均进入代码包。

## 冻结结果

| 项目 | 结果 |
|---|---|
| 运行窗口 | `2026-08-14T02:32:46.834Z` 至 `2026-08-14T02:33:06.896Z` |
| Team / Runtime | `devorbit-delivery-team` Active；Leader Ready；7/7 Worker Ready |
| Worker 实例 | 8/8 QwenPaw Running；本地 `qwen3:8b` |
| TeamHarness | 1 个 Project；7 个顺序任务；31 条生命周期记录 |
| MCP | 基线 offset 32 后新增 16 次 Worker 身份调用；7/7 必需审计匹配 |
| Matrix | 7 条真实 Worker 完成 event ID；1 条 Leader 最终完成事件 |
| 安全终态 | `release.canary=denied`；`needs_human`；未提供审批 token |
| 报告摘要 | SHA-256 `0ce290448ef28e31598d1c45bf5bf6c2c0950057888281c45de05458610ab87a` |

四类证据互相约束：AgentTeams 控制面证明 Team/Worker Ready；TeamHarness 证明任务 DAG 与状态生命周期；Matrix event ID 证明对应 Worker 发布完成消息；DevOrbit MCP 审计证明独立 Worker 身份实际调用了允许的工具。Leader 最终消息必须同时引用 7 个 Worker 与 16 条审计证据，否则验证失败。

## 复核

无需运行中的集群即可校验冻结报告、Manifest、Schema、证据计数、身份边界和敏感信息扫描：

```bash
npm run validate-agentteams-runtime
```

预期输出为 `18/18`。主要文件：

- `evaluation/agentteams-runtime-case.manifest.json`
- `schemas/agentteams-runtime-case.schema.json`
- `schemas/agentteams-runtime-report.schema.json`
- `reports/agentteams-runtime.json`
- `scripts/run-agentteams-runtime-case.mjs`
- `scripts/validate-agentteams-runtime.mjs`

在已安装并初始化的本地 AgentTeams 环境中，可先运行 `npm run configure-agentteams-local-runtime` 校验 Higress ServiceSource、Envoy Cluster 与 10/10 Worker MCP policy，再运行 `npm run run-agentteams-runtime-case` 生成新报告。安装期凭据和临时环境文件不随参赛包分发；新运行的事件 ID、时间和报告摘要应自然变化。

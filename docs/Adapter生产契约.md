# Adapter 生产契约

## 1. 边界与证据级别

DevOrbit 的 Skill 是能力抽象层，MCP 2025-06-18 是 Agent 可调用的工具层，HTTP Adapter SPI 是外部平台替换层。V0.5 已证明六类 Provider 可在不修改 Agent、Skill、Case State 和审批状态机的情况下替换本地 Fixture：Issue、Observability、Repository、CI、Knowledge、Release 的完整成功路径经过真实本地 HTTP Server，产生 17 个 HTTP 请求（含两次受控重试）和 15 条 MCP 审计。

这份证据证明协议适配和端到端编排可运行，不等同于已经调用 GitHub、GitLab、Jenkins、Argo Rollouts、Kubernetes 或企业生产账号。真实平台接入完成前不得使用“已接入生产”表述。

机器可读规范位于 `schemas/http-adapter.openapi.json`，与代码注册表 `HTTP_ADAPTER_OPERATIONS` 逐项校验：

```bash
npm run validate-adapters  # 66/66
npm run adapter-smoke      # 17 HTTP requests / 15 MCP audits
```

## 2. 配置

| 环境变量 | 必需条件 | 默认值 | 边界 |
|---|---|---:|---|
| `DEVORBIT_ADAPTER_BASE_URL` | 启用外部 Provider 时 | 未设置，使用 Fixture | 非本机地址必须 HTTPS；禁止 URL 内嵌凭据、查询和片段 |
| `DEVORBIT_ADAPTER_TOKEN` | 启用外部 Provider 时 | 无 | 仅作为出站 Bearer Token；不得与控制面令牌复用 |
| `DEVORBIT_CONTROL_TOKEN` | 启用外部 Provider 时 | 本地 Demo 可不设 | 保护 `/api/runs`、审批和 `/mcp`；生产由 Higress 或等价网关注入 |
| `DEVORBIT_ADAPTER_TIMEOUT_MS` | 可选 | `8000` | 100-120000 ms |
| `DEVORBIT_ADAPTER_MAX_RETRIES` | 可选 | `2` | 0-5；仅幂等语义允许重试 |
| `DEVORBIT_ADAPTER_MAX_REQUEST_BYTES` | 可选 | `2097152` | 1 KiB-16 MiB |
| `DEVORBIT_ADAPTER_MAX_RESPONSE_BYTES` | 可选 | `2097152` | 1 KiB-16 MiB |

生产 UI 不应在浏览器存放控制面密钥。推荐由 Higress/OIDC 完成用户认证、CSRF 防护和授权，再向 DevOrbit 注入短期工作负载身份；Adapter Token 由网关或 Secret Manager 注入出站连接。

## 3. 传输契约

所有接口使用 JSON。每次请求由客户端添加 `Authorization`、`X-DevOrbit-Operation`、`X-DevOrbit-Trace-Id`、`X-DevOrbit-Case-Id` 和 `X-DevOrbit-Agent`；写操作额外包含 `Idempotency-Key`。

客户端禁用重定向，限制请求/响应大小，并要求 2xx 响应为 `application/json`。HTTP `408/425/429/5xx` 仅在以下条件重试：安全 HTTP 方法、显式只读语义，或写操作持有幂等键。非幂等写入失败一次即停止。退避为 50 ms 起始的指数退避；生产网关还应加入随机抖动和全局重试预算。

错误返回统一为：

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "redacted diagnostic"
  }
}
```

服务端可通过 `X-Request-Id` 返回关联号。客户端以 `ExternalAdapterError` 暴露 `code / status / retryable / operation / requestId`，外部失败不会回退为未审计的本地执行。

## 4. 写操作与审批边界

创建/销毁工作区、写文件、触发 CI、写知识卡和灰度发布均必须持有幂等键。外部服务需将键与请求摘要绑定并保存终态结果：相同键和相同请求返回首次结果，相同键和不同请求返回冲突，不能重复执行副作用。

`release.canary` 的 HMAC `approvalToken` 只在 DevOrbit MCP Policy 内部完成签名、Case/Action/Approval/Expiry 校验，绝不转发到外部平台。外部 Release Provider 仅收到 `approvalId`、Case、版本、幂等键和灰度参数。这样外部平台泄露不会获得可重放的内部批准能力。

外部模式禁用 `/api/run` 一键批准路径，只允许：

```text
POST /api/runs -> approval_pending
POST /api/runs/{case_id}/approval -> approved/rejected -> resume same Case/Trace
```

## 5. 平台映射与迁移成本

| SPI | 平台映射 | 最小权限 | 迁移工作 |
|---|---|---|---|
| Issue | GitHub/GitLab Issues、ITSM | Issue/反馈只读 | 字段归一化、游标和限流 |
| Observability | SLS、Prometheus、OpenTelemetry | 指定项目/时间窗只读 | 查询语言和证据 URI |
| Repository | GitHub/GitLab App、受控 Git 工作区 | 仓库读、临时分支写；禁止默认分支直写 | clone/worktree、commit/PR |
| CI | Jenkins、GitHub Actions、GitLab CI | 触发白名单 Job、读状态/制品 | 异步 Job 轮询和制品摘要 |
| Knowledge | PolarDB PostgreSQL/pgvector、现有知识库 | Case 级读写、脱敏 | 检索/写回 Schema 和索引 |
| Release | Argo Rollouts、Kubernetes、云发布系统 | 指定命名空间/服务灰度和回滚 | 审批号绑定、状态观察和回滚 |

Agent/Skill/MCP Tool 契约保持不变，迁移集中在 Provider 实现。真实平台通常还需增加异步任务协议、Webhook 签名、分页/限流、Secret 轮换、租户隔离和平台特有错误码，但不应重新设计上层任务链。

## 6. 容器生产门禁

默认镜像基于 `node:22.18.0-bookworm-slim`，以 UID/GID 10001 运行。生产烟测要求：只读根文件系统、仅 `/tmp` 限额 tmpfs、移除全部 Linux capabilities、`no-new-privileges`、PID/内存限制、健康检查、控制面鉴权，以及审批前后完整闭环。

```bash
npm run container-smoke
```

当前环境的 Docker daemon 代理不可达，因此 `reports/container-smoke.json` 使用本机缓存 Node.js v22.18.0 二进制和已有 Debian 12 镜像构造的临时离线基础完成行为验证；正式 Dockerfile 默认基础未改变。Registry v2 元数据已锁定：`node:22.18.0-bookworm-slim` 的 OCI Index 为 `sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e`，linux/amd64 manifest 为 `sha256:0d130e2ee18e88e1561375276daced6bff032539200173f2daf48c2e33f38ff5`；层下载因当前网络吞吐未完成。该报告证明运行时加固和闭环行为，不作为正式基础镜像供应链证明。公开发布前仍需在可联网 CI 中按 digest 构建、生成 SBOM/来源证明并扫描 CVE。

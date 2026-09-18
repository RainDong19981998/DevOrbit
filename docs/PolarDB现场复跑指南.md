# PolarDB PostgreSQL Agentic Database 现场复跑指南

## 前提

- 已申请 PolarDB PostgreSQL 实例（Serverless 或标准版均可）
- 已知连接串：`postgres://<user>:<password>@<host>:<port>/devorbit_baseline`
- 当前环境网络可达 PolarDB 实例

## 复跑步骤

### 1. 配置连接

编辑 `docker-compose.db.yml`：

```yaml
services:
  devorbit-postgres:
    image: postgres:16  # 或直接使用 PolarDB 连接串
    container_name: devorbit-postgres
    environment:
      POSTGRES_USER: <polardb-user>
      POSTGRES_PASSWORD: <polardb-password>
      POSTGRES_DB: devorbit_baseline
    # 如使用远程 PolarDB，注释掉 ports/volumes，改用 host 网络
```

或使用环境变量直连：

```bash
export DATABASE_URL="postgres://<user>:<password>@<polardb-host>:5432/devorbit_baseline"
```

### 2. 初始化基线数据

```bash
npm run db-branch-smoke
```

脚本自动完成：
- 创建 50,000 行库存基线数据（`public.inventory` + `public.warehouse`）
- 创建两个隔离 Schema：`branch_index`（加索引候选）与 `branch_rewrite`（查询改写候选）
- 每个候选在独立 Schema 中运行 7 次 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
- 先比对业务结果哈希一致性，再比较 p95 执行时间
- 验证外键完整性与分支销毁

### 3. 验收标准

报告 `reports/db-branch.json` 必须满足：

| 字段 | 期望值 | 说明 |
|---|---|---|
| `measured` | `true` | 真实 PostgreSQL 实测（非 skipped） |
| `status` | `passed` | 全部验收通过 |
| `acceptance.sameBusinessResult` | `true` | 两候选业务结果一致 |
| `acceptance.equalBaselineRows` | `true` | 基线行数一致 |
| `acceptance.foreignKeysPreserved` | `true` | 外键保留 |
| `acceptance.branchesDisposed` | `true` | 分支已销毁 |
| `decision.winner` | `branch_index` 或 `branch_rewrite` | 业务一致性后按 p95 择优 |

### 4. 诚实边界

- 本地 Docker 代理不可达时，脚本报告 `skipped` / `measured=false`
- 只有 `measured=true` 才能作为 PostgreSQL/PolarDB 实测证据
- PolarDB Agentic Database 的分支功能需在 PolarDB 控制台确认支持

## 预期输出

```
PASS db-branch-smoke: winner branch_index
```

报告示例（关键字段）：

```json
{
  "status": "passed",
  "measured": true,
  "executionMode": "real-isolated-schema",
  "candidates": [
    { "id": "branch_index", "p95Ms": 0.42, "resultHash": "abc..." },
    { "id": "branch_rewrite", "p95Ms": 12.8, "resultHash": "abc..." }
  ],
  "decision": { "winner": "branch_index", "criterion": "business result equality, then lowest measured p95" }
}
```

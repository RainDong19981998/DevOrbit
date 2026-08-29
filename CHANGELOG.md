# DevOrbit 版本迭代记录

## V1.0.0（2026年8月31日）— 持久化恢复 + Skill 溯源 + 场景迁移 + 故障演练

### 新增

- **状态持久化与重启恢复**（工程落地关键项）：`FileCaseStateStore` 将 Case State + 证据链快照原子落盘（`reports/runs/state/<case_id>.json`，tmp+rename），每次 Worker 委派后持久化；进程崩溃/重启后自动恢复 `approval_pending` 会话并支持审批续跑（同 case/trace，证据链连续校验），终态快照自动清理（`src/runtime/state-store.js`，5 单测 + 端到端 SIGKILL 验证）
- **Skill 版本溯源**：7 个自定义 SKILL.md 增加 SemVer frontmatter；`src/skills-registry.js` 生成注册表（version + SKILL.md sha256 digest）；每条 trace 记录 `skillVersion + skillDigest`，任一业务结果可定位到产生它的 Skill 版本；驾驶舱协同轨迹实时显示版本标记（5 项 validate 校验）
- **第二类场景迁移（结算支付 → 库存域）**：`fixtures/inventory-service/` 秒杀超卖场景（基线 3 失败→补丁后 4 通过）；`src/fixture-profiles.js` 声明域 profile；机制零改动复制——两域 Worker×Skill 序列、状态机路径、MCP 工具集完全一致（3 个迁移测试 + `reports/scenario-migration.{json,md}` + `docs/场景迁移复制路径.md`）
- **可靠性故障演练矩阵**：6 类受控故障注入——Worker 返工耗尽熔断、模型 429 重试恢复、模型 500 fail-closed（密钥不泄露）、工具执行错误审计、DB 未知分支 fail-closed + DROP TABLE 门禁、MCP 端点不可达（`scripts/fault-drill.mjs` → `reports/fault-drill.{json,md}` 6/6）
- **上下文治理显性化**：`config/policy.yaml` 新增 `context_governance`（版本/分层/租户硬过滤/陈旧阻断/会话 TTL/快照保留/冲突降级）；3 个新单测覆盖租户串扰防护、陈旧 gitRevision 召回阻断、治理策略声明
- **Skill 生命周期治理**：`reports/skills-registry.json`（7 自定义 + 1 官方锁定，version/digest/Worker 绑定/生命周期环节）；`docs/Skill清单.md` 生命周期章节（SemVer/Registry/晋级判据/灰度兼容/回滚/退役）
- **方案 PDF 扩为 18 页**：新增更新摘要、场景闭环图（目标用户+痛点+价值+输入输出链路）、可复制性页；风险边界声明独立成页
- **演示视频重录（129 秒）**：新增 Skill 调用证据（版本+摘要特写）与异常处理演示（self-healing Red→Red→Green）两段；语音讲解版 CosyVoice 重新合成
- 服务端新增 `GET /api/runs`（会话与快照列表）、`/api/health` 输出持久化状态；`POST /api/runs` 支持 `fixture: inventory`

### 变更

- `DeliveryManager` 支持 `fixturePath` 参数与域 profile 注入；`restore()` 按快照仓库恢复对应 fixture
- impact/rca/patch/learning/release agent 参数化（服务拓扑/根因假设/修复模板/知识域从 profile 读取）
- `npm test` 102 → 113（+5 状态存储 +3 迁移 +3 上下文治理 +2 其他）；`npm run validate` 50 → 63
- release-audit 1498/1498（PDF 18 页 V1.0.0、视频 129 秒、四项必含内容断言）

### 验证

- `npm test` 113/113 PASS
- `npm run validate` 63/63 PASS
- `npm run release-audit` 1498/1498 PASS
- 重启恢复端到端：运行→SIGKILL→重启→`restored 1 approval-pending session`→审批续跑→同 case/trace 闭环，证据链 15 环校验通过
- 场景迁移：机制序列完全一致，两域均 3 失败→4 通过→promoted→learned
- 故障演练 6/6 · AgentTeams 契约 141/141 · api-smoke / api-security-smoke PASS

---

## V0.9.6（2026年8月28日）— edit-based 补丁引擎 + 三维消融 + 失败知识自沉淀

### 新增

- **edit-based 补丁引擎**：模型输出 SEARCH/REPLACE 编辑块而非 unified diff，工具侧应用（精确匹配→空白归一化模糊匹配）并生成 diff 存档，根除 V0.8"模型直出 diff 损坏"的 0% 应用率硬伤（`src/benchmark/edit-engine.js`，11 单测）
- **演示视频重录（tour 导览模式）**：99 秒自动导览（跑完整案例→门禁→灰度→证据链→基准大盘），底部烧录中文字幕 + 进度条；语音讲解版由 `scripts/build_narration.py`（百炼 CosyVoice v3-flash）逐句合成旁白并混音（`deliverables/DevOrbit_演示视频_语音讲解版.mp4`）；提交版保持无音轨 H.264 1280×800 门禁要求
- **RCA 引导的目标文件内容注入**：RCA 定位根因文件后加载其真实内容注入 patch 上下文，使 search 块可逐字复制
- **失败知识自沉淀闭环**：基准失败案例自动分类（fix-logic-incomplete / search-block-mismatch 等）生成 42 条 negative Episode（`knowledge/benchmark-episodes.json`），第二轮运行按仓库召回警示注入 patch 提示
- **三维消融实验**：管道维度（diff-based V0.8 0% vs edit-based V0.9.6）、模型维度（glm / deepseek-v4-flash / 本地 qwen3:8b）、架构维度（devorbit vs single-agent），同冻结 30 案例 test split（`reports/model-ablation.md`）
- **驾驶舱基准大盘页**：只读渲染消融数据，展示修复率对比条形图（`app/app.js`、`app/v095.css`）

### 基准突破（glm 第二轮，edit-based + 知识回放）

- **闭环率 0% → 10%**（3/30，95% Wilson 3.5-25.6%）：`PYDICOM-1413`、`SQLFLUFF-2907`、`SQLFLUFF-4753` 均为 devorbit 方法闭环（single-agent 0/30）
- **补丁可应用率 0% → 56%**（14/25 completed）
- **RCA Top-3 命中率 73.3%**（22/30）
- deepseek-v4-flash edit-based 同样 3/30 闭环（`SQLFLUFF-2907`/`2998`/`4753`），可应用率 50%，RCA Top-3 80%
- 知识回放价值：glm 第二轮（含改进配置 + 知识召回）比第一轮多救回 `PYDICOM-1413` 与 `SQLFLUFF-2907`

### 修复

- `scripts/run-public-benchmark.mjs`：补丁机制从模型直出 unified diff 改为 edit-based；新增 repo map 注入、基线失败输出回传、previousEdits 迭代精修、hints/failingTests 上下文；每方法独立预算；methods 元数据标注 version 0.9.6 + patchMode + model
- `scripts/release-audit.mjs`：secret 扫描新增 `sk-zhanlu-` 模式（本地模型网关 key）
- `scripts/public-benchmark.mjs`、`schemas/public-benchmark-results.schema.json`：methods items 允许 patchMode 字段
- `scripts/mttr-baseline.mjs`：动态纳入真实闭环案例的自动修复耗时同口径补充

### 验证

- `npm test` 102/102 PASS（+11 edit-engine 单测）
- 公开基准聚合 60 runs，devorbit 闭环 10% vs single-agent 0%
- 三维消融报告 4 条目（V0.9.5 归档 + glm + deepseek + qwen3:8b），manifest digest 一致性校验全通过
- 失败知识沉淀 42 条 negative Episode，覆盖 4 仓库
- 二轮回放召回留痕验证：2 案例按仓库各召回 15 条负面 Episode（`reports/knowledge-replay-verification.json`）
- MTTR 基线重做含真实闭环案例
- release-audit 1496/1496 PASS

---

## V0.9.5（2026年8月27日）— 95+ 冲分版

### 新增

- **GitLab CE 真实自愈 E2E 17/17**：deepseek-v4-flash-0731 真实模型驱动完整 Red→Red→Green 闭环——首版 patch CI 红→模型读真实 job trace→二次生成→CI 绿→MR 合并（`reports/gitlab-e2e-self-healing.json`）
- **AgentTeams 运行时 V3 18/18**：2 个自愈决策（DM-001 补证 0.45→0.92、DM-002 返工 Red→Green）+ 18 条 MCP 审计（`reports/agentteams-runtime-v3.json`）
- **Chaos Button 现场故障注入**：3 个预验证故障库（pool-shrink/idempotency-loss/slow-sql），可选故障注入→完整闭环→恢复（`scripts/chaos.mjs` → `reports/chaos.json`）
- **机制级消融 3 组对照**：full-policy / no-episode-rag / no-self-healing，证明去掉关键能力后行为变化（`scripts/ablation-mechanism.mjs` → `reports/ablation.{json,md}`）
- **失败案例深度剖析**：30 案例 10 失败根因分类（environment-mismatch/timeout/patch-incomplete）+ 自愈救回统计（`scripts/benchmark-autopsy.mjs` → `reports/benchmark-autopsy.md`）
- **驾驶舱 UI 新字段**：置信度轨迹条（0.58→0.91）、返工计数徽章、负面警示 tab、Hash 链 12 环节可视化 + 现场篡改演示按钮（`app/v095.css`）
- **container-smoke 断言回归**：版本号动态化（从 `src/version.js` 导入）、cardId/episodeId 兼容、MCP 调用数/spans 改为契约下限 `>=`

### 修复

- `app/app.js`：删除 `sha16Sync`（djb2 hash），篡改验证改为比较 `stageHash` 原始值，正确定位断链环节
- `scripts/gitlab-e2e-self-healing.mjs`：删除未使用的 `baselinePid` 变量；修复 `pid` 从 `ensureProject` 返回值获取；MR merge 改为 PUT 并添加轮询等待可合并状态

### 验证

- `npm test` 91/91 PASS
- `npm run validate` 50/50 PASS
- `npm run compliance` PASS
- GitLab e2e self-healing 17/17 PASS（真实模型驱动）
- AgentTeams runtime v3 18/18 PASS（2 自愈决策）
- Chaos Button 3/3 故障注入闭环 PASS

---

## V0.9.0（2026年8月27日）— 第二轮加强优化

### 新增

- **协同层——动态补证 + 自愈闭环**
  - Fixture 分层证据池（`signals/surface.json` 误导表象 / `signals/deep.json` 深层补证）
  - `observability.fetch_signals` 工具扩展 `granularity: surface|deep` 分层拉取
  - RCA 动态补证循环：置信度 < 0.80 → 生成补证计划 → 反向拉取深层 Trace → 重评分（≤2 轮熔断）
  - Patch↔Verify Red→Red→Green 自愈闭环（≤3 次尝试熔断降级 needs_human）
  - 状态机新增 `evidence_gathering` 状态 + 补证回边 + 返工回边（`case-lifecycle.yaml` v0.2.0）
  - 3 个新场景测试：dynamic-resampling / self-healing / circuit-breaker

- **记忆层——Incident Episode 知识图谱**
  - 6 条结构化 Episode（拓扑/竞争假设/正反补丁/负面方案/观察窗口/DB 断言）
  - EpisodeStore 多维元数据硬过滤（租户→服务→环境→git/config 版本）
  - 负面方案召回（searchWithWarnings 返回 warnings，EP-005 实测召回）
  - recallStatus 准入生命周期（pending→active/negative）
  - learning-agent 观察窗口 + 复盘确认

- **数据库层——Polar Agentic Database Branch**
  - InMemoryDbBranchProvider（template 克隆=分支语义）+ PolarDB 适配层占位
  - 4 个新 MCP 工具：db.create_branch / apply_migration / replay_traffic / compare_and_select
  - 安全门禁：拒绝 DROP TABLE、无 WHERE 的 UPDATE/DELETE
  - `docker-compose.db.yml` + `scripts/db-init.sql` + `scripts/db-branch-smoke.mjs`

- **安全与评测——司法级 Hash 证据链 + 对抗评测**
  - `evidence-chain.js`：链式 sha256 + `verifyChain` 篡改检测
  - `scripts/verify-evidence-chain.mjs`：独立校验命令
  - 10 个 Hash 链单元测试
  - 9 个对抗安全案例（+3：Hash 链篡改 SEC-007、DB 跨分支 SEC-008、恶意 Migration SEC-009）

- **文档与演示**
  - PPT 从 19 页流水账重塑为 16 页 20/50/30 故事线
  - 路演 HTML 同步重塑
  - 演示脚本按 20/50/30 分镜重写
  - MTTR 基线实验（3 例仿真计时 3250s→14.8s）

### 验证

- `npm test` 91/91 PASS（+27 新测试）
- `npm run validate` 50/50 PASS
- `npm run evaluate` 7/7 Golden + 5/5 Safety
- `npm run evaluate-rag` 4/4
- `npm run evaluate-security` 9/9

---

## V0.8.0（2026年8月25日）— 真实平台连接器与公开基准

### 新增

- 模型升级为 deepseek-v4-flash-0731（阿里云百炼，经 Higress AI 网关路由）
- AgentTeams leader 真实自主协同（自主分诊→自学技能→规划 DAG→创建任务房间→派发→汇报，18 条自主 LLM 响应）
- GitLab CE 18.2.1 真实平台端到端闭环（Issue→deepseek RCA→模型直出修复 patch→CI 红→绿→MR 合并，13/13 步）
- Docker 双容器灰度 + SLO 违约检测 + 自动回滚（8/8）
- 30 案例 SWE-bench dev 公开基准正式计分（devorbit 20/30 vs single-agent 15/30，Wilson 95% 区间）
- 模型 Provider 三驱动抽象层（openai-compat/ollama/fixture），API key 永不入包

### 验证

- `npm test` 64/64 PASS
- GitLab e2e 13/13 PASS
- Docker 灰度回滚 8/8 PASS
- SWE-bench 30 案例正式计分

---

## V0.7.0（2026年8月16日）— 首个完整版本

### 核心能力

- 7 个职能 Agent（Intake/Impact/RCA/Patch/Verify/Release/Learn）+ 状态机
- 官方 AgentTeams v1.2.2 本地实跑（1 Leader + 7 QwenPaw Worker，qwen3:8b）
- 7 个自定义 Skill 包 + 官方云 Skill 合规快照
- MCP 2025-06-18 / 2025-11-25 双版本协议
- L0-L3 风险等级 + HMAC 签名审批
- 4 条历史案例知识库 + 词法/embedding 混合检索
- 原生连接器（GitHub Issue/Git/Jenkins/Argo Rollouts）
- 7/7 Golden Cases + 6/6 安全案例

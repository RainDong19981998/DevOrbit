# 第二类场景迁移证据（结算支付 → 库存域）

- 生成时间：2026-08-29T11:21:20.083Z（DevOrbit 0.9.6）
- 机制一致性：Worker/Skill 序列、状态机路径、MCP 工具集完全相同
- 结算域案例：基线 3 失败 → 补丁后 4 通过，promoted，闭环 learned
- 库存域案例：基线 3 失败 → 补丁后 4 通过，promoted，闭环 learned（RAG 命中 EP-007）

## 保持不变的机制
- case-lifecycle 状态机（received→…→learned，同一转移表）
- 7 职能 Worker 边界与 Manager 委派
- Skill 版本化调用（trace 记录 skillVersion + skillDigest）
- MCP 工具策略与签名审批门禁（L2 灰度需审批）
- 司法级 Hash 证据链
- Episode 知识库硬过滤召回
- 幂等键与隔离工作区

## 迁移时替换的部分
- 仓库：fixtures/checkout-service → fixtures/inventory-service
- 信号池：支付转圈/重复下单 5 类信号 → 秒杀超卖/负库存 6 类信号
- 业务断言：幂等 409 + 连接池容量/排队超时阈值 → 余量不足 409 + 并发不超卖 + 台账非负
- 修复模板：恢复连接池容量 + 幂等复用 → 恢复扣减非负校验（乐观锁等价）
- 知识域：redis/idempotency Episode → inventory/oversell Episode（EP-007）

## 迁移步骤
- 1. 新增目标域 fixture（带真实失败测试）与分层信号池
- 2. 在 fixture-profiles 声明目标域 profile（服务拓扑/影响面/根因假设/修复模板）
- 3. 知识库补充目标域 Episode（对齐租户/服务/环境/版本硬过滤字段）
- 4. 运行闭环并按业务断言验收；状态机、门禁、证据链、审批不需要改动

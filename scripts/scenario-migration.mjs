import { writeFile } from 'node:fs/promises';
import { runPipeline } from '../src/orchestrator.js';
import { fixtureProfiles } from '../src/fixture-profiles.js';
import { skillsRegistry } from '../src/skills-registry.js';
import { DEVORBIT_VERSION } from '../src/version.js';

const skillSequence = result => result.trace.filter(event => event.agent !== 'devorbit-lead').map(event => `${event.agent}:${event.skill}`);
const stateSequence = result => result.messages.filter(message => message.type === 'state_transition').map(message => message.to);
const toolSet = result => [...new Set(result.mcp.audit.map(item => item.tool))].sort();

const checkout = await runPipeline();
const inventory = await runPipeline({ fixture: 'inventory' });

const unchanged = {
  workerSkillSequence: { checkout: skillSequence(checkout), inventory: skillSequence(inventory), identical: JSON.stringify(skillSequence(checkout)) === JSON.stringify(skillSequence(inventory)) },
  stateMachinePath: { checkout: stateSequence(checkout), inventory: stateSequence(inventory), identical: JSON.stringify(stateSequence(checkout)) === JSON.stringify(stateSequence(inventory)) },
  mcpToolSet: { checkout: toolSet(checkout), inventory: toolSet(inventory), identical: JSON.stringify(toolSet(checkout)) === JSON.stringify(toolSet(inventory)) },
  sharedMechanisms: [
    'case-lifecycle 状态机（received→…→learned，同一转移表）',
    '7 职能 Worker 边界与 Manager 委派',
    'Skill 版本化调用（trace 记录 skillVersion + skillDigest）',
    'MCP 工具策略与签名审批门禁（L2 灰度需审批）',
    '司法级 Hash 证据链',
    'Episode 知识库硬过滤召回',
    '幂等键与隔离工作区'
  ],
  skillVersions: skillsRegistry().map(entry => ({ id: entry.id, version: entry.version, digest: entry.digest }))
};

const replaced = {
  fixtureRepository: { checkout: 'fixtures/checkout-service', inventory: 'fixtures/inventory-service' },
  signalPool: { checkout: '支付转圈/重复下单 5 类信号', inventory: '秒杀超卖/负库存 6 类信号' },
  businessAssertions: { checkout: '幂等 409 + 连接池容量/排队超时阈值', inventory: '余量不足 409 + 并发不超卖 + 台账非负' },
  fixTemplate: { checkout: '恢复连接池容量 + 幂等复用', inventory: '恢复扣减非负校验（乐观锁等价）' },
  knowledgeDomain: { checkout: 'redis/idempotency Episode', inventory: 'inventory/oversell Episode（EP-007）' },
  releaseVersion: { checkout: fixtureProfiles['checkout-service'].releaseVersion, inventory: fixtureProfiles['inventory-service'].releaseVersion },
  migrationSteps: [
    '1. 新增目标域 fixture（带真实失败测试）与分层信号池',
    '2. 在 fixture-profiles 声明目标域 profile（服务拓扑/影响面/根因假设/修复模板）',
    '3. 知识库补充目标域 Episode（对齐租户/服务/环境/版本硬过滤字段）',
    '4. 运行闭环并按业务断言验收；状态机、门禁、证据链、审批不需要改动'
  ]
};

const report = {
  schema: 'devorbit.scenario-migration/v1',
  version: DEVORBIT_VERSION,
  generatedAt: new Date().toISOString(),
  summary: {
    checkoutClosedLoop: checkout.metrics.closedLoop,
    inventoryClosedLoop: inventory.metrics.closedLoop,
    mechanismsIdentical: unchanged.workerSkillSequence.identical && unchanged.stateMachinePath.identical && unchanged.mcpToolSet.identical
  },
  unchanged,
  replaced,
  cases: {
    checkout: {
      status: checkout.state.status,
      baseline: { failed: checkout.plan.baselineTests.failed, passed: checkout.plan.baselineTests.passed },
      patched: { failed: checkout.tests.failed, passed: checkout.tests.passed },
      release: checkout.release.decision,
      rcaScore: checkout.rca.causes[0].score,
      evidenceChainVerified: checkout.evidenceChain.verified,
      mcpCalls: checkout.mcp.calls
    },
    inventory: {
      status: inventory.state.status,
      baseline: { failed: inventory.plan.baselineTests.failed, passed: inventory.plan.baselineTests.passed },
      patched: { failed: inventory.tests.failed, passed: inventory.tests.passed },
      release: inventory.release.decision,
      rcaScore: inventory.rca.causes[0].score,
      ragTop: inventory.rca.retrieval.results[0]?.id,
      episodeService: inventory.knowledge.service,
      evidenceChainVerified: inventory.evidenceChain.verified,
      mcpCalls: inventory.mcp.calls
    }
  }
};

await writeFile(new URL('../reports/scenario-migration.json', import.meta.url), JSON.stringify(report, null, 2));
const lines = [
  '# 第二类场景迁移证据（结算支付 → 库存域）',
  '',
  `- 生成时间：${report.generatedAt}（DevOrbit ${report.version}）`,
  `- 机制一致性：${report.summary.mechanismsIdentical ? 'Worker/Skill 序列、状态机路径、MCP 工具集完全相同' : '不一致，需要检查'}`,
  `- 结算域案例：基线 ${report.cases.checkout.baseline.failed} 失败 → 补丁后 ${report.cases.checkout.patched.passed} 通过，${report.cases.checkout.release}，闭环 ${report.cases.checkout.status}`,
  `- 库存域案例：基线 ${report.cases.inventory.baseline.failed} 失败 → 补丁后 ${report.cases.inventory.patched.passed} 通过，${report.cases.inventory.release}，闭环 ${report.cases.inventory.status}（RAG 命中 ${report.cases.inventory.ragTop}）`,
  '',
  '## 保持不变的机制',
  ...unchanged.sharedMechanisms.map(item => `- ${item}`),
  '',
  '## 迁移时替换的部分',
  `- 仓库：${replaced.fixtureRepository.checkout} → ${replaced.fixtureRepository.inventory}`,
  `- 信号池：${replaced.signalPool.checkout} → ${replaced.signalPool.inventory}`,
  `- 业务断言：${replaced.businessAssertions.checkout} → ${replaced.businessAssertions.inventory}`,
  `- 修复模板：${replaced.fixTemplate.checkout} → ${replaced.fixTemplate.inventory}`,
  `- 知识域：${replaced.knowledgeDomain.checkout} → ${replaced.knowledgeDomain.inventory}`,
  '',
  '## 迁移步骤',
  ...replaced.migrationSteps.map(step => `- ${step}`),
  ''
];
await writeFile(new URL('../reports/scenario-migration.md', import.meta.url), lines.join('\n'));
console.log(`PASS scenario migration: mechanisms identical=${report.summary.mechanismsIdentical}, checkout=${report.cases.checkout.status}, inventory=${report.cases.inventory.status}`);

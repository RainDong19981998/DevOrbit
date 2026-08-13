export const skills = [
  { id: 'signal-fusion', name: 'SignalFusion', type: '自定义 Skill', purpose: '多源缺陷、日志、反馈归并去重', input: 'signals[]', output: 'canonical_case', risk: '只读', reuse: '适用于缺陷、需求、告警聚合', version: '1.0.0' },
  { id: 'impact-map', name: 'ImpactMap', type: '代码分析 Skill', purpose: '建立模块、接口、版本和用户影响面', input: 'case + repo_index', output: 'impact_graph', risk: '只读', reuse: '适用于变更评估和回归选测', version: '1.0.0' },
  { id: 'evidence-rca', name: 'EvidenceRCA', type: '诊断 Skill', purpose: '基于时间窗口和代码证据生成根因候选', input: 'timeline + impact_graph + knowledge', output: 'ranked_causes[]', risk: '只读', reuse: '适用于生产缺陷和测试缺陷', version: '1.0.0' },
  { id: 'patch-plan', name: 'PatchPlan', type: '编码 Skill', purpose: '生成最小修复方案、补丁和回滚点', input: 'root_cause + repo_context', output: 'change_plan', risk: '写入沙箱', reuse: '适用于常见代码修复', version: '1.0.0' },
  { id: 'test-gate', name: 'TestGate', type: '验证 Skill', purpose: '选择测试集并汇总可复现验证证据', input: 'change_plan + impact_graph', output: 'test_report', risk: '执行沙箱命令', reuse: '适用于提交前和发布后验证', version: '1.0.0' },
  { id: 'release-guard', name: 'ReleaseGuard', type: '治理 Skill', purpose: '执行风险分级、审批、灰度、回滚和审计', input: 'change_plan + test_report + policy', output: 'release_decision', risk: '高风险需审批', reuse: '适用于所有受控发布', version: '1.0.0' },
  { id: 'knowledge-card', name: 'KnowledgeCard', type: '知识 Skill', purpose: '生成复盘卡片和可检索经验', input: 'full_trace + outcome', output: 'case_card', risk: '写入知识库', reuse: '跨团队沉淀研发知识', version: '1.0.0' },
  { id: 'alibabacloud-sls-query', name: 'SLS Query', type: '官方用云 Skill', purpose: '读取索引配置并生成、执行日志检索或分析查询', input: 'project + logstore + query_intent', output: 'logs + aggregates', risk: '云端只读 · 最小 RAM', reuse: 'intake/rca-worker；本地 Demo 使用 Fixture 回退', version: '0.0.2', official: true }
];

export function skillCatalog() { return skills.map(({ id, name, type, purpose, risk, reuse }) => ({ id, name, type, purpose, risk, reuse })); }

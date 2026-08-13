import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const learningAgent = {
  id: 'learning-worker',
  skill: 'KnowledgeCard',
  async execute(state, context) {
    const release = state.artifacts.release;
    const card = {
      cardId: `KB-${state.case_id.slice(-8)}`,
      outcome: release.decision,
      pattern: '连接池缩容 + 幂等重试放大',
      prevention: ['配置变更增加容量策略校验', '幂等存储增加水位告警', '重复提交回归加入发布门禁'],
      tags: ['redis', 'idempotency', 'checkout', state.scenario]
    };
    const persisted = await context.mcp.callTool('knowledge.write_case', { card, idempotencyKey: `${state.case_id}:knowledge` });
    const knowledge = { ...persisted.data.stored, mcpCall: persisted.call };
    mergeArtifact(state, 'knowledge', knowledge);
    transition(state, 'learned', `terminal outcome ${release.decision} recorded`);
    state.outcome = release.decision;
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'learn', parentSpanId: context.parentSpanId, message: `通过 MCP 知识工具写入 ${release.decision === 'rolled_back' ? '失败回滚' : '成功发布'}知识卡，关联补丁、测试、审批和灰度证据。`, evidence: [`knowledge://${knowledge.cardId}`, 'mcp://knowledge.write_case'], input: { release, traceId: state.trace_id }, output: knowledge });
    return knowledge;
  }
};

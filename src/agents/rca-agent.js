import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const rcaAgent = {
  id: 'rca-worker',
  skill: 'EvidenceRCA',
  async execute(state, context) {
    const weak = state.scenario === 'low-confidence';
    const ragEnabled = context.controls.rag !== false;
    const retrieval = ragEnabled ? await context.mcp.callTool('knowledge.search_cases', {
      query: `${state.incident.title} ${state.incident.signals.map(signal => signal.text).join(' ')}`,
      tags: ['checkout', 'redis', 'idempotency'],
      topK: 3
    }) : null;
    const historical = retrieval?.data.results || [];
    const topHistory = historical[0];
    const causes = [
      { rank: 1, statement: '连接池容量下降造成幂等存储排队超时，重试路径未复用已创建订单。', score: weak ? 0.62 : 0.91, evidence: weak ? ['LOG-10A'] : ['CHG-402', 'LOG-10A', 'METRIC-55', 'repo://src/redisPool.js', topHistory?.citation].filter(Boolean) },
      { rank: 2, statement: '支付调用超时阈值与订单重试策略不一致，可能放大尾延迟。', score: 0.58, evidence: ['ISSUE-771'] },
      { rank: 3, statement: '网关 502 是下游超时结果，不是首因。', score: 0.31, evidence: ['METRIC-55'] }
    ];
    const evidenceGateEnabled = context.controls.evidenceGate !== false;
    const blocked = weak && evidenceGateEnabled;
    const rca = { causes, threshold: 0.8, decision: blocked ? 'needs_human' : 'supported', missingEvidence: weak ? ['配置变更记录', '连接池水位指标'] : [], retrieval: { query: state.incident.title, results: historical, topScore: topHistory?.score || 0, cited: Boolean(topHistory), mcpCall: retrieval?.call || null } };
    mergeArtifact(state, 'rca', rca);
    transition(state, blocked ? 'needs_human' : 'diagnosed', blocked ? 'root cause confidence below policy' : 'root cause accepted by active evaluation policy');
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'rca', parentSpanId: context.parentSpanId, status: blocked ? 'needs_human' : 'completed', message: blocked ? 'RAG 检索到相似案例，但现场首因置信度仅 0.62；停止自动修复并请求补证。' : `${ragEnabled ? `RAG 命中 ${topHistory?.id || '无'}，` : '未启用历史检索，'}现场证据置信度 ${causes[0].score.toFixed(2)}。`, evidence: causes[0].evidence, input: { canonical: state.artifacts.canonical, impact: state.artifacts.impact }, output: rca });
    return rca;
  }
};

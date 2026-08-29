import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

const MAX_RESAMPLING_ROUNDS = 2;
const CONFIDENCE_THRESHOLD = 0.8;

function buildCauses(round, topHistory, scenario, profile) {
  if (scenario === 'dynamic-resampling' && round === 0) {
    return [
      { rank: 1, statement: '网关 502 可能是下游超时导致，需进一步确认根因服务。', score: 0.58, evidence: ['LOG-10A', 'METRIC-55', topHistory?.citation].filter(Boolean) },
      { rank: 2, statement: '订单接口 p95 飙升，疑似下游存储瓶颈。', score: 0.45, evidence: ['METRIC-55'] }
    ];
  }
  return [
    { rank: 1, statement: profile.rootCause.statement, score: scenario === 'low-confidence' ? 0.62 : 0.91, evidence: scenario === 'low-confidence' ? [profile.rootCause.evidence[1]] : [...profile.rootCause.evidence, topHistory?.citation].filter(Boolean) },
    ...profile.rootCause.runnerUp.map((cause, index) => ({ rank: index + 2, statement: cause.statement, score: cause.score, evidence: cause.evidence }))
  ];
}

export const rcaAgent = {
  id: 'rca-worker',
  skill: 'EvidenceRCA',
  async execute(state, context) {
    const ragEnabled = context.controls.rag !== false;
    const maxRounds = context.controls.maxResamplingRounds ?? MAX_RESAMPLING_ROUNDS;
    const resample = state.scenario === 'dynamic-resampling';
    const evidenceGateEnabled = context.controls.evidenceGate !== false;

    const resamplingTrace = [];
    let round = 0;
    let causes = [];
    let historical = [];
    let retrieval = null;
    let warnings = [];

    while (true) {
      const queryText = `${state.incident.title} ${state.incident.signals.map(signal => signal.text).join(' ')}`;
      retrieval = ragEnabled ? await context.mcp.callTool('knowledge.search_cases', {
        query: queryText,
        tags: context.profile.tags,
        topK: 3,
        context: { tenant: context.profile.tenant, service: context.profile.service, environment: context.profile.environment, gitRevision: context.profile.gitRevision, configRevision: state.incident.branch }
      }) : null;
      historical = retrieval?.data.results || [];
      warnings = retrieval?.data.warnings || [];
      const topHistory = historical[0];

      causes = buildCauses(round, topHistory, state.scenario, context.profile);
      const topScore = causes[0].score;

      if (topScore >= CONFIDENCE_THRESHOLD || round >= maxRounds || !resample) {
        break;
      }

      const plan = {
        round: round + 1,
        hypotheses: causes.map(c => ({ statement: c.statement, verdict: 'unconfirmed' })),
        missingEvidence: ['配置变更记录', '连接池水位指标', '微服务链路 Trace'],
        query: { granularity: 'deep', service: 'idempotency-store', timeWindow: '10:15:00-10:15:30' }
      };

      if (state.state === 'triaged') {
        transition(state, 'evidence_gathering', `resampling round ${round + 1}: confidence ${topScore.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`);
      }
      const deepResult = await context.mcp.callTool('observability.fetch_signals', {
        caseId: state.case_id, granularity: 'deep', service: plan.query.service
      });
      const deepSignals = deepResult.data.signals || [];
      state.evidence.push(...deepSignals.map(s => s.id).filter(id => !state.evidence.includes(id)));
      transition(state, 'triaged', `resampling round ${round + 1} complete: ${deepSignals.length} deep signals acquired`);

      resamplingTrace.push({ round: round + 1, plan, signalsAcquired: deepSignals.length, confidenceBefore: topScore, mcpCall: deepResult.call });
      round += 1;
    }

    const topHistory = historical[0];
    const topScore = causes[0]?.score || 0;
    const blocked = topScore < CONFIDENCE_THRESHOLD && evidenceGateEnabled;
    const rca = {
      causes,
      threshold: CONFIDENCE_THRESHOLD,
      decision: blocked ? 'needs_human' : 'supported',
      missingEvidence: blocked ? ['配置变更记录', '连接池水位指标'] : [],
      warnings,
      resampling: { rounds: round, maxRounds, trace: resamplingTrace, finalConfidence: topScore, escalated: resample && round >= maxRounds && topScore < CONFIDENCE_THRESHOLD },
      retrieval: { query: state.incident.title, results: historical, topScore: topHistory?.score || 0, cited: Boolean(topHistory), mcpCall: retrieval?.call || null }
    };
    mergeArtifact(state, 'rca', rca);
    transition(state, blocked ? 'needs_human' : 'diagnosed', blocked ? `root cause confidence ${topScore.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}` : `${ragEnabled ? `RAG 命中 ${topHistory?.id || '无'}，` : '未启用历史检索，'}${round > 0 ? `经 ${round} 轮动态补证后` : ''}现场证据置信度 ${topScore.toFixed(2)}。`);
    const message = blocked
      ? `RAG 检索到相似案例，但现场首因置信度仅 ${topScore.toFixed(2)}；${resample ? `动态补证 ${round}/${maxRounds} 轮后仍不达标，` : ''}停止自动修复并请求补证。`
      : round > 0
        ? `初始置信度不足，经 ${round} 轮动态补证反向拉取深层 Trace 与配置变更证据后，置信度升至 ${topScore.toFixed(2)}，根因确认。${warnings.length ? `负面方案召回：${warnings.map(w => w.warningMessage || w.title).join('; ')}，已自动规避。` : ''}`
        : `${ragEnabled ? `RAG 命中 ${topHistory?.id || '无'}，` : '未启用历史检索，'}现场证据置信度 ${topScore.toFixed(2)}。${warnings.length ? `负面方案召回：${warnings.map(w => w.warningMessage || w.title).join('; ')}，已自动规避。` : ''}`;
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'rca', parentSpanId: context.parentSpanId, status: blocked ? 'needs_human' : 'completed', message, evidence: causes[0]?.evidence || [], input: { canonical: state.artifacts.canonical, impact: state.artifacts.impact }, output: rca });
    return rca;
  }
};

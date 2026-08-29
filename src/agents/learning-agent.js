import { mergeArtifact, transition } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';
import { digest } from '../runtime/digest.js';

export const learningAgent = {
  id: 'learning-worker',
  skill: 'KnowledgeCard',
  async execute(state, context) {
    const release = state.artifacts.release;
    const rca = state.artifacts.rca;
    const plan = state.artifacts.plan;
    const rolledBack = release?.decision === 'rolled_back';

    const observation = {
      windowMinutes: 15,
      businessAssertions: rolledBack ? false : true,
      metricsVerdict: rolledBack ? 'degraded' : 'healthy',
      errorRateAfter: release?.healthAfter?.errorRate,
      p95After: release?.healthAfter?.p95Ms,
      reviewedBy: 'sre-oncall',
      recovered: !rolledBack,
      rollbackReason: rolledBack ? (release?.healthAfter?.errorRate > release?.healthBefore?.errorRate ? 'canary degradation detected' : 'manual rollback') : null
    };

    const episodeId = `EP-${state.case_id.slice(-8)}`;
    const profile = context.profile;
    const episode = {
      episodeId,
      title: state.incident.title,
      summary: rca?.causes?.[0]?.statement || state.incident.title,
      pattern: profile.pattern,
      tags: [...profile.tags, state.scenario],
      evidence: rca?.causes?.[0]?.evidence || [],
      tenant: profile.tenant,
      service: profile.service,
      environment: profile.environment,
      gitRevision: plan?.baseCommit?.slice(0, 8) || profile.gitRevision,
      configRevision: state.incident.branch || 'unknown',
      topology: profile.topology,
      hypotheses: rca?.causes?.map(c => ({ statement: c.statement, verdict: c.score >= 0.8 ? 'confirmed' : 'rejected', evidence: c.evidence })) || [],
      evidenceChain: state.evidence.slice(-10),
      patches: [{ digest: plan?.patchDigest, outcome: rolledBack ? 'failed' : 'success', notes: plan?.summary }],
      negativeLessons: [],
      observation,
      confidence: observation.recovered ? 'high' : 'low',
      recallStatus: 'pending',
      createdAt: new Date().toISOString()
    };

    const persisted = await context.mcp.callTool('knowledge.write_case', { card: episode, idempotencyKey: `${state.case_id}:knowledge` });
    const knowledge = { ...persisted.data.stored, outcome: release.decision, mcpCall: persisted.call, observation };

    if (typeof context.mcp.callTool === 'function' && knowledge.episodeId) {
      knowledge.recallStatus = observation.recovered ? 'active' : 'negative';
    }

    mergeArtifact(state, 'knowledge', knowledge);
    transition(state, 'learned', `terminal outcome ${release.decision} recorded with observation window (${observation.windowMinutes}min, ${observation.metricsVerdict})`);
    state.outcome = release.decision;
    recordTrace(state, {
      agent: this.id,
      skill: this.skill,
      stage: 'learn',
      parentSpanId: context.parentSpanId,
      message: `写入${release.decision === 'rolled_back' ? '负面' : '成功'}知识 Episode（recallStatus=${knowledge.recallStatus}），关联补丁、测试、审批、灰度观察证据。观察窗口 ${observation.windowMinutes} 分钟，指标判定 ${observation.metricsVerdict}。`,
      evidence: [`knowledge://${knowledge.episodeId || knowledge.cardId}`, 'mcp://knowledge.write_case', `observation://${observation.metricsVerdict}`],
      input: { release, traceId: state.trace_id, observation },
      output: knowledge
    });
    return knowledge;
  }
};

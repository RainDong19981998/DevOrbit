import { digest } from './digest.js';
import { resolveSkillRef } from '../skills-registry.js';

export function recordTrace(state, { agent, skill, stage, status = 'completed', message, evidence = [], input, output, parentSpanId = null }) {
  const spanId = `SPAN-${String(state.trace.length + 1).padStart(3, '0')}`;
  const durationMs = 8 + state.trace.length * 3;
  const skillRef = resolveSkillRef(skill);
  const event = {
    traceId: state.trace_id,
    spanId,
    parentSpanId,
    at: new Date(Date.now() + state.trace.length * 1000).toISOString(),
    agent,
    skill,
    skillVersion: skillRef?.version || null,
    skillDigest: skillRef?.digest || null,
    stage,
    status,
    message,
    evidence,
    durationMs,
    inputDigest: digest(input || {}),
    outputDigest: digest(output || {})
  };
  state.trace.push(event);
  state.evidence.push(...evidence.filter(item => !state.evidence.includes(item)));
  return event;
}

export function recordDispatch(state, worker, stage, input) {
  const event = recordTrace(state, {
    agent: 'devorbit-lead',
    skill: 'case-orchestration',
    stage,
    status: 'dispatched',
    message: `委派 ${stage} 任务给 ${worker}，共享 Case State 版本 ${state.messages.length + 1}。`,
    evidence: [`state://${state.case_id}/${state.state}`],
    input,
    output: { worker, stage }
  });
  state.messages.push({ type: 'task', from: 'devorbit-lead', to: worker, stage, spanId: event.spanId });
  return event.spanId;
}

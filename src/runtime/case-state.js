import { randomUUID } from 'node:crypto';

export const terminalStates = new Set(['learned', 'needs_human']);
const allowedTransitions = new Map([
  ['received', new Set(['triaged'])],
  ['triaged', new Set(['diagnosed', 'needs_human'])],
  ['diagnosed', new Set(['planned'])],
  ['planned', new Set(['verified', 'needs_human'])],
  ['verified', new Set(['approval_pending', 'canary', 'needs_human'])],
  ['approval_pending', new Set(['canary', 'needs_human'])],
  ['canary', new Set(['confirmed', 'rolled_back'])],
  ['confirmed', new Set(['learned'])],
  ['rolled_back', new Set(['learned'])]
]);

export function createCaseState(incident, scenario) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  return {
    case_id: `CASE-${suffix}`,
    trace_id: `TRACE-${randomUUID()}`,
    state: 'received',
    revision: 1,
    scenario,
    incident,
    risk_level: 'L0',
    evidence: incident.signals.map(signal => signal.id),
    artifacts: {},
    decisions: [],
    messages: [],
    trace: [],
    outcome: null
  };
}

export function mergeArtifact(state, key, value) {
  state.artifacts[key] = value;
  return value;
}

export function transition(state, nextState, reason) {
  const from = state.state;
  if (!allowedTransitions.get(from)?.has(nextState)) throw new Error(`illegal case transition: ${from} -> ${nextState}`);
  state.state = nextState;
  state.revision += 1;
  state.messages.push({ type: 'state_transition', from, to: nextState, reason, revision: state.revision });
}

export function assertCaseState(state) {
  if (!state.case_id?.startsWith('CASE-')) throw new Error('invalid case_id');
  if (!state.trace_id?.startsWith('TRACE-')) throw new Error('invalid trace_id');
  if (!Array.isArray(state.incident?.signals) || !Array.isArray(state.evidence)) throw new Error('invalid case collections');
  if (!['L0', 'L1', 'L2', 'L3'].includes(state.risk_level)) throw new Error('invalid risk level');
  if (!Number.isInteger(state.revision) || state.revision < 1) throw new Error('invalid state revision');
  return true;
}

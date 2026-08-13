import { createHash } from 'node:crypto';
import { DEVORBIT_VERSION } from '../version.js';

const SCHEMA_URL = 'https://opentelemetry.io/schemas/1.37.0';

function hex(value, length) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function unixNano(value) {
  return String(BigInt(new Date(value).getTime()) * 1000000n);
}

function attributes(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => ({
    key,
    value: typeof value === 'boolean' ? { boolValue: value } : typeof value === 'number' ? { intValue: String(value) } : { stringValue: String(value) }
  }));
}

function span({ traceId, spanId, parentSpanId, name, start, durationMs, status, attrs }) {
  const startNs = BigInt(unixNano(start));
  return {
    traceId: hex(traceId, 32),
    spanId: hex(spanId, 16),
    ...(parentSpanId ? { parentSpanId: hex(parentSpanId, 16) } : {}),
    name,
    kind: 1,
    startTimeUnixNano: String(startNs),
    endTimeUnixNano: String(startNs + BigInt(Math.max(1, durationMs)) * 1000000n),
    attributes: attributes(attrs),
    status: { code: status === 'error' || status === 'denied' ? 2 : 1 }
  };
}

export function buildOpenTelemetry(state, audit = [], { environment = process.env.DEVORBIT_ENVIRONMENT || 'local-fixture' } = {}) {
  const agentSpans = state.trace.map(item => span({
    traceId: item.traceId,
    spanId: item.spanId,
    parentSpanId: item.parentSpanId,
    name: item.agent === 'devorbit-lead' ? `orchestrate ${item.stage}` : `invoke_agent ${item.agent}`,
    start: item.at,
    durationMs: item.durationMs,
    status: item.status,
    attrs: {
      'gen_ai.operation.name': item.agent === 'devorbit-lead' ? 'orchestrate' : 'invoke_agent',
      'gen_ai.agent.name': item.agent,
      'devorbit.skill.name': item.skill,
      'devorbit.case.id': state.case_id,
      'devorbit.case.state': state.state,
      'devorbit.evidence.count': item.evidence.length,
      'devorbit.input.digest': item.inputDigest,
      'devorbit.output.digest': item.outputDigest
    }
  }));
  const toolSpans = audit.map((item, index) => span({
    traceId: item.traceId || state.trace_id,
    spanId: item.auditRef || `tool-${index}`,
    parentSpanId: item.parentSpanId,
    name: `execute_tool ${item.tool}`,
    start: item.at,
    durationMs: item.durationMs,
    status: item.status,
    attrs: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.agent.name': item.caller,
      'gen_ai.tool.name': item.tool,
      'devorbit.case.id': item.caseId,
      'devorbit.tool.risk_level': item.risk,
      'devorbit.policy.decision': item.policyDecision,
      'devorbit.audit.ref': item.auditRef,
      'devorbit.input.digest': item.inputDigest,
      'devorbit.output.digest': item.outputDigest,
      'devorbit.idempotency.replayed': item.status === 'replayed'
    }
  }));
  const allSpans = [...agentSpans, ...toolSpans];
  const resourceAttributes = attributes({ 'service.name': 'devorbit', 'service.version': DEVORBIT_VERSION, 'deployment.environment.name': environment });
  const metricValues = {
    'devorbit.agent.invocations': agentSpans.filter(item => item.attributes.some(attribute => attribute.key === 'gen_ai.operation.name' && attribute.value.stringValue === 'invoke_agent')).length,
    'devorbit.tool.calls': toolSpans.length,
    'devorbit.policy.denials': audit.filter(item => item.policyDecision === 'deny').length,
    'devorbit.evidence.references': new Set(state.evidence).size,
    'devorbit.human.approvals': state.artifacts.approval?.state === 'approved' ? 1 : 0
  };
  return {
    schemaUrl: SCHEMA_URL,
    resourceSpans: [{ resource: { attributes: resourceAttributes }, scopeSpans: [{ scope: { name: 'devorbit.runtime', version: DEVORBIT_VERSION }, spans: allSpans }] }],
    resourceMetrics: [{ resource: { attributes: resourceAttributes }, scopeMetrics: [{ scope: { name: 'devorbit.runtime', version: DEVORBIT_VERSION }, metrics: Object.entries(metricValues).map(([name, value]) => ({ name, unit: '1', gauge: { dataPoints: [{ asInt: String(value), timeUnixNano: unixNano(new Date()) }] } })) }] }],
    summary: { spans: allSpans.length, agentSpans: agentSpans.length, toolSpans: toolSpans.length, metrics: metricValues }
  };
}

export { SCHEMA_URL as OTEL_SCHEMA_URL };

import { randomUUID } from 'node:crypto';
import { digest } from '../runtime/digest.js';
import { MCP_PROTOCOL_VERSION, negotiateProtocolVersion, rpcError, rpcResult } from './protocol.js';
import { DEVORBIT_VERSION } from '../version.js';

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function validateSchema(value, schema, path = '$') {
  const types = Array.isArray(schema?.type) ? schema.type : [schema?.type].filter(Boolean);
  if (types.length && !types.some(type => typeMatches(value, type))) return `${path} must be ${types.join(' or ')}`;
  if (schema?.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const missing = (schema.required || []).filter(key => value[key] === undefined);
    if (missing.length) return `${path} missing ${missing.join(', ')}`;
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).filter(key => !Object.hasOwn(schema.properties || {}, key));
      if (unknown.length) return `${path} has unknown ${unknown.join(', ')}`;
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      const error = validateSchema(value[key], child, `${path}.${key}`);
      if (error) return error;
    }
  }
  if (Array.isArray(value) && schema?.items) {
    for (let index = 0; index < value.length; index++) {
      const error = validateSchema(value[index], schema.items, `${path}[${index}]`);
      if (error) return error;
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) return `${path} must be >= ${schema.minimum}`;
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) return `${path} must be <= ${schema.maximum}`;
  return null;
}

export class McpToolServer {
  constructor({ name = 'devorbit-tools', version = DEVORBIT_VERSION, tools = [], policy = null } = {}) {
    this.name = name;
    this.version = version;
    this.tools = new Map(tools.map(tool => [tool.name, tool]));
    this.audit = [];
    this.idempotencyCache = new Map();
    this.policy = policy;
  }

  definitions() {
    return [...this.tools.values()].map(({ handler, ...definition }) => definition);
  }

  async dispatch(message, context = {}) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Invalid Request');
    if (message.method === 'initialize') {
      const protocolVersion = context.protocolVersion || negotiateProtocolVersion(message.params?.protocolVersion);
      return rpcResult(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: this.name, version: this.version }
      });
    }
    if (message.method === 'notifications/initialized') return null;
    if (message.method === 'tools/list') return rpcResult(message.id, { tools: this.definitions() });
    if (message.method !== 'tools/call') return rpcError(message.id, -32601, 'Method not found');

    const name = message.params?.name;
    const args = message.params?.arguments || {};
    const tool = this.tools.get(name);
    if (!tool) return rpcError(message.id, -32602, `Unknown tool: ${name}`);
    const inputError = validateSchema(args, tool.inputSchema);
    if (inputError) return rpcError(message.id, -32602, `Invalid tool arguments: ${inputError}`);

    const started = Date.now();
    const at = new Date().toISOString();
    const auditRef = `audit://${randomUUID()}`;
    const protocolVersion = context.protocolVersion || MCP_PROTOCOL_VERSION;
    const authorization = this.policy?.authorize({ tool: name, args, context }) || { ok: true, risk: tool.annotations?.readOnlyHint ? 'L0' : 'L1' };
    if (!authorization.ok) {
      const structuredContent = { error: 'policy denied tool call', reason: authorization.reason, auditRef };
      this.audit.push({ auditRef, at, parentSpanId: context.parentSpanId || null, protocolVersion, method: 'tools/call', tool: name, caller: context.agent || 'anonymous', traceId: context.traceId || null, caseId: context.caseId || null, durationMs: Date.now() - started, inputDigest: digest(args), outputDigest: digest(structuredContent), idempotencyKey: args.idempotencyKey || null, risk: authorization.risk, policyDecision: 'deny', status: 'denied' });
      return rpcResult(message.id, { content: [{ type: 'text', text: structuredContent.error }], structuredContent, isError: true });
    }
    const cacheKey = args.idempotencyKey ? `${name}:${args.idempotencyKey}` : null;
    if (cacheKey && this.idempotencyCache.has(cacheKey)) {
      const result = structuredClone(this.idempotencyCache.get(cacheKey));
      this.audit.push({ auditRef, at, parentSpanId: context.parentSpanId || null, protocolVersion, method: 'tools/call', tool: name, caller: context.agent || 'anonymous', traceId: context.traceId || null, caseId: context.caseId || null, durationMs: Date.now() - started, inputDigest: digest(args), outputDigest: digest(result.structuredContent), idempotencyKey: args.idempotencyKey, risk: authorization.risk, policyDecision: 'allow', status: 'replayed' });
      return rpcResult(message.id, result);
    }
    try {
      const structuredContent = await tool.handler(args, context);
      const outputError = validateSchema(structuredContent, tool.outputSchema);
      if (outputError) throw new Error(`tool output schema violation: ${outputError}`);
      const result = { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false };
      this.audit.push({ auditRef, at, parentSpanId: context.parentSpanId || null, protocolVersion, method: 'tools/call', tool: name, caller: context.agent || 'anonymous', traceId: context.traceId || null, caseId: context.caseId || null, durationMs: Date.now() - started, inputDigest: digest(args), outputDigest: digest(structuredContent), idempotencyKey: args.idempotencyKey || null, risk: authorization.risk, policyDecision: 'allow', approvalId: authorization.approval?.approvalId || null, status: 'ok' });
      if (cacheKey) this.idempotencyCache.set(cacheKey, structuredClone(result));
      return rpcResult(message.id, result);
    } catch (error) {
      const structuredContent = { error: error.message, auditRef };
      this.audit.push({ auditRef, at, parentSpanId: context.parentSpanId || null, protocolVersion, method: 'tools/call', tool: name, caller: context.agent || 'anonymous', traceId: context.traceId || null, caseId: context.caseId || null, durationMs: Date.now() - started, inputDigest: digest(args), outputDigest: digest(structuredContent), idempotencyKey: args.idempotencyKey || null, risk: authorization.risk, policyDecision: 'allow', status: 'error' });
      return rpcResult(message.id, { content: [{ type: 'text', text: error.message }], structuredContent, isError: true });
    }
  }
}

export { validateSchema };

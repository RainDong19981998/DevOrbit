import { randomUUID } from 'node:crypto';
import { MCP_PROTOCOL_VERSION } from './protocol.js';
import { DEVORBIT_VERSION } from '../version.js';

export class EmbeddedMcpClient {
  constructor(server, context = {}) {
    this.server = server;
    this.context = context;
    this.id = 0;
    this.sessionId = randomUUID();
    this.initialized = false;
    this.calls = [];
  }

  forAgent(agent, state, parentSpanId = null) {
    return new EmbeddedMcpClient(this.server, { agent, traceId: state.trace_id, caseId: state.case_id, parentSpanId });
  }

  async request(method, params = {}) {
    const response = await this.server.dispatch({ jsonrpc: '2.0', id: ++this.id, method, params }, this.context);
    if (response?.error) throw new Error(response.error.message);
    return response?.result;
  }

  async initialize() {
    if (this.initialized) return;
    const result = await this.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'devorbit-worker-client', version: DEVORBIT_VERSION } });
    if (result.protocolVersion !== MCP_PROTOCOL_VERSION) throw new Error('MCP protocol negotiation failed');
    await this.server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, this.context);
    this.initialized = true;
  }

  async listTools() {
    await this.initialize();
    return (await this.request('tools/list')).tools;
  }

  async callTool(name, args) {
    await this.initialize();
    const started = Date.now();
    const result = await this.request('tools/call', { name, arguments: args });
    const call = { protocol: 'MCP', protocolVersion: MCP_PROTOCOL_VERSION, transport: 'embedded-jsonrpc', tool: name, durationMs: Date.now() - started, isError: Boolean(result.isError) };
    this.calls.push(call);
    if (result.isError) throw new Error(result.structuredContent?.error || result.content?.[0]?.text || 'MCP tool failed');
    return { data: result.structuredContent, call };
  }
}

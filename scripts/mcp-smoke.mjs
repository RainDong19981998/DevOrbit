import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.MCP_SMOKE_PORT || 4192);
const url = `http://127.0.0.1:${port}/mcp`;
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
const accept = 'application/json, text/event-stream';

async function post(message, sessionId, extra = {}) {
  const response = await fetch(url, { method: 'POST', headers: { accept, 'content-type': 'application/json', 'x-devorbit-agent': 'rca-worker', 'x-trace-id': 'TRACE-SMOKE', 'x-case-id': 'CASE-SMOKE', ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } : {}), ...extra }, body: JSON.stringify(message) });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/meta`); if (r.ok) break; } catch {}
    await delay(100);
  }
  const blocked = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }, null, { origin: 'https://attacker.example' });
  if (blocked.response.status !== 403) throw new Error('Origin validation failed');
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
  const sessionId = init.response.headers.get('mcp-session-id');
  if (!sessionId || init.data.result.protocolVersion !== '2025-06-18') throw new Error('initialization failed');
  const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  if (notification.response.status !== 202) throw new Error('notification handling failed');
  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sessionId);
  if (list.data.result.tools.length !== 10 || !list.data.result.tools.some(tool => tool.name === 'knowledge.search_cases') || !list.data.result.tools.some(tool => tool.name === 'repository.dispose_workspace')) throw new Error('tool discovery failed');
  const call = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'knowledge.search_cases', arguments: { query: 'Redis 连接池 幂等 重复订单', tags: ['checkout'], topK: 2 } } }, sessionId);
  if (call.data.result.isError || call.data.result.structuredContent.results[0].id !== 'KB-HIST-001') throw new Error('structured tool result failed');
  const unknown = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'missing.tool', arguments: {} } }, sessionId);
  if (unknown.data.error?.code !== -32602) throw new Error('unknown tool error failed');
  const forgedCanary = await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'release.canary', arguments: { caseId: 'CASE-SMOKE', version: 'rc1', approvalId: 'APR-SMOKE', approvalToken: 'forged', idempotencyKey: 'same-key', regressed: false } } }, sessionId);
  if (!forgedCanary.data.result.isError || forgedCanary.data.result.structuredContent.reason !== 'agent rca-worker is not allowed to call release.canary') throw new Error('tool authorization guard failed');
  const identitySwitch = await post({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} }, sessionId, { 'x-devorbit-agent': 'release-worker' });
  if (identitySwitch.response.status !== 403) throw new Error('session identity binding failed');
  const impactInit = await post({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'impact-smoke', version: '1' } } }, null, { 'x-devorbit-agent': 'impact-worker' });
  const impactSessionId = impactInit.response.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, impactSessionId, { 'x-devorbit-agent': 'impact-worker' });
  const traversal = await post({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'repository.read_file', arguments: { path: '../../etc/passwd' } } }, impactSessionId, { 'x-devorbit-agent': 'impact-worker' });
  if (!traversal.data.result.isError || !traversal.data.result.structuredContent.error.includes('escapes workspace')) throw new Error('workspace traversal guard failed');
  const deleted = await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
  if (deleted.status !== 204) throw new Error('session deletion failed');
  console.log('PASS MCP 2025-06-18 Streamable HTTP: origin, bound identity, discovery, policy denial, errors');
} finally {
  child.kill('SIGTERM');
}

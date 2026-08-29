import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.SECURITY_SMOKE_PORT || 4193);
const base = `http://127.0.0.1:${port}`;
const token = 'control-plane-security-smoke';
const server = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    DEVORBIT_ADAPTER_BASE_URL: 'http://127.0.0.1:9',
    DEVORBIT_ADAPTER_TOKEN: 'outbound-adapter-token',
    DEVORBIT_CONTROL_TOKEN: token
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += chunk; });

async function expectStartupFailure(env, message) {
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port + 1), ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  if (child.exitCode === 0 || !error.includes(message)) throw new Error(`startup did not fail closed: ${message}`);
}

try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  if (!ready) throw new Error(`server did not become ready: ${stderr}`);

  await expectStartupFailure({ HOST: '0.0.0.0', DEVORBIT_CONTROL_TOKEN: '', DEVORBIT_ADAPTER_BASE_URL: '', DEVORBIT_ADAPTER_TOKEN: '' }, 'required when listening on a non-loopback host');
  await expectStartupFailure({ HOST: '127.0.0.1', DEVORBIT_CONTROL_TOKEN: 'same-token', DEVORBIT_ADAPTER_BASE_URL: 'http://127.0.0.1:9', DEVORBIT_ADAPTER_TOKEN: 'same-token' }, 'tokens must be different');

  const unauthorized = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (unauthorized.status !== 401) throw new Error(`unauthorized control request returned ${unauthorized.status}`);
  const unauthorizedAudit = await fetch(`${base}/api/mcp/audit`);
  if (unauthorizedAudit.status !== 401) throw new Error(`unauthorized MCP audit returned ${unauthorizedAudit.status}`);
  const audit = await fetch(`${base}/api/mcp/audit?after=0`, { headers: { authorization: `Bearer ${token}` } });
  const auditBody = await audit.json();
  if (audit.status !== 200 || auditBody.total !== 0 || auditBody.audit.length !== 0 || !auditBody.protocolVersions.includes('2025-11-25')) throw new Error('authorized MCP audit contract failed');

  const page = await fetch(`${base}/`);
  if (page.headers.get('content-security-policy') !== "default-src 'self'; base-uri 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'") throw new Error('strict CSP is missing');
  if (page.headers.get('x-content-type-options') !== 'nosniff' || page.headers.get('x-frame-options') !== 'DENY') throw new Error('browser hardening headers are missing');

  const oneShot = await fetch(`${base}/api/run`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  if (oneShot.status !== 403 || !(await oneShot.json()).error.includes('disabled')) throw new Error('one-shot approval bypass was not disabled');

  const mcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) });
  if (mcp.status !== 401) throw new Error(`unauthorized MCP request returned ${mcp.status}`);

  const traversal = await fetch(`${base}/docs/参赛方案.md`);
  if (traversal.status !== 404) throw new Error(`non-public static resource returned ${traversal.status}`);
  const prefixedTraversal = await fetch(`${base}/app/../config/tool-policy.json`);
  if (prefixedTraversal.status !== 404) throw new Error(`prefixed static traversal returned ${prefixedTraversal.status}`);

  const oversized = await fetch(`${base}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 1) }) });
  if (oversized.status !== 413) throw new Error(`oversized body returned ${oversized.status}`);

  console.log('PASS API security smoke: auth, audit, CSP, approval bypass, MCP, static allowlist, body limit');
} finally {
  server.kill('SIGTERM');
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

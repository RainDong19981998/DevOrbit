import http from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpProviders } from '../src/adapters/http.js';
import { KnowledgeStore } from '../src/knowledge/store.js';
import { DeliveryManager } from '../src/runtime/manager.js';
import { digest } from '../src/runtime/digest.js';
import { runNodeTests } from '../src/runtime/test-runner.js';
import { getDemoCase } from '../src/orchestrator.js';

const fixturePath = fileURLToPath(new URL('../fixtures/checkout-service', import.meta.url));
const workspaces = new Map();
const knowledge = new KnowledgeStore();
const events = [];
const retryCounts = new Map();
const token = 'adapter-contract-token';

function within(root, path) {
  const base = resolve(root);
  const target = resolve(base, path);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('path escapes remote workspace');
  return target;
}

function send(res, status, value, extra = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-request-id': `REQ-${events.length}`, ...extra });
  res.end(body);
}

async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 1024 * 1024) throw new Error('request too large');
  }
  return value ? JSON.parse(value) : {};
}

async function handler(req, res) {
  try {
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: { code: 'unauthorized' } });
    const input = await body(req);
    const idempotencyKey = req.headers['idempotency-key'] || null;
    events.push({
      method: req.method,
      path: req.url,
      idempotencyKey,
      authorization: req.headers.authorization,
      operation: req.headers['x-devorbit-operation'],
      caseId: req.headers['x-devorbit-case-id'],
      traceId: req.headers['x-devorbit-trace-id'],
      agent: req.headers['x-devorbit-agent'],
      input
    });

    if (req.url === '/v1/issue/signals') {
      const attempts = (retryCounts.get('issue-read') || 0) + 1;
      retryCounts.set('issue-read', attempts);
      if (attempts === 1) return send(res, 503, { error: { code: 'transient_issue_backend' } });
      const signals = getDemoCase().signals.filter(signal => ['Issue', '用户反馈'].includes(signal.source));
      return send(res, 200, { signals, sourceCount: 2 });
    }
    if (req.url === '/v1/observability/signals') {
      const signals = getDemoCase().signals.filter(signal => !['Issue', '用户反馈'].includes(signal.source));
      return send(res, 200, { signals, sourceCount: 3 });
    }
    if (req.url === '/v1/repository/workspaces') {
      if (!idempotencyKey) return send(res, 400, { error: { code: 'idempotency_required' } });
      const attempts = (retryCounts.get(idempotencyKey) || 0) + 1;
      retryCounts.set(idempotencyKey, attempts);
      if (attempts === 1) return send(res, 503, { error: { code: 'transient_workspace_backend' } });
      const workspace = await mkdtemp(`${tmpdir()}${sep}devorbit-http-adapter-`);
      await cp(fixturePath, workspace, { recursive: true });
      workspaces.set(input.workspaceId, workspace);
      return send(res, 200, { workspaceId: input.workspaceId });
    }
    if (req.url === '/v1/repository/file' && req.method === 'POST') {
      const root = input.workspaceId ? workspaces.get(input.workspaceId) : fixturePath;
      if (!root) return send(res, 404, { error: { code: 'workspace_not_found' } });
      const content = await readFile(within(root, input.path), 'utf8');
      return send(res, 200, { path: input.path, content, digest: `sha256:${digest(content)}` });
    }
    if (req.url === '/v1/repository/file' && req.method === 'PUT') {
      if (!idempotencyKey) return send(res, 400, { error: { code: 'idempotency_required' } });
      const root = workspaces.get(input.workspaceId);
      if (!root) return send(res, 404, { error: { code: 'workspace_not_found' } });
      const target = within(root, input.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.content);
      return send(res, 200, { path: input.path, digest: `sha256:${digest(input.content)}` });
    }
    if (req.url === '/v1/repository/workspaces/dispose') {
      const root = workspaces.get(input.workspaceId);
      if (root) await rm(root, { recursive: true, force: true });
      workspaces.delete(input.workspaceId);
      return send(res, 200, { workspaceId: input.workspaceId, disposed: true });
    }
    if (req.url === '/v1/ci/tests') {
      const root = workspaces.get(input.workspaceId);
      if (!root) return send(res, 404, { error: { code: 'workspace_not_found' } });
      return send(res, 200, runNodeTests(root));
    }
    if (req.url === '/v1/knowledge/search') {
      const results = knowledge.search(input);
      return send(res, 200, { results, count: results.length, indexSize: knowledge.size() });
    }
    if (req.url === '/v1/knowledge/cases') {
      const stored = knowledge.write(input.card);
      return send(res, 200, { stored, indexSize: knowledge.size() });
    }
    if (req.url === '/v1/release/canary') {
      return send(res, 200, {
        decision: input.regressed ? 'rolled_back' : 'promoted',
        rollbackExecuted: Boolean(input.regressed),
        healthBefore: { errorRate: 7.4, p95Ms: 2800 },
        healthAfter: input.regressed ? { errorRate: 9.1, p95Ms: 3400 } : { errorRate: 0.3, p95Ms: 460 },
        canary: '10%',
        observationWindow: '5m'
      });
    }
    return send(res, 404, { error: { code: 'not_found' } });
  } catch (error) {
    return send(res, 500, { error: { code: 'stub_error', message: error.message } });
  }
}

const server = http.createServer(handler);
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
const address = server.address();

try {
  const providers = createHttpProviders({ baseUrl: `http://127.0.0.1:${address.port}`, token, timeoutMs: 3000, maxRetries: 2, sleep: async () => {} });
  const manager = new DeliveryManager({ incident: getDemoCase(), approvalState: 'approved', providers });
  const result = await manager.run();
  const expectedPaths = ['/v1/issue/signals', '/v1/observability/signals', '/v1/repository/workspaces', '/v1/repository/file', '/v1/ci/tests', '/v1/knowledge/search', '/v1/knowledge/cases', '/v1/release/canary', '/v1/repository/workspaces/dispose'];
  const writePaths = new Set(['/v1/repository/workspaces', '/v1/ci/tests', '/v1/knowledge/cases', '/v1/release/canary', '/v1/repository/workspaces/dispose']);
  const writes = events.filter(event => event.method === 'PUT' || writePaths.has(event.path));
  const releaseRequest = events.find(event => event.path === '/v1/release/canary');
  const checks = [
    ['external pipeline closed', result.state.status === 'learned' && result.release.decision === 'promoted'],
    ['remote tests red to green', result.plan.baselineTests.failed === 3 && result.tests.passed === 4],
    ['all adapter domains used', expectedPaths.every(path => events.some(event => event.path === path))],
    ['bearer authentication propagated', events.every(event => event.authorization === `Bearer ${token}`)],
    ['semantic read POST safely retried', retryCounts.get('issue-read') === 2],
    ['idempotent write 503 safely retried', retryCounts.get(`${result.state.caseId}:workspace`) === 2],
    ['all writes have idempotency keys', writes.length === 9 && writes.every(event => Boolean(event.idempotencyKey))],
    ['correlation context propagated', events.every(event => event.caseId === result.state.caseId && event.traceId === result.state.traceId && event.agent)],
    ['internal approval token not forwarded', releaseRequest?.input?.approvalToken === undefined && releaseRequest?.input?.approvalId === result.approval.approvalId],
    ['remote workspace disposed', workspaces.size === 0],
    ['MCP audit remains authoritative', result.mcp.calls === 15 && result.mcp.audit.every(item => item.policyDecision === 'allow')]
  ];
  for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  else console.log(`PASS external Adapter SPI contract: ${events.length} HTTP requests, two safe retries, 15 MCP audits`);
} finally {
  await Promise.all([...workspaces.values()].map(path => rm(path, { recursive: true, force: true })));
  await new Promise(resolve => server.close(resolve));
}

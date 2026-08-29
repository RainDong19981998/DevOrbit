import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline, getDemoCase, getCaseForFixture } from './src/orchestrator.js';
import { DeliveryManager } from './src/runtime/manager.js';
import { FileCaseStateStore } from './src/runtime/state-store.js';
import { fixturePathForRepository } from './src/fixture-profiles.js';
import { skills } from './src/skills.js';
import { adapters } from './src/adapters.js';
import { EpisodeStore } from './src/knowledge/episode-store.js';
import { McpToolServer } from './src/mcp/tool-server.js';
import { createTools } from './src/mcp/tools.js';
import { createStreamableHttpHandler } from './src/mcp/http-transport.js';
import { fileURLToPath as toPath } from 'node:url';
import { ApprovalAuthority, ToolPolicy } from './src/security/tool-policy.js';
import { createHttpProvidersFromEnv } from './src/adapters/http.js';
import { createNativePlatformProvidersFromEnv } from './src/adapters/platforms.js';
import { DEVORBIT_VERSION, MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from './src/version.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(root, 'app');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const maxBodyBytes = 1024 * 1024;
const controlToken = process.env.DEVORBIT_CONTROL_TOKEN || null;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml' };
const securityHeaders = {
  'content-security-policy': "default-src 'self'; base-uri 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};
const publicReports = new Set(['/reports/evaluation.json', '/reports/security-evaluation.json', '/reports/public-benchmark.json', '/reports/model-ablation.json']);
const sessions = new Map();
const stateStore = new FileCaseStateStore(resolve(root, 'reports', 'runs', 'state'));
const runtimeKnowledgeStore = new EpisodeStore();
const mcpApprovalAuthority = new ApprovalAuthority();
const nativePlatformProviders = createNativePlatformProvidersFromEnv();
const externalProviders = nativePlatformProviders || createHttpProvidersFromEnv();
const outboundToken = nativePlatformProviders ? process.env.DEVORBIT_PLATFORM_TOKEN : process.env.DEVORBIT_ADAPTER_TOKEN;
const loopbackHost = ['127.0.0.1', 'localhost', '::1'].includes(host);
if (!loopbackHost && !controlToken) throw new Error('DEVORBIT_CONTROL_TOKEN is required when listening on a non-loopback host');
if (externalProviders && !outboundToken) throw new Error('an outbound adapter or platform token is required when external providers are enabled');
if (externalProviders && !controlToken) throw new Error('DEVORBIT_CONTROL_TOKEN is required when external adapters are enabled');
if (externalProviders && controlToken === outboundToken) throw new Error('control-plane and outbound provider tokens must be different');
const mcpServer = new McpToolServer({ tools: createTools({ fixturePath: toPath(new URL('./fixtures/checkout-service', import.meta.url)), workspaceRegistry: new Map(), knowledgeStore: new EpisodeStore(), signals: getDemoCase().signals, providers: externalProviders || {} }), policy: new ToolPolicy({ approvalAuthority: mcpApprovalAuthority }) });
const handleMcp = createStreamableHttpHandler(mcpServer, { maxBodyBytes });

function authorized(req) {
  if (!controlToken) return true;
  const actual = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${controlToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function unauthorized(res) {
  return json(res, 401, { error: 'valid control-plane bearer token required' }, { 'www-authenticate': 'Bearer' });
}

async function readJsonBody(req) {
  if (req.headers['content-type'] && !req.headers['content-type'].toLowerCase().startsWith('application/json')) {
    const error = new Error('content-type must be application/json');
    error.status = 415;
    throw error;
  }
  let body = '';
  let bodyBytes = 0;
  for await (const chunk of req) {
    bodyBytes += chunk.length;
    body += chunk;
    if (bodyBytes > maxBodyBytes) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch {
    const error = new Error('invalid JSON');
    error.status = 400;
    throw error;
  }
}

async function cleanupExpiredSessions(maxAgeMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const [caseId, session] of sessions) {
    if (now - session.createdAt <= maxAgeMs) continue;
    await session.manager.disposeWorkspace();
    await stateStore.remove(caseId).catch(() => {});
    sessions.delete(caseId);
  }
}

async function restorePersistedSessions() {
  const restored = [];
  for (const summary of await stateStore.list()) {
    if (summary.status !== 'approval_pending') continue;
    const snapshot = await stateStore.load(summary.caseId);
    if (!snapshot) continue;
    try {
      const manager = DeliveryManager.restore(snapshot, { knowledgeStore: runtimeKnowledgeStore, providers: externalProviders || {}, stateStore });
      sessions.set(summary.caseId, { manager, createdAt: Date.now(), restored: true });
      restored.push(summary.caseId);
    } catch {
      // 损坏或不可恢复的快照不阻塞启动；文件保留供审计
    }
  }
  return restored;
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/mcp') {
      if (!authorized(req)) return unauthorized(res);
      return await handleMcp(req, res);
    }
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { status: 'ok', version: DEVORBIT_VERSION, environment: process.env.DEVORBIT_ENVIRONMENT || 'local', mcpProtocol: MCP_PROTOCOL_VERSION, mcpProtocols: MCP_PROTOCOL_VERSIONS, externalAdapters: Boolean(externalProviders), providerMode: nativePlatformProviders ? 'github-jenkins-argo' : externalProviders ? 'http-spi' : 'fixture', authRequired: Boolean(controlToken), statePersistence: 'file-snapshot', restoredSessions });
    if (req.method === 'GET' && req.url.startsWith('/api/mcp/audit')) {
      if (!authorized(req)) return unauthorized(res);
      const auditUrl = new URL(req.url, 'http://localhost');
      const after = Number(auditUrl.searchParams.get('after') || 0);
      if (!Number.isInteger(after) || after < 0 || after > mcpServer.audit.length) return json(res, 400, { error: 'after must be an audit offset within the current log' });
      return json(res, 200, { protocolVersions: MCP_PROTOCOL_VERSIONS, total: mcpServer.audit.length, after, audit: mcpServer.audit.slice(after) });
    }
    if (req.method === 'GET' && req.url === '/api/case') return json(res, 200, getDemoCase());
    if (req.method === 'GET' && req.url === '/api/meta') return json(res, 200, { skills, adapters, scenarios: ['happy-path', 'dynamic-resampling', 'self-healing', 'low-confidence', 'test-failure', 'canary-regression'], fixtures: ['checkout', 'inventory'] });
    if (req.method === 'POST' && req.url === '/api/runs') {
      if (!authorized(req)) return unauthorized(res);
      await cleanupExpiredSessions();
      const input = await readJsonBody(req);
      const { scenario = 'happy-path', signals, fixture, ...incidentOverrides } = input;
      const baseCase = getCaseForFixture(fixture);
      const incident = { ...baseCase, ...incidentOverrides, signals: signals || baseCase.signals };
      const manager = new DeliveryManager({ incident, scenario, approvalState: 'pending', knowledgeStore: runtimeKnowledgeStore, providers: externalProviders || {}, stateStore, fixturePath: fixturePathForRepository(incident.repository) });
      let result;
      try {
        result = await manager.run();
      } catch (error) {
        await manager.disposeWorkspace().catch(() => {});
        throw error;
      }
      sessions.set(result.state.caseId, { manager, createdAt: Date.now() });
      while (sessions.size > 100) {
        const oldest = sessions.keys().next().value;
        await sessions.get(oldest).manager.disposeWorkspace();
        await stateStore.remove(oldest).catch(() => {});
        sessions.delete(oldest);
      }
      return json(res, 200, result);
    }
    if (req.method === 'GET' && req.url === '/api/runs') {
      if (!authorized(req)) return unauthorized(res);
      const pending = [...sessions.entries()].map(([caseId, session]) => ({
        caseId,
        status: session.manager.state.state,
        revision: session.manager.state.revision,
        scenario: session.manager.state.scenario,
        restored: Boolean(session.restored),
        createdAt: new Date(session.createdAt).toISOString()
      }));
      const snapshots = await stateStore.list();
      return json(res, 200, { sessions: pending, snapshots });
    }
    const approvalMatch = req.url.match(/^\/api\/runs\/([^/]+)\/approval$/);
    if (req.method === 'POST' && approvalMatch) {
      if (!authorized(req)) return unauthorized(res);
      const input = await readJsonBody(req);
      const session = sessions.get(decodeURIComponent(approvalMatch[1]));
      if (!session) return json(res, 404, { error: 'run session not found or expired' });
      let result;
      try {
        result = await session.manager.resumeApproval(input.decision);
      } catch (error) {
        if (session.manager.state.state !== 'approval_pending') {
          await session.manager.disposeWorkspace().catch(() => {});
          sessions.delete(session.manager.state.case_id);
          await stateStore.remove(session.manager.state.case_id).catch(() => {});
        }
        throw error;
      }
      if (result.state.status !== 'approval_pending') {
        sessions.delete(result.state.caseId);
        await stateStore.remove(result.state.caseId).catch(() => {});
      }
      return json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/run') {
      if (!authorized(req)) return unauthorized(res);
      if (externalProviders) return json(res, 403, { error: 'one-shot approved runs are disabled with external adapters; use the pending session and approval endpoints' });
      const input = await readJsonBody(req);
      return json(res, 200, await runPipeline(input));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const requestPath = pathname === '/' ? '/app/index.html' : pathname;
    if (!requestPath.startsWith('/app/') && !publicReports.has(requestPath)) return json(res, 404, { error: 'not found' });
    const file = resolve(root, `.${requestPath}`);
    const publicReport = publicReports.has(requestPath);
    if (!publicReport && !file.startsWith(`${appRoot}${sep}`)) return json(res, 404, { error: 'not found' });
    const content = await readFile(file);
    res.writeHead(200, { ...securityHeaders, 'content-type': types[extname(file)] || 'application/octet-stream', ...(publicReport ? { 'cache-control': 'no-store' } : {}) });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: 'not found' });
    json(res, error.status || 400, { error: error.message });
  }
});

const restoredSessions = await restorePersistedSessions();
server.listen(port, host, () => {
  console.log(`DevOrbit demo: http://${host}:${port}`);
  if (restoredSessions.length) console.log(`restored ${restoredSessions.length} approval-pending session(s) from state snapshots: ${restoredSessions.join(', ')}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const force = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    try {
      await Promise.all([...sessions.values()].map(session => session.manager.disposeWorkspace()));
      await nativePlatformProviders?.repository?.close?.();
      clearTimeout(force);
      process.exit(0);
    } catch (error) {
      console.error(`shutdown cleanup failed after ${signal}: ${error.message}`);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

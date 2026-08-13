import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline, getDemoCase } from './src/orchestrator.js';
import { DeliveryManager } from './src/runtime/manager.js';
import { skills } from './src/skills.js';
import { adapters } from './src/adapters.js';
import { KnowledgeStore } from './src/knowledge/store.js';
import { McpToolServer } from './src/mcp/tool-server.js';
import { createTools } from './src/mcp/tools.js';
import { createStreamableHttpHandler } from './src/mcp/http-transport.js';
import { fileURLToPath as toPath } from 'node:url';
import { ApprovalAuthority, ToolPolicy } from './src/security/tool-policy.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml' };
const sessions = new Map();
const runtimeKnowledgeStore = new KnowledgeStore();
const mcpApprovalAuthority = new ApprovalAuthority();
const mcpServer = new McpToolServer({ tools: createTools({ fixturePath: toPath(new URL('./fixtures/checkout-service', import.meta.url)), workspaceRegistry: new Map(), knowledgeStore: new KnowledgeStore(), signals: getDemoCase().signals }), policy: new ToolPolicy({ approvalAuthority: mcpApprovalAuthority }) });
const handleMcp = createStreamableHttpHandler(mcpServer);

async function cleanupExpiredSessions(maxAgeMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const [caseId, session] of sessions) {
    if (now - session.createdAt <= maxAgeMs) continue;
    await session.manager.disposeWorkspace();
    sessions.delete(caseId);
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/mcp') return await handleMcp(req, res);
    if (req.method === 'GET' && req.url === '/api/case') return json(res, 200, getDemoCase());
    if (req.method === 'GET' && req.url === '/api/meta') return json(res, 200, { skills, adapters, scenarios: ['happy-path', 'low-confidence', 'test-failure', 'canary-regression'] });
    if (req.method === 'POST' && req.url === '/api/runs') {
      await cleanupExpiredSessions();
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = body ? JSON.parse(body) : {};
      const { scenario = 'happy-path', signals, ...incidentOverrides } = input;
      const incident = { ...getDemoCase(), ...incidentOverrides, signals: signals || getDemoCase().signals };
      const manager = new DeliveryManager({ incident, scenario, approvalState: 'pending', knowledgeStore: runtimeKnowledgeStore });
      const result = await manager.run();
      sessions.set(result.state.caseId, { manager, createdAt: Date.now() });
      while (sessions.size > 100) {
        const oldest = sessions.keys().next().value;
        await sessions.get(oldest).manager.disposeWorkspace();
        sessions.delete(oldest);
      }
      return json(res, 200, result);
    }
    const approvalMatch = req.url.match(/^\/api\/runs\/([^/]+)\/approval$/);
    if (req.method === 'POST' && approvalMatch) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = body ? JSON.parse(body) : {};
      const session = sessions.get(decodeURIComponent(approvalMatch[1]));
      if (!session) return json(res, 404, { error: 'run session not found or expired' });
      const result = await session.manager.resumeApproval(input.decision);
      if (result.state.status !== 'approval_pending') sessions.delete(result.state.caseId);
      return json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/run') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = body ? JSON.parse(body) : {};
      return json(res, 200, await runPipeline(input));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    const requestPath = req.url.split('?')[0] === '/' ? '/app/index.html' : req.url.split('?')[0];
    const safePath = normalize(requestPath).replace(/^([.][.][/\\])+/, '');
    const file = join(root, safePath);
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: 'not found' });
    json(res, 400, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`DevOrbit demo: http://127.0.0.1:${port}`));

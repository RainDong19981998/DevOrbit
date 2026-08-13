import { randomUUID } from 'node:crypto';
import { MCP_PROTOCOL_VERSION } from './protocol.js';

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(value === undefined ? '' : JSON.stringify(value));
}

export function createStreamableHttpHandler(toolServer) {
  const sessions = new Map();
  return async function handle(req, res) {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return sendJson(res, 403, { error: 'origin not allowed' });
    if (req.method === 'GET') return sendJson(res, 405, { error: 'SSE stream not implemented by this basic server' }, { allow: 'POST, DELETE' });
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      sessions.delete(sessionId);
      res.writeHead(204); return res.end();
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST, GET, DELETE' });
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return sendJson(res, 406, { error: 'Accept must include application/json and text/event-stream' });
    let body = '';
    for await (const chunk of req) body += chunk;
    let message;
    try { message = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
    const isInitialize = message.method === 'initialize';
    const version = req.headers['mcp-protocol-version'];
    if (!isInitialize && version !== MCP_PROTOCOL_VERSION) return sendJson(res, 400, { error: `unsupported MCP protocol version: ${version || 'missing'}` });
    let sessionId = req.headers['mcp-session-id'];
    if (isInitialize) {
      const agent = req.headers['x-devorbit-agent'];
      if (!agent) return sendJson(res, 401, { error: 'x-devorbit-agent identity required' });
      sessionId = randomUUID();
      sessions.set(sessionId, { agent, traceId: req.headers['x-trace-id'] || null, caseId: req.headers['x-case-id'] || null });
    } else if (!sessionId || !sessions.has(sessionId)) return sendJson(res, 400, { error: 'valid Mcp-Session-Id required' });
    const identity = sessions.get(sessionId);
    if (!isInitialize && req.headers['x-devorbit-agent'] && req.headers['x-devorbit-agent'] !== identity.agent) return sendJson(res, 403, { error: 'session agent identity mismatch' });
    const response = await toolServer.dispatch(message, identity);
    if (!Object.hasOwn(message, 'id')) {
      res.writeHead(202); return res.end();
    }
    sendJson(res, 200, response, isInitialize ? { 'mcp-session-id': sessionId } : {});
  };
}

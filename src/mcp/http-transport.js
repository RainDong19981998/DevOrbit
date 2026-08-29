import { randomUUID } from 'node:crypto';
import { negotiateProtocolVersion } from './protocol.js';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(value === undefined ? '' : JSON.stringify(value));
}

export function createStreamableHttpHandler(toolServer, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, maxSessions = DEFAULT_MAX_SESSIONS, sessionTtlMs = DEFAULT_SESSION_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map();
  return async function handle(req, res) {
    for (const [sessionId, session] of sessions) if (now() - session.lastSeenAt > sessionTtlMs) sessions.delete(sessionId);
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return sendJson(res, 403, { error: 'origin not allowed' });
    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'];
      const identity = sessions.get(sessionId);
      if (!identity) return sendJson(res, 404, { error: 'MCP session not found or expired' });
      if (req.headers['mcp-protocol-version'] !== identity.protocolVersion) return sendJson(res, 400, { error: `MCP session requires protocol version ${identity.protocolVersion}` });
      if (req.headers['x-devorbit-agent'] !== identity.agent) return sendJson(res, 403, { error: 'session agent identity mismatch' });
      identity.lastSeenAt = now();
      return sendJson(res, 405, { error: 'SSE stream not implemented by this server' }, { allow: 'POST, DELETE' });
    }
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      const identity = sessions.get(sessionId);
      if (!identity) return sendJson(res, 404, { error: 'MCP session not found or expired' });
      if (req.headers['mcp-protocol-version'] !== identity.protocolVersion) return sendJson(res, 400, { error: `MCP session requires protocol version ${identity.protocolVersion}` });
      if (req.headers['x-devorbit-agent'] !== identity.agent) return sendJson(res, 403, { error: 'session agent identity mismatch' });
      sessions.delete(sessionId);
      res.writeHead(204); return res.end();
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST, GET, DELETE' });
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return sendJson(res, 406, { error: 'Accept must include application/json and text/event-stream' });
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: 'Content-Type must be application/json' });
    let body = '';
    let bodyBytes = 0;
    for await (const chunk of req) {
      bodyBytes += chunk.length;
      body += chunk;
      if (bodyBytes > maxBodyBytes) return sendJson(res, 413, { error: 'MCP request body too large' });
    }
    let message;
    try { message = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
    const isInitialize = message.method === 'initialize';
    let sessionId = req.headers['mcp-session-id'];
    if (isInitialize) {
      const agent = req.headers['x-devorbit-agent'];
      if (!agent) return sendJson(res, 401, { error: 'x-devorbit-agent identity required' });
      if (sessions.size >= maxSessions) return sendJson(res, 503, { error: 'MCP session capacity reached' }, { 'retry-after': '1' });
      const protocolVersion = negotiateProtocolVersion(message.params?.protocolVersion);
      sessionId = randomUUID();
      sessions.set(sessionId, { agent, protocolVersion, traceId: req.headers['x-trace-id'] || null, caseId: req.headers['x-case-id'] || null, lastSeenAt: now() });
    } else if (!sessionId || !sessions.has(sessionId)) return sendJson(res, 400, { error: 'valid Mcp-Session-Id required' });
    const identity = sessions.get(sessionId);
    if (!isInitialize && req.headers['mcp-protocol-version'] !== identity.protocolVersion) return sendJson(res, 400, { error: `MCP session requires protocol version ${identity.protocolVersion}` });
    if (!isInitialize && req.headers['x-devorbit-agent'] && req.headers['x-devorbit-agent'] !== identity.agent) return sendJson(res, 403, { error: 'session agent identity mismatch' });
    identity.lastSeenAt = now();
    const response = await toolServer.dispatch(message, identity);
    if (!Object.hasOwn(message, 'id')) {
      res.writeHead(202); return res.end();
    }
    sendJson(res, 200, response, isInitialize ? { 'mcp-session-id': sessionId } : {});
  };
}

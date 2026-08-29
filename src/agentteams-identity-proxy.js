import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(`${JSON.stringify(body)}\n`);
}

function tokenDigest(token) {
  return createHash('sha256').update(token).digest();
}

function parseIdentityMap(config) {
  if (!config || config.version !== 1 || !Array.isArray(config.identities)) {
    throw new Error('identity proxy config must contain version=1 and identities[]');
  }
  const identities = config.identities.map((entry, index) => {
    const agent = String(entry?.agent || '').trim();
    const digestHex = String(entry?.bearerSha256 || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(agent)) {
      throw new Error(`identities[${index}].agent is invalid`);
    }
    if (!/^[a-f0-9]{64}$/.test(digestHex)) {
      throw new Error(`identities[${index}].bearerSha256 must be a SHA-256 hex digest`);
    }
    return { agent, digest: Buffer.from(digestHex, 'hex') };
  });
  if (identities.length === 0) throw new Error('identity proxy requires at least one identity');
  if (new Set(identities.map(item => item.agent)).size !== identities.length) {
    throw new Error('identity proxy agent names must be unique');
  }
  if (new Set(identities.map(item => item.digest.toString('hex'))).size !== identities.length) {
    throw new Error('identity proxy bearer digests must be unique');
  }
  return identities;
}

function authenticate(request, identities) {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ') || value.length <= 7) return null;
  const candidate = tokenDigest(value.slice(7));
  return identities.find(item => timingSafeEqual(candidate, item.digest))?.agent || null;
}

function upstreamHeaders(request, upstream, agent) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'authorization' || lower === 'x-devorbit-agent') continue;
    headers[lower] = value;
  }
  headers.host = upstream.host;
  headers['x-devorbit-agent'] = agent;
  return headers;
}

export function createAgentTeamsIdentityProxy({ config, upstreamUrl, requestTimeoutMs = 30_000 }) {
  const identities = parseIdentityMap(config);
  const upstream = new URL(upstreamUrl || config.upstream || 'http://127.0.0.1:4173');
  if (upstream.protocol !== 'http:') throw new Error('identity proxy upstream must use http');

  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://identity-proxy.local');
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      return sendJson(response, 200, {
        status: 'ok',
        component: 'agentteams-identity-proxy',
        identities: identities.length,
        upstream: upstream.origin
      });
    }
    if (requestUrl.pathname !== '/mcp') return sendJson(response, 404, { error: 'not found' });
    if (typeof request.headers.authorization !== 'string') {
      return sendJson(response, 401, { error: 'AgentTeams bearer identity required' });
    }
    const agent = authenticate(request, identities);
    if (!agent) return sendJson(response, 403, { error: 'AgentTeams bearer identity rejected' });

    const proxyRequest = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: `${upstream.pathname.replace(/\/$/, '')}${requestUrl.pathname}${requestUrl.search}`,
      headers: upstreamHeaders(request, upstream, agent),
      timeout: requestTimeoutMs
    }, proxyResponse => {
      const headers = {};
      for (const [name, value] of Object.entries(proxyResponse.headers)) {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers[name] = value;
      }
      response.writeHead(proxyResponse.statusCode || 502, headers);
      proxyResponse.pipe(response);
    });

    proxyRequest.on('timeout', () => proxyRequest.destroy(new Error('upstream timeout')));
    proxyRequest.on('error', error => {
      if (!response.headersSent) sendJson(response, 502, { error: 'upstream unavailable' });
      else response.destroy(error);
    });
    request.on('aborted', () => proxyRequest.destroy());
    request.pipe(proxyRequest);
  });
}

export function sha256Bearer(token) {
  return tokenDigest(token).toString('hex');
}

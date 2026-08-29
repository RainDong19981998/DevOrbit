import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createAgentTeamsIdentityProxy, sha256Bearer } from './agentteams-identity-proxy.js';

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('identity proxy authenticates AgentTeams bearer and overwrites spoofed identity', async () => {
  let observed;
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      observed = { headers: request.headers, method: request.method, url: request.url, body: Buffer.concat(chunks).toString() };
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' });
      response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createAgentTeamsIdentityProxy({
    upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
    config: { version: 1, identities: [{ agent: 'intake-worker', bearerSha256: sha256Bearer('worker-secret') }] }
  });
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp?case=1`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer worker-secret',
        'content-type': 'application/json',
        'x-devorbit-agent': 'release-worker'
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), 'session-1');
    assert.equal(observed.headers['x-devorbit-agent'], 'intake-worker');
    assert.equal(observed.headers.authorization, undefined);
    assert.equal(observed.method, 'POST');
    assert.equal(observed.url, '/mcp?case=1');
    assert.match(observed.body, /initialize/);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('identity proxy rejects missing, unknown, duplicate and out-of-scope identities', async () => {
  const proxy = createAgentTeamsIdentityProxy({
    config: { version: 1, identities: [{ agent: 'verify-worker', bearerSha256: sha256Bearer('known') }] }
  });
  const port = await listen(proxy);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/other`, { headers: { authorization: 'Bearer known' } })).status, 404);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(health, {
      status: 'ok', component: 'agentteams-identity-proxy', identities: 1, upstream: 'http://127.0.0.1:4173'
    });
  } finally {
    await close(proxy);
  }

  const digest = sha256Bearer('same');
  assert.throws(() => createAgentTeamsIdentityProxy({
    config: { version: 1, identities: [
      { agent: 'one-worker', bearerSha256: digest },
      { agent: 'two-worker', bearerSha256: digest }
    ] }
  }), /digests must be unique/);
});

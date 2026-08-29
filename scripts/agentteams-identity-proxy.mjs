#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createAgentTeamsIdentityProxy } from '../src/agentteams-identity-proxy.js';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const configPath = argument('--config', process.env.DEVORBIT_AGENTTEAMS_IDENTITY_MAP);
const host = argument('--host', process.env.DEVORBIT_AGENTTEAMS_PROXY_HOST || '127.0.0.1');
const port = Number(argument('--port', process.env.DEVORBIT_AGENTTEAMS_PROXY_PORT || '4175'));
const upstreamUrl = argument('--upstream', process.env.DEVORBIT_AGENTTEAMS_UPSTREAM || '');

if (!configPath) throw new Error('--config or DEVORBIT_AGENTTEAMS_IDENTITY_MAP is required');
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('proxy port is invalid');

const config = JSON.parse(await readFile(configPath, 'utf8'));
const server = createAgentTeamsIdentityProxy({ config, upstreamUrl });
server.listen(port, host, () => {
  console.log(JSON.stringify({
    event: 'agentteams_identity_proxy_ready',
    host,
    port,
    identities: config.identities.length,
    upstream: upstreamUrl || config.upstream || 'http://127.0.0.1:4173'
  }));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

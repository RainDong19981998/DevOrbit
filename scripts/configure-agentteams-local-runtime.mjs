import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const envPath = process.env.DEVORBIT_AGENTTEAMS_ENV || '/tmp/devorbit-agentteams-runtime/agentteams-manager.env';
const consoleBase = process.env.DEVORBIT_HIGRESS_CONSOLE || 'http://127.0.0.1:18001';
const environment = parseEnv(await readFile(envPath, 'utf8'));
for (const name of ['AGENTTEAMS_ADMIN_USER', 'AGENTTEAMS_ADMIN_PASSWORD', 'AGENTTEAMS_LLM_API_KEY', 'AGENTTEAMS_OPENAI_BASE_URL']) {
  if (!environment[name]) throw new Error(`${name} is required in ${envPath}`);
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

const login = await fetch(`${consoleBase}/session/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: environment.AGENTTEAMS_ADMIN_USER, password: environment.AGENTTEAMS_ADMIN_PASSWORD })
});
if (![200, 201].includes(login.status)) throw new Error(`Higress login returned ${login.status}`);
const cookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie')].filter(Boolean);
const cookie = cookies.map(value => value.split(';', 1)[0]).join('; ');
if (!cookie) throw new Error('Higress login returned no session cookie');

async function consoleRequest(path, { method = 'GET', body, expected = [200] } = {}) {
  const response = await fetch(`${consoleBase}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!expected.includes(response.status)) throw new Error(`Higress ${method} ${path} returned ${response.status}: ${data?.message || 'unknown error'}`);
  return { status: response.status, data };
}

const baseUrl = new URL(environment.AGENTTEAMS_OPENAI_BASE_URL);
const port = Number(baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80));
const protocol = baseUrl.protocol === 'https:' ? 'https' : 'http';
const sourceType = isIP(baseUrl.hostname) ? 'static' : 'dns';
const serviceName = `openai-compat.${sourceType}`;
const source = {
  type: sourceType,
  name: 'openai-compat',
  domain: sourceType === 'static' ? `${baseUrl.hostname}:${port}` : baseUrl.hostname,
  port,
  protocol,
  properties: {},
  authN: { enabled: false }
};
const existingSource = await consoleRequest('/v1/service-sources/openai-compat', { expected: [200, 404] });
if (existingSource.status === 404) {
  await consoleRequest('/v1/service-sources', { method: 'POST', body: source, expected: [200, 201] });
} else {
  const current = existingSource.data?.data || existingSource.data || {};
  await consoleRequest('/v1/service-sources/openai-compat', { method: 'PUT', body: { ...source, ...(current.version ? { version: current.version } : {}) }, expected: [200] });
}

await consoleRequest('/v1/ai/providers/openai-compat', {
  method: 'PUT',
  body: {
    type: 'openai',
    name: 'openai-compat',
    tokens: [environment.AGENTTEAMS_LLM_API_KEY],
    version: 0,
    protocol: 'openai/v1',
    tokenFailoverConfig: { enabled: false },
    rawConfigs: {
      openaiCustomUrl: environment.AGENTTEAMS_OPENAI_BASE_URL,
      openaiCustomServiceName: serviceName,
      openaiCustomServicePort: port,
      agentteamsMode: true
    }
  },
  expected: [200]
});

const policy = JSON.stringify({ default_effect: 'allow', client_overrides: [], tool_defaults: [], tool_overrides: [], unmanaged_rules_count: 0 });
const clientsByWorker = {
  'intake-worker': ['issue', 'observability'],
  'impact-worker': ['repository'],
  'rca-worker': ['observability', 'knowledge'],
  'patch-worker': ['repository', 'ci'],
  'verify-worker': ['ci'],
  'release-worker': ['release'],
  'learning-worker': ['knowledge']
};
let policyCount = 0;
for (const [worker, clients] of Object.entries(clientsByWorker)) {
  for (const client of clients) {
    const { stdout } = await exec('docker', ['exec', `agentteams-worker-${worker}`, 'curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'PUT', `http://127.0.0.1:8088/api/mcp/policy/${client}`, '-H', 'Content-Type: application/json', '--data', policy]);
    if (stdout.trim() !== '200') throw new Error(`${worker}/${client} MCP policy returned ${stdout.trim()}`);
    policyCount += 1;
  }
}

const clusterName = `outbound|${port}||${serviceName}`;
let clusterReady = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const { stdout } = await exec('docker', ['exec', 'agentteams-controller', 'curl', '-sS', 'http://127.0.0.1:15000/clusters']);
  if (stdout.includes(clusterName)) {
    clusterReady = true;
    break;
  }
  await delay(1000);
}
if (!clusterReady) throw new Error(`Envoy cluster did not appear: ${clusterName}`);

console.log(`PASS Higress service source: ${serviceName}`);
console.log(`PASS Envoy cluster: ${clusterName}`);
console.log(`PASS Worker MCP policies: ${policyCount}/${policyCount}`);
console.log('PASS AgentTeams local runtime configuration (credentials not printed)');

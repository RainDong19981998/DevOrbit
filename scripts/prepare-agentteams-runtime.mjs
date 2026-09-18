import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const runtimeDir = process.env.DEVORBIT_AGENTTEAMS_RUNTIME_DIR || `/tmp/devorbit-agentteams-runtime-${process.getuid?.() ?? 'user'}`;
const workers = ['intake-worker', 'impact-worker', 'rca-worker', 'patch-worker', 'verify-worker', 'release-worker', 'learning-worker'];
const caseId = process.env.DEVORBIT_AUTONOMOUS_CASE_ID || null;
const traceId = process.env.DEVORBIT_AUTONOMOUS_TRACE_ID || null;

async function dockerEnv(container, name) {
  const { stdout } = await exec('docker', ['inspect', container, '--format', '{{json .Config.Env}}']);
  const entry = JSON.parse(stdout).find(value => value.startsWith(`${name}=`));
  return entry?.slice(name.length + 1) || '';
}

async function workerGatewayKey(worker) {
  const command = `. /data/worker-creds/${worker}.env; printf %s "$WORKER_GATEWAY_KEY"`;
  const { stdout } = await exec('docker', ['exec', 'agentteams-controller', 'sh', '-c', command]);
  return stdout;
}

const adminUser = await dockerEnv('agentteams-controller', 'AGENTTEAMS_ADMIN_USER');
const adminPassword = await dockerEnv('agentteams-controller', 'AGENTTEAMS_ADMIN_PASSWORD');
const controllerLlmApiKey = await dockerEnv('agentteams-controller', 'AGENTTEAMS_LLM_API_KEY');
const controllerOpenaiBaseUrl = await dockerEnv('agentteams-controller', 'AGENTTEAMS_OPENAI_BASE_URL');
const llmApiKey = process.env.DEVORBIT_AGENTTEAMS_LLM_API_KEY || process.env.DASHSCOPE_API_KEY || controllerLlmApiKey;
const openaiBaseUrl = process.env.DEVORBIT_AGENTTEAMS_OPENAI_BASE_URL || process.env.DEVORBIT_MODEL_BASE_URL || controllerOpenaiBaseUrl;
if (![adminUser, adminPassword, llmApiKey, openaiBaseUrl].every(Boolean)) {
  throw new Error('AgentTeams controller is missing required runtime credentials');
}

const identities = [];
for (const worker of workers) {
  const key = await workerGatewayKey(worker);
  if (!key) throw new Error(`missing gateway key for ${worker}`);
  identities.push({ agent: worker, bearerSha256: createHash('sha256').update(key).digest('hex') });
}

await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
const identityPath = `${runtimeDir}/identity-map.json`;
const envPath = `${runtimeDir}/agentteams-manager.env`;
await writeFile(identityPath, `${JSON.stringify({
  version: 1,
  upstream: process.env.DEVORBIT_AGENTTEAMS_UPSTREAM || 'http://127.0.0.1:4174',
  ...(caseId && traceId ? { context: { caseId, traceId } } : {}),
  identities
}, null, 2)}\n`, { mode: 0o600 });
await writeFile(envPath, [
  `AGENTTEAMS_ADMIN_USER=${adminUser}`,
  `AGENTTEAMS_ADMIN_PASSWORD=${adminPassword}`,
  `AGENTTEAMS_LLM_API_KEY=${llmApiKey}`,
  `AGENTTEAMS_OPENAI_BASE_URL=${openaiBaseUrl}`,
  ''
].join('\n'), { mode: 0o600 });
await chmod(identityPath, 0o600);
await chmod(envPath, 0o600);

console.log(JSON.stringify({ status: 'prepared', runtimeDir, identities: identities.length, contextBound: Boolean(caseId && traceId), secretsPrinted: false }));

import http from 'node:http';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DeliveryManager } from '../src/runtime/manager.js';
import { getDemoCase } from '../src/orchestrator.js';
import { GitHubIssueAdapter, GitRepositoryAdapter, JenkinsCiAdapter, ArgoRolloutsReleaseAdapter } from '../src/adapters/platforms.js';
import { KnowledgeStore } from '../src/knowledge/store.js';

const execFile = promisify(execFileCallback);
const fixture = fileURLToPath(new URL('../fixtures/checkout-service', import.meta.url));
const token = 'native-platform-smoke-token';
const temp = await mkdtemp(join(tmpdir(), 'devorbit-native-platform-'));
const seed = join(temp, 'seed');
const remote = join(temp, 'checkout-service.git');
const requests = [];
const builds = new Map();
let nextBuild = 1;
let rolloutImage = 'checkout-service:broken';
let rolloutPhase = 'Healthy';
let rolloutGeneration = 1;

function send(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function runRemoteTests(commit) {
  const checkout = await mkdtemp(join(temp, 'jenkins-checkout-'));
  try {
    await execFile('git', ['clone', remote, checkout]);
    await execFile('git', ['checkout', '--detach', commit], { cwd: checkout });
    const result = await execFile(process.execPath, ['--test'], { cwd: checkout, encoding: 'utf8' }).then(value => ({ status: 0, stdout: value.stdout, stderr: value.stderr })).catch(error => ({ status: error.code || 1, stdout: error.stdout || '', stderr: error.stderr || '' }));
    const output = `${result.stdout}\n${result.stderr}`;
    const count = label => Number(output.match(new RegExp(`# ${label} (\\d+)`))?.[1] || 0);
    return { result: result.status === 0 ? 'SUCCESS' : 'FAILURE', totalCount: count('tests'), failCount: count('fail'), skipCount: count('skipped'), artifact: `sha256:${createHash('sha256').update(output).digest('hex')}` };
  } finally { await rm(checkout, { recursive: true, force: true }); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: { code: 'unauthorized' } });
    const url = new URL(req.url, 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, operation: req.headers['x-devorbit-operation'], idempotencyKey: req.headers['idempotency-key'] || null, caseId: req.headers['x-devorbit-case-id'] || url.searchParams.get('DEVORBIT_CASE_ID'), body: req.method === 'PATCH' ? await readBody(req) : null });
    if (url.pathname === '/repos/acme/checkout/issues') return send(res, 200, [{ number: 771, title: getDemoCase().title, body: getDemoCase().signals.find(signal => signal.source === 'Issue').text, updated_at: '2026-08-13T10:15:21Z', html_url: 'https://github.example/acme/checkout/issues/771' }]);
    if (url.pathname === '/crumbIssuer/api/json') return send(res, 404, { error: { code: 'crumb_disabled' } });
    if (url.pathname === '/job/checkout/buildWithParameters') {
      const number = nextBuild++;
      builds.set(number, await runRemoteTests(url.searchParams.get('DEVORBIT_COMMIT')));
      return send(res, 201, {}, { location: `http://127.0.0.1:${server.address().port}/queue/${number}/` });
    }
    const queue = url.pathname.match(/^\/queue\/(\d+)\/$/);
    if (queue) return send(res, 200, { executable: { number: Number(queue[1]) } });
    const build = url.pathname.match(/^\/job\/checkout\/(\d+)\/api\/json$/);
    if (build) {
      const evidence = builds.get(Number(build[1]));
      return send(res, 200, { number: Number(build[1]), result: evidence.result, building: false, url: `jenkins://checkout/${build[1]}`, artifact: evidence.artifact });
    }
    const report = url.pathname.match(/^\/job\/checkout\/(\d+)\/testReport\/api\/json$/);
    if (report) {
      const evidence = builds.get(Number(report[1]));
      return send(res, 200, { totalCount: evidence.totalCount, failCount: evidence.failCount, skipCount: evidence.skipCount });
    }
    if (url.pathname === '/apis/argoproj.io/v1alpha1/namespaces/prod/rollouts/checkout') {
      if (req.method === 'PATCH') {
        const patch = requests.at(-1).body;
        if (!Array.isArray(patch) || patch[0]?.op !== 'test' || patch[0]?.path !== '/spec/template/spec/containers/1/name' || patch[1]?.op !== 'replace') return send(res, 422, { error: { code: 'invalid_json_patch' } });
        rolloutImage = patch[1].value;
        rolloutGeneration += 1;
        rolloutPhase = 'Healthy';
        return send(res, 200, { metadata: { generation: rolloutGeneration } });
      }
      return send(res, 200, { metadata: { generation: rolloutGeneration }, spec: { strategy: { canary: { steps: [{ setWeight: 10 }, { pause: { duration: '5m' } }] } }, template: { spec: { containers: [{ name: 'metrics', image: 'metrics:v1' }, { name: 'app', image: rolloutImage }] } } }, status: { phase: rolloutPhase, observedGeneration: rolloutGeneration, observedImage: rolloutImage, replicas: 3 } });
    }
    return send(res, 404, { error: { code: 'not_found' } });
  } catch (error) { return send(res, 500, { error: { code: 'smoke_error', message: error.message } }); }
});

await cp(fixture, seed, { recursive: true });
await execFile('git', ['init', '-b', 'main'], { cwd: seed });
await execFile('git', ['config', 'user.email', 'seed@devorbit.local'], { cwd: seed });
await execFile('git', ['config', 'user.name', 'DevOrbit Seed'], { cwd: seed });
await execFile('git', ['add', '.'], { cwd: seed });
await execFile('git', ['commit', '-m', 'broken baseline'], { cwd: seed });
await execFile('git', ['clone', '--bare', seed, remote]);
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));

const baseUrl = `http://127.0.0.1:${server.address().port}`;
const repository = new GitRepositoryAdapter({ repositoryUrl: `file://${remote}`, branch: 'main', sourceRoot: temp, pushBranches: true, authorization: null });
const providers = {
  issue: new GitHubIssueAdapter({ baseUrl, token, owner: 'acme', repo: 'checkout' }),
  observability: { fetchSignals: async () => ({ signals: getDemoCase().signals.filter(signal => !['Issue', '用户反馈'].includes(signal.source)), sourceCount: 3 }) },
  repository,
  ci: new JenkinsCiAdapter({ baseUrl, jobPath: '/job/checkout', token, repository, pollIntervalMs: 0 }),
  knowledge: (() => { const store = new KnowledgeStore(); return { searchCases: async args => { const results = store.search(args); return { results, count: results.length, indexSize: store.size() }; }, writeCase: async ({ card }) => ({ stored: store.write(card), indexSize: store.size() }) }; })(),
  release: new ArgoRolloutsReleaseAdapter({ baseUrl, namespace: 'prod', rollout: 'checkout', container: 'app', token, idempotencyDirectory: join(temp, 'idempotency'), pollIntervalMs: 0, timeoutMs: 5000 })
};

try {
  const manager = new DeliveryManager({ incident: getDemoCase(), approvalState: 'approved', providers, releaseVersion: 'checkout-service:fixed' });
  const result = await manager.run();
  const commits = [...new Set(requests.filter(item => item.operation === 'jenkins.build.trigger').map(item => item.path))];
  const remoteBranches = (await execFile('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: remote })).stdout.trim().split('\n').filter(Boolean);
  const checks = [
    ['closed loop from native connectors', result.state.status === 'learned' && result.release.decision === 'promoted'],
    ['GitHub Issue normalized', result.canonical.sourceSystems.issue === 1 && result.incident.repository === 'checkout-service'],
    ['real remote Git baseline and patch', /^[0-9a-f]{40}$/.test(result.plan.baseCommit || '') && result.plan.baselineTests.failed === 3],
    ['Jenkins checked out patched commit', result.tests.exitCode === 0 && result.tests.passed === 4 && result.tests.command.startsWith('jenkins://')],
    ['Argo JSON Patch and generation-bound 10% canary', result.release.canary === '10%' && result.release.observationWindow === 'argo rollout generation 2 healthy' && requests.filter(item => item.operation === 'argo.rollout.patch').every(item => Array.isArray(item.body))],
    ['temporary Git branch cleaned', remoteBranches.length === 1 && remoteBranches[0] === 'main'],
    ['outbound writes idempotent', requests.filter(item => ['jenkins.build.trigger', 'argo.rollout.patch'].includes(item.operation)).every(item => item.idempotencyKey)],
    ['MCP audit remains authoritative', result.mcp.calls === 15 && result.mcp.audit.every(item => item.status === 'ok')]
  ];
  for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  const report = { generatedAt: new Date().toISOString(), status: checks.every(([, ok]) => ok) ? 'passed' : 'failed', boundary: 'Local protocol endpoints emulate GitHub, Jenkins and Kubernetes APIs; Git clone/commit/push/checkout and node --test are real local executions. This is native connector evidence, not vendor-account or production-cluster evidence.', summary: { checks: checks.length, passed: checks.filter(([, ok]) => ok).length, failed: checks.filter(([, ok]) => !ok).length }, evidence: { baseCommit: result.plan.baseCommit, baselineFailed: result.plan.baselineTests.failed, patchedPassed: result.tests.passed, releaseDecision: result.release.decision, mcpCalls: result.mcp.calls, platformRequests: requests.length, operations: Object.fromEntries([...new Set(requests.map(item => item.operation).filter(Boolean))].sort().map(operation => [operation, requests.filter(item => item.operation === operation).length])) }, checks: checks.map(([label, ok]) => ({ label, ok })) };
  await writeFile(new URL('../reports/native-platform-smoke.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.failed) process.exitCode = 1;
  else console.log(`PASS native platform connector loop: ${report.summary.passed}/${report.summary.checks}, ${requests.length} platform requests`);
} finally {
  await repository.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

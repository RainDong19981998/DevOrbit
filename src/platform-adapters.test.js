import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubIssueAdapter, GitRepositoryAdapter, JenkinsCiAdapter, ArgoRolloutsReleaseAdapter, IdempotencyLedger } from './adapters/platforms.js';

const execFile = promisify(execFileCallback);
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

async function localGitRepo() {
  const root = await mkdtemp(join(tmpdir(), 'devorbit-platform-git-'));
  await execFile('git', ['init', '-b', 'main'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@devorbit.local'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'DevOrbit Test'], { cwd: root });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'main.js'), 'export const value = 1;\n');
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-m', 'base'], { cwd: root });
  return root;
}

test('native GitHub Issue adapter normalizes issues and excludes pull requests', async () => {
  const calls = [];
  const adapter = new GitHubIssueAdapter({ owner: 'acme', repo: 'checkout', token: 'gh-secret', baseUrl: 'https://api.github.test', fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return json([{ number: 12, title: 'bug', body: 'details', updated_at: '2026-08-13T00:00:00Z', html_url: 'https://github.test/acme/checkout/issues/12' }, { number: 13, pull_request: {}, title: 'PR' }]); } });
  const result = await adapter.fetchSignals({ caseId: 'CASE-1' }, { caseId: 'CASE-1', traceId: 'TRACE-1', agent: 'intake-worker' });
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].id, 'GH-ISSUE-12');
  assert.equal(calls[0].options.headers.authorization, 'Bearer gh-secret');
  assert.match(calls[0].url, /\/repos\/acme\/checkout\/issues\?/);
});

test('native Git repository adapter clones a branch, bounds paths, and replays idempotent writes', async () => {
  const source = await localGitRepo();
  const adapter = new GitRepositoryAdapter({ repositoryUrl: `file://${source}`, branch: 'main', sourceRoot: tmpdir() });
  try {
    assert.equal((await adapter.readFile({ path: 'src/main.js' })).content, 'export const value = 1;\n');
    const first = await adapter.createWorkspace({ workspaceId: 'WS-1', idempotencyKey: 'CASE-1:workspace' });
    const replay = await adapter.createWorkspace({ workspaceId: 'WS-1', idempotencyKey: 'CASE-1:workspace' });
    assert.equal(first.baseCommit.length, 40);
    assert.deepEqual(replay, first);
    assert.equal((await adapter.readFile({ workspaceId: 'WS-1', path: 'src/main.js' })).content, 'export const value = 1;\n');
    const write = await adapter.writeFile({ workspaceId: 'WS-1', path: 'src/main.js', content: 'export const value = 2;\n', idempotencyKey: 'CASE-1:write' });
    assert.equal((await adapter.writeFile({ workspaceId: 'WS-1', path: 'src/main.js', content: 'export const value = 2;\n', idempotencyKey: 'CASE-1:write' })).digest, write.digest);
    await assert.rejects(() => adapter.readFile({ workspaceId: 'WS-1', path: '../secret' }), error => error.code === 'external_path_denied');
    await assert.rejects(() => adapter.writeFile({ workspaceId: 'WS-1', path: '.git/config', content: 'bad', idempotencyKey: 'CASE-1:escape' }), error => error.code === 'external_path_denied');
    const workspacePath = adapter.workspace('WS-1').path;
    const outside = await mkdtemp(join(tmpdir(), 'devorbit-platform-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'do not read or overwrite\n');
      await symlink(outside, join(workspacePath, 'linked-outside'));
      await assert.rejects(() => adapter.readFile({ workspaceId: 'WS-1', path: 'linked-outside/secret.txt' }), error => error.code === 'external_path_denied');
      await assert.rejects(() => adapter.writeFile({ workspaceId: 'WS-1', path: 'linked-outside/secret.txt', content: 'overwritten\n', idempotencyKey: 'CASE-1:symlink-parent' }), error => error.code === 'external_path_denied');
      await symlink(join(outside, 'secret.txt'), join(workspacePath, 'linked-file'));
      await assert.rejects(() => adapter.writeFile({ workspaceId: 'WS-1', path: 'linked-file', content: 'overwritten\n', idempotencyKey: 'CASE-1:symlink-file' }), error => error.code === 'external_path_denied');
      assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'do not read or overwrite\n');
    } finally { await rm(outside, { recursive: true, force: true }); }
    assert.deepEqual(await adapter.disposeWorkspace({ workspaceId: 'WS-1', idempotencyKey: 'CASE-1:dispose' }), { workspaceId: 'WS-1', disposed: true });
  } finally { await adapter.close(); await rm(source, { recursive: true, force: true }); }
});

test('idempotency ledger coalesces concurrent calls and survives a new instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devorbit-idempotency-'));
  let calls = 0;
  try {
    const firstLedger = new IdempotencyLedger({ directory, namespace: 'test', pollIntervalMs: 1 });
    const operation = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 20)); return { build: 42 }; };
    const [first, concurrent] = await Promise.all([
      firstLedger.run('CASE-1:build', { commit: 'abc' }, operation),
      firstLedger.run('CASE-1:build', { commit: 'abc' }, operation)
    ]);
    assert.deepEqual(first, { build: 42 });
    assert.deepEqual(concurrent, first);
    assert.equal(calls, 1);
    const restartedLedger = new IdempotencyLedger({ directory, namespace: 'test', pollIntervalMs: 1 });
    assert.deepEqual(await restartedLedger.run('CASE-1:build', { commit: 'abc' }, async () => { calls += 1; return { build: 43 }; }), first);
    assert.equal(calls, 1);
    await assert.rejects(() => restartedLedger.run('CASE-1:build', { commit: 'different' }, async () => ({})), error => error.code === 'external_idempotency_conflict');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('persistent idempotency fails closed on uncertain outcomes until reconciled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devorbit-idempotency-doubt-'));
  const input = { rollout: 'checkout', version: 'v2' };
  try {
    const firstLedger = new IdempotencyLedger({ directory, namespace: 'release', pollIntervalMs: 1 });
    await assert.rejects(() => firstLedger.run('CASE-2:release', input, async () => { throw new Error('connection lost after PATCH'); }), /connection lost/);
    const restartedLedger = new IdempotencyLedger({ directory, namespace: 'release', pollIntervalMs: 1 });
    await assert.rejects(() => restartedLedger.run('CASE-2:release', input, async () => ({ decision: 'duplicated' })), error => error.code === 'external_idempotency_in_doubt' && error.retryable === false);
    const reconciled = { decision: 'promoted', observedGeneration: 9 };
    await assert.rejects(() => restartedLedger.reconcile('CASE-2:release', input, reconciled), error => error.code === 'external_idempotency_evidence_required');
    assert.deepEqual(await restartedLedger.reconcile('CASE-2:release', { version: 'v2', rollout: 'checkout' }, reconciled, { evidenceRef: 'argo://prod/checkout/generation/9' }), reconciled);
    const finalLedger = new IdempotencyLedger({ directory, namespace: 'release' });
    assert.deepEqual(await finalLedger.run('CASE-2:release', input, async () => ({ decision: 'duplicated' })), reconciled);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('persistent idempotency coalesces concurrent independent ledger instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devorbit-idempotency-multiprocess-'));
  let calls = 0;
  try {
    const left = new IdempotencyLedger({ directory, namespace: 'jenkins', pollIntervalMs: 1 });
    const right = new IdempotencyLedger({ directory, namespace: 'jenkins', pollIntervalMs: 1 });
    const operation = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 25)); return { build: 77 }; };
    const [leftResult, rightResult] = await Promise.all([
      left.run('CASE-3:ci', { commit: 'def' }, operation),
      right.run('CASE-3:ci', { commit: 'def' }, operation)
    ]);
    assert.deepEqual(leftResult, { build: 77 });
    assert.deepEqual(rightResult, leftResult);
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native Jenkins adapter triggers, polls and reports a real build contract', async () => {
  const calls = [];
  const adapter = new JenkinsCiAdapter({ baseUrl: 'https://jenkins.test', jobPath: '/job/checkout', token: 'jenkins-secret', pollIntervalMs: 0, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path === '/crumbIssuer/api/json') return json({}, 404);
    if (path.endsWith('/buildWithParameters')) return json({}, 201, { location: 'https://jenkins.test/queue/item-7/' });
    if (path === '/queue/item-7/') return json({ executable: { number: 42 } });
    if (path.endsWith('/42/api/json')) return json({ number: 42, result: 'SUCCESS', building: false, url: 'https://jenkins.test/job/checkout/42/' });
    if (path.endsWith('/42/testReport/api/json')) return json({ totalCount: 4, failCount: 0, skipCount: 0 });
    throw new Error(`unexpected Jenkins path ${path}`);
  } });
  const result = await adapter.runTests({ workspaceId: 'WS-1', idempotencyKey: 'CASE-1:ci' }, { caseId: 'CASE-1' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.passed, 4);
  const trigger = calls.find(call => call.options.headers['x-devorbit-operation'] === 'jenkins.build.trigger');
  assert.equal(trigger.options.headers.authorization, 'Bearer jenkins-secret');
  assert.equal(trigger.options.headers['idempotency-key'], 'CASE-1:ci');
  assert.equal(new URL(trigger.url).searchParams.get('DEVORBIT_COMMIT'), null);
});

test('native Argo Rollouts adapter promotes healthy status and rolls back degraded status', async () => {
  let mode = 'healthy';
  let argoReads = 0;
  let generation = 7;
  let image = 'checkout:old';
  const requests = [];
  const adapter = new ArgoRolloutsReleaseAdapter({ baseUrl: 'https://kube.test', namespace: 'prod', rollout: 'checkout', container: 'app', token: 'kube-secret', pollIntervalMs: 0, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === 'GET') {
      argoReads += 1;
      if (argoReads % 3 === 1) return json({ metadata: { generation }, spec: { strategy: { canary: { steps: [{ setWeight: 10 }, { pause: { duration: '5m' } }] } }, template: { spec: { containers: [{ name: 'sidecar', image: 'metrics:v1' }, { name: 'app', image }] } } }, status: { phase: 'Healthy', observedGeneration: generation } });
      if (argoReads % 3 === 2) return json({ metadata: { generation }, spec: { template: { spec: { containers: [{ name: 'sidecar', image: 'metrics:v1' }, { name: 'app', image }] } } }, status: { phase: 'Healthy', observedGeneration: generation - 1 } });
      return json({ metadata: { generation }, spec: { template: { spec: { containers: [{ name: 'sidecar', image: 'metrics:v1' }, { name: 'app', image }] } } }, status: { phase: mode === 'healthy' ? 'Healthy' : 'Degraded', observedGeneration: generation, replicas: 3 } });
    }
    assert.equal(options.headers['content-type'], 'application/json-patch+json');
    const patch = JSON.parse(options.body);
    assert.deepEqual(patch.slice(0, 1), [{ op: 'test', path: '/spec/template/spec/containers/1/name', value: 'app' }]);
    image = patch[1].value;
    generation += 1;
    return json({ metadata: { generation } });
  } });
  const promoted = await adapter.canary({ caseId: 'CASE-1', version: 'checkout:new', approvalId: 'APR-1', approvalToken: 'internal-only', idempotencyKey: 'CASE-1:release' }, { caseId: 'CASE-1' });
  assert.equal(promoted.decision, 'promoted');
  assert.equal(requests.some(item => JSON.stringify(item.options.body || '').includes('internal-only')), false);
  mode = 'degraded';
  const rolledBack = await adapter.canary({ caseId: 'CASE-2', version: 'checkout:new2', approvalId: 'APR-2', idempotencyKey: 'CASE-2:release' }, { caseId: 'CASE-2' });
  assert.equal(rolledBack.decision, 'rolled_back');
  assert.equal(rolledBack.rollbackExecuted, true);
  const patches = requests.filter(item => item.options.method === 'PATCH');
  assert.equal(patches.length, 3);
  assert.ok(patches.every(item => JSON.parse(item.options.body).every(operation => !operation.path.includes('/containers') || operation.path.includes('/containers/1/'))));
});

test('native Argo Rollouts adapter fails closed when a 10% step is absent', async () => {
  const adapter = new ArgoRolloutsReleaseAdapter({ baseUrl: 'https://kube.test', namespace: 'prod', rollout: 'checkout', container: 'app', token: 'kube-secret', pollIntervalMs: 0, fetchImpl: async () => json({ metadata: { generation: 1 }, spec: { strategy: { canary: { steps: [{ setWeight: 50 }] } }, template: { spec: { containers: [{ name: 'app', image: 'checkout:old' }] } } }, status: { phase: 'Healthy', observedGeneration: 1 } }) });
  await assert.rejects(() => adapter.canary({ caseId: 'CASE-3', version: 'checkout:new', approvalId: 'APR-3', idempotencyKey: 'CASE-3:release' }, { caseId: 'CASE-3' }), error => error.code === 'external_release_policy_mismatch');
});

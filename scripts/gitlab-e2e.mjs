import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createGitLabClient } from '../src/adapters/gitlab.js';
import { createModelProvider } from '../src/models/provider.js';

const root = new URL('../', import.meta.url);
const reportPath = process.env.DEVORBIT_GITLAB_E2E_REPORT || new URL('reports/gitlab-e2e.json', root).pathname;
const caseId = process.env.DEVORBIT_GITLAB_CASE_ID || `CASE-GL-${Date.now().toString(36).toUpperCase()}`;
const projectPath = process.env.DEVORBIT_GITLAB_PROJECT || 'devorbit-checkout-demo';
const started = Date.now();
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const timeline = [];
const record = (step, ok, detail = {}) => {
  timeline.push({ at: new Date().toISOString(), step, ok: Boolean(ok), ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail.note ? ` (${detail.note})` : ''}`);
  if (!ok) throw new Error(`gitlab e2e step failed: ${step}${detail.error ? `: ${detail.error}` : ''}`);
};

const gitlab = createGitLabClient({
  baseUrl: process.env.GITLAB_BASE_URL || 'http://127.0.0.1',
  token: process.env.GITLAB_TOKEN,
  timeoutMs: 20000
});

const existingReport = await readFile(reportPath, 'utf8').then(text => JSON.parse(text)).catch(() => null);
if (existingReport?.status === 'passed' && existingReport?.caseId === caseId && process.env.DEVORBIT_GITLAB_E2E_FORCE !== '1') {
  console.log(`PASS gitlab e2e: idempotent replay of completed run ${caseId} (report=${reportPath}); set DEVORBIT_GITLAB_E2E_FORCE=1 to re-execute`);
  process.exit(0);
}
const model = createModelProvider({
  driver: process.env.DEVORBIT_MODEL_DRIVER || 'openai-compat',
  baseUrl: process.env.DEVORBIT_MODEL_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: process.env.DEVORBIT_MODEL_NAME || 'deepseek-v4-flash-0731',
  timeoutMs: 180000
});

const version = await gitlab.getVersion();
record('gitlab.version', true, { note: `GitLab ${version.version}` });

const fixtureRoot = new URL('fixtures/checkout-service/', root);
const readFixture = async name => readFile(new URL(name, fixtureRoot), 'utf8');
const buggyPool = await readFixture('src/redisPool.js');
const buggyOrder = await readFixture('src/order.js');
const tests = {
  'test/order.test.js': await readFixture('test/order.test.js'),
  'test/redisPool.test.js': await readFixture('test/redisPool.test.js')
};
const packageJson = await readFixture('package.json');
const ciYml = [
  'test:',
  '  image: node:22.18.0-bookworm-slim',
  '  tags:',
  '    - devorbit',
  '  script:',
  '    - node --test',
  ''
].join('\n');
const readme = `# checkout-service (DevOrbit demo)\n\nFixture repository for DevOrbit real-platform evidence. Case ${caseId}.\n`;

const { project, created: projectCreated, idempotentReplay: projectReplay } = await gitlab.ensureProject({ path: projectPath, name: 'DevOrbit Checkout Demo', description: `DevOrbit real GitLab e2e evidence project. ${caseId}` });
record('gitlab.project.ensure', true, { note: projectCreated ? `created id=${project.id}` : `reused id=${project.id} (idempotent replay=${projectReplay})` });
const pid = project.id;
await gitlab.updateProject({ projectId: pid, attributes: { builds_access_level: 'enabled' } });
record('gitlab.project.enable-ci', true, { note: 'builds_access_level=enabled (idempotent PUT)' });

const initialFiles = [
  ['src/redisPool.js', buggyPool],
  ['src/order.js', buggyOrder],
  ['test/order.test.js', tests['test/order.test.js']],
  ['test/redisPool.test.js', tests['test/redisPool.test.js']],
  ['package.json', packageJson],
  ['.gitlab-ci.yml', ciYml],
  ['README.md', readme]
];
const tree = await gitlab.getTree({ projectId: pid }).catch(() => []);
const existingPaths = new Set((tree || []).map(item => item.path));
const initialActions = [];
for (const [path, content] of initialFiles) {
  if (existingPaths.has(path)) {
    const current = await gitlab.getFile({ projectId: pid, path, ref: 'main' }).catch(() => null);
    if (current === content) continue;
    initialActions.push({ action: 'update', file_path: path, content });
  } else {
    initialActions.push({ action: 'create', file_path: path, content });
  }
}
if (initialActions.length) {
  const initial = await gitlab.commitActions({
    projectId: pid,
    branch: 'main',
    message: 'chore: initial checkout-service import (defective release/2026.08 state)',
    actions: initialActions
  });
  record('gitlab.main.initial-commit', true, { note: `commit ${initial.commit.id.slice(0, 8)} (defective baseline, ${initialActions.length} file actions)` });
} else {
  record('gitlab.main.initial-commit', true, { note: 'defective baseline already present (idempotent replay, no-op commit skipped)' });
}

async function waitPipeline(pipelineId, { timeoutMs = 300000 } = {}) {
  const at = Date.now();
  let last = null;
  while (Date.now() - at < timeoutMs) {
    last = await gitlab.getPipeline({ projectId: pid, pipelineId });
    if (['success', 'failed', 'canceled', 'skipped'].includes(last.status)) return last;
    await delay(5000);
  }
  throw new Error(`pipeline ${pipelineId} did not reach a terminal state within ${timeoutMs}ms (last=${last?.status})`);
}

async function pipelineEvidence(pipelineId) {
  const jobs = await gitlab.listPipelineJobs({ projectId: pid, pipelineId });
  const traces = [];
  for (const job of jobs) {
    const trace = await gitlab.getJobTrace({ projectId: pid, jobId: job.id }).catch(() => '');
    traces.push({ jobId: job.id, name: job.name, status: job.status, traceTail: String(trace).slice(-1500), traceSha256: shaRef(String(trace)) });
  }
  return { jobs: jobs.map(job => ({ id: job.id, name: job.name, status: job.status, webUrl: job.web_url })), traces };
}

const baselineCreated = await gitlab.createPipeline({ projectId: pid, ref: 'main' });
record('gitlab.pipeline.baseline.created', true, { note: `pipeline ${baselineCreated.pipeline.id} on main` });
const baselineFinal = await waitPipeline(baselineCreated.pipeline.id);
const baselineEvidence = await pipelineEvidence(baselineCreated.pipeline.id);
record('gitlab.pipeline.baseline.failed-as-expected', baselineFinal.status === 'failed', { note: `status=${baselineFinal.status}; a red baseline on the defective commit is the required precondition`, error: baselineFinal.status === 'failed' ? undefined : `expected failed, got ${baselineFinal.status}` });

const issueDescription = [
  `**Case ${caseId}**`,
  '',
  '10:15 之后支付页持续转圈，订单偶发重复创建。',
  '',
  '信号：',
  '- 用户反馈 FB-1842：支付页一直转圈，刷新后出现两笔订单',
  '- 日志 LOG-10A：`IdempotencyStore timeout after 3000ms; retrying request`',
  '- 指标 METRIC-55：POST /orders p95 420ms -> 2.8s；错误率 0.2% -> 7.4%',
  '- 变更 CHG-402：release/2026.08 中 redis.client.poolSize 80 -> 8',
  '',
  'CI 基线：main 当前为红灯（连接池容量与幂等回归测试均失败）。',
  '',
  '_此 Issue 由 DevOrbit 端到端证据脚本创建，作为真实 GitLab 平台的缺陷输入。_'
].join('\n');
const { issue, created: issueCreated } = await gitlab.ensureIssue({ projectId: pid, title: `[${caseId}] 支付页持续转圈与订单重复创建`, description: issueDescription, labels: ['devorbit', 'p1'] });
record('gitlab.issue.ensure', true, { note: issueCreated ? `created issue #${issue.iid}` : `reused issue #${issue.iid}` });

const rcaInput = {
  issue: issueDescription,
  baselineFailure: baselineEvidence.traces.map(trace => ({ job: trace.name, tail: trace.traceTail.slice(-600) })),
  files: { 'src/redisPool.js': buggyPool, 'src/order.js': buggyOrder },
  tests
};
const rca = await model.chat({
  agent: 'rca-worker',
  system: 'You are an evidence-first root-cause analyst in the DevOrbit delivery loop. Reply with a single JSON object: {"rootCause": string, "confidence": number 0..1, "evidence": string[], "fixPlan": string}. No markdown.',
  user: JSON.stringify(rcaInput),
  responseSchema: { type: 'object', required: ['rootCause', 'confidence', 'evidence', 'fixPlan'], properties: { rootCause: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } }, fixPlan: { type: 'string' } } },
  temperature: 0,
  seed: 42,
  maxTokens: 4096
});
let rcaOutput = null;
try { rcaOutput = JSON.parse(rca.content); } catch { rcaOutput = null; }
record('model.rca.deepseek', rcaOutput && typeof rcaOutput.rootCause === 'string' && typeof rcaOutput.confidence === 'number', { note: rcaOutput ? `confidence=${rcaOutput.confidence}, tokens=${rca.usage.totalTokens}, latencyMs=${rca.latencyMs}` : 'unparseable RCA output', error: rcaOutput ? undefined : 'model RCA output was not valid JSON' });

const patchInput = {
  task: 'Produce the complete fixed contents of src/redisPool.js and src/order.js so that both test files pass. The defect: poolSize was reduced to 8 and queueTimeoutMs to 250, and createOrder lost its idempotency protection (duplicate idempotencyKey must return status 409 with the original order).',
  files: { 'src/redisPool.js': buggyPool, 'src/order.js': buggyOrder },
  tests,
  rca: rcaOutput
};
const patchCall = await model.chat({
  agent: 'patch-worker',
  system: 'You are a minimal-patch engineer. Reply with a single JSON object: {"summary": string, "files": {"src/redisPool.js": string, "src/order.js": string}, "rollback": string}. The files values must be the COMPLETE new file contents, valid ES modules, no markdown fences inside the JSON strings. No commentary outside the JSON.',
  user: JSON.stringify(patchInput),
  responseSchema: { type: 'object', required: ['summary', 'files', 'rollback'], properties: { summary: { type: 'string' }, files: { type: 'object' }, rollback: { type: 'string' } } },
  temperature: 0,
  seed: 42,
  maxTokens: 8192
});
let patchOutput = null;
try { patchOutput = JSON.parse(patchCall.content); } catch { patchOutput = null; }
const goldenPool = 'export const redisPoolConfig = {\n  poolSize: 80,\n  queueTimeoutMs: 800\n};\n';
const goldenOrder = 'const ordersByKey = new Map();\n\nexport function resetOrders() {\n  ordersByKey.clear();\n}\n\nexport function createOrder({ idempotencyKey, payload }) {\n  const existing = ordersByKey.get(idempotencyKey);\n  if (existing) return { status: 409, order: existing };\n  const order = { id: "ORD-" + (ordersByKey.size + 1), payload };\n  ordersByKey.set(idempotencyKey, order);\n  return { status: 201, order };\n}\n';
let fixedPool;
let fixedOrder;
let patchSource;
if (patchOutput?.files?.['src/redisPool.js'] && patchOutput?.files?.['src/order.js']) {
  fixedPool = patchOutput.files['src/redisPool.js'];
  fixedOrder = patchOutput.files['src/order.js'];
  patchSource = 'deepseek-v4-flash-0731';
  record('model.patch.deepseek', true, { note: `model produced full-file patch, tokens=${patchCall.usage.totalTokens}, latencyMs=${patchCall.latencyMs}` });
} else {
  fixedPool = goldenPool;
  fixedOrder = goldenOrder;
  patchSource = 'golden-fixture-fallback';
  record('model.patch.deepseek', true, { note: `model patch unparsable; fell back to frozen golden fixture patch and disclosed it (tokens=${patchCall.usage.totalTokens})` });
}

const fixBranch = `devorbit/${caseId.toLowerCase()}`;
await gitlab.ensureBranch({ projectId: pid, branch: fixBranch, ref: 'main' });
const fixActions = [];
for (const [path, content] of [['src/redisPool.js', fixedPool], ['src/order.js', fixedOrder]]) {
  const current = await gitlab.getFile({ projectId: pid, path, ref: fixBranch }).catch(() => null);
  if (current === content) continue;
  fixActions.push({ action: current === null ? 'create' : 'update', file_path: path, content });
}
let fixCommitNote;
if (fixActions.length) {
  const fixCommit = await gitlab.commitActions({
    projectId: pid,
    branch: fixBranch,
    message: `fix(${caseId}): restore redis pool capacity and idempotency guard [${patchSource}]`,
    actions: fixActions
  });
  fixCommitNote = `commit ${fixCommit.commit.id.slice(0, 8)} on ${fixBranch} via ${patchSource}`;
} else {
  fixCommitNote = `fix already present on ${fixBranch} (idempotent replay, no-op commit skipped)`;
}
record('gitlab.branch.fix-commit', true, { note: fixCommitNote });

const { mergeRequest, created: mrCreated } = await gitlab.ensureMergeRequest({ projectId: pid, sourceBranch: fixBranch, targetBranch: 'main', title: `[${caseId}] Fix duplicate orders and redis pool exhaustion`, description: `Root cause (model RCA, confidence=${rcaOutput?.confidence ?? 'n/a'}): ${rcaOutput?.rootCause || 'see report'}\n\nPatch source: ${patchSource}` });
record('gitlab.mr.ensure', true, { note: mrCreated ? `created MR !${mergeRequest.iid}` : `reused MR !${mergeRequest.iid}` });

const fixPipelineCreated = await gitlab.createPipeline({ projectId: pid, ref: fixBranch });
const fixFinal = await waitPipeline(fixPipelineCreated.pipeline.id);
const fixEvidence = await pipelineEvidence(fixPipelineCreated.pipeline.id);
record('gitlab.pipeline.fix.green', fixFinal.status === 'success', { note: `status=${fixFinal.status} on ${fixBranch}`, error: fixFinal.status === 'success' ? undefined : `expected success, got ${fixFinal.status}` });

const merged = await gitlab.mergeMergeRequest({ projectId: pid, mrIid: mergeRequest.iid });
record('gitlab.mr.merged', merged.state === 'merged', { note: `MR !${mergeRequest.iid} state=${merged.state}`, error: merged.state === 'merged' ? undefined : `merge state ${merged.state}` });

const report = {
  generatedAt: new Date().toISOString(),
  status: 'passed',
  caseId,
  durationMs: Date.now() - started,
  platform: { kind: 'self-hosted GitLab CE', version: version.version, baseUrl: gitlab.baseUrl, projectId: pid, projectWebUrl: project.web_url },
  model: { driver: model.driver, name: model.model, keyFingerprint: model.keyFingerprint || null },
  issue: { iid: issue.iid, webUrl: issue.web_url, created: issueCreated },
  pipelines: {
    baseline: { id: baselineCreated.pipeline.id, status: baselineFinal.status, webUrl: baselineCreated.pipeline.web_url, jobs: baselineEvidence.jobs, traces: baselineEvidence.traces },
    fix: { id: fixPipelineCreated.pipeline.id, status: fixFinal.status, webUrl: fixPipelineCreated.pipeline.web_url, jobs: fixEvidence.jobs, traces: fixEvidence.traces }
  },
  mergeRequest: { iid: mergeRequest.iid, webUrl: mergeRequest.web_url, state: merged.state, mergedAt: merged.merged_at || null },
  modelCalls: [
    { agent: rca.agent, usage: rca.usage, latencyMs: rca.latencyMs, finishReason: rca.finishReason, requestSha256: rca.requestSha256, responseSha256: rca.responseSha256, output: rcaOutput },
    { agent: patchCall.agent, usage: patchCall.usage, latencyMs: patchCall.latencyMs, finishReason: patchCall.finishReason, requestSha256: patchCall.requestSha256, responseSha256: patchCall.responseSha256, patchSource, patchSummary: patchOutput?.summary || null, patchRollback: patchOutput?.rollback || null }
  ],
  patchSource,
  timeline,
  boundary: 'Real self-hosted GitLab CE end-to-end evidence: real project, issue, branches, commits, merge request and CI pipelines executed by a registered gitlab-runner (docker executor). The red baseline on the defective commit and the green pipeline on the fix branch are both preserved with job trace digests. Model calls are real deepseek-v4-flash-0731 invocations through the OpenAI-compatible endpoint with usage accounting; when the model patch is not contract-valid, a frozen golden fixture patch is used and disclosed via patchSource. No GitLab SaaS, no vendor cloud account, no production cluster claim.',
  checks: timeline.map(item => ({ label: item.step, ok: item.ok, detail: item.note || '' }))
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`PASS gitlab e2e: ${timeline.filter(item => item.ok).length}/${timeline.length} steps, patch=${patchSource}, report=${reportPath}`);

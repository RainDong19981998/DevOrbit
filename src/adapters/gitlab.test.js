const FAKE_GITLAB_TOKEN = 'glpat-' + 'test'.repeat(5) + '-' + '0'.repeat(12);
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGitLabClient, GitLabError } from './gitlab.js';

const noopSleep = async () => {};

function mockFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step.throw) throw step.throw;
    return { ok: step.status >= 200 && step.status < 300, status: step.status, text: async () => step.body };
  };
  return { calls, fetchImpl };
}

const project = { id: 42, path: 'devorbit-checkout-demo', path_with_namespace: `root/devorbit-checkout-demo` };

test('ensureProject creates then replays idempotently', async () => {
  const { calls, fetchImpl } = mockFetch([
    { status: 200, body: '[]' },
    { status: 201, body: JSON.stringify(project) },
    { status: 200, body: JSON.stringify([project]) }
  ]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token: FAKE_GITLAB_TOKEN, fetchImpl, sleep: noopSleep });
  const first = await client.ensureProject({ path: 'devorbit-checkout-demo' });
  assert.equal(first.created, true);
  assert.equal(first.project.id, 42);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers['PRIVATE-TOKEN'], FAKE_GITLAB_TOKEN);
  const second = await client.ensureProject({ path: 'devorbit-checkout-demo' });
  assert.equal(second.created, false);
  assert.equal(second.idempotentReplay, true);
});

test('ensureIssue reuses an open issue with the same title', async () => {
  const issue = { id: 7, iid: 3, title: 'duplicate order defect' };
  const { calls, fetchImpl } = mockFetch([{ status: 200, body: JSON.stringify([issue]) }]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token: FAKE_GITLAB_TOKEN, fetchImpl, sleep: noopSleep });
  const result = await client.ensureIssue({ projectId: 42, title: 'duplicate order defect' });
  assert.equal(result.created, false);
  assert.equal(result.issue.iid, 3);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /projects\/42\/issues/);
});

test('ensureBranch creates only when 404', async () => {
  const { calls, fetchImpl } = mockFetch([
    { status: 404, body: '{"message":"404 Branch Not Found"}' },
    { status: 201, body: JSON.stringify({ name: 'devorbit/case-1' }) }
  ]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token: FAKE_GITLAB_TOKEN, fetchImpl, sleep: noopSleep });
  const result = await client.ensureBranch({ projectId: 42, branch: 'devorbit/case-1', ref: 'main' });
  assert.equal(result.created, true);
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(calls[1].body, { branch: 'devorbit/case-1', ref: 'main' });
});

test('commitActions posts multi-file actions', async () => {
  const { calls, fetchImpl } = mockFetch([{ status: 201, body: JSON.stringify({ id: 'abc123' }) }]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token: FAKE_GITLAB_TOKEN, fetchImpl, sleep: noopSleep });
  const result = await client.commitActions({ projectId: 42, branch: 'main', message: 'fix', actions: [{ action: 'update', file_path: 'src/a.js', content: 'x' }] });
  assert.equal(result.commit.id, 'abc123');
  assert.equal(calls[0].url, 'http://127.0.0.1/api/v4/projects/42/repository/commits');
  assert.equal(calls[0].body.actions.length, 1);
});

test('pipeline polling helpers hit the right endpoints', async () => {
  const { calls, fetchImpl } = mockFetch([
    { status: 201, body: JSON.stringify({ id: 9, status: 'created' }) },
    { status: 200, body: JSON.stringify({ id: 9, status: 'success' }) },
    { status: 200, body: JSON.stringify([{ id: 55, name: 'test', status: 'success' }]) },
    { status: 200, body: 'log-line' }
  ]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token: FAKE_GITLAB_TOKEN, fetchImpl, sleep: noopSleep });
  const created = await client.createPipeline({ projectId: 42, ref: 'devorbit/case-1' });
  assert.equal(created.pipeline.id, 9);
  const polled = await client.getPipeline({ projectId: 42, pipelineId: 9 });
  assert.equal(polled.status, 'success');
  const jobs = await client.listPipelineJobs({ projectId: 42, pipelineId: 9 });
  assert.equal(jobs[0].name, 'test');
  const trace = await client.getJobTrace({ projectId: 42, jobId: 55 });
  assert.equal(trace, 'log-line');
  assert.equal(calls[3].url, 'http://127.0.0.1/api/v4/projects/42/jobs/55/trace');
});

test('retries 429 once then succeeds', async () => {
  const { calls, fetchImpl } = mockFetch([
    { status: 429, body: '{"message":"rate limited"}' },
    { status: 200, body: JSON.stringify(project) }
  ]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token: FAKE_GITLAB_TOKEN, fetchImpl, sleep: noopSleep });
  const result = await client.ensureBranch({ projectId: 42, branch: 'b', ref: 'main' });
  assert.equal(calls.length, 2);
  assert.equal(result.idempotentReplay, true);
  assert.equal(result.branch.path, 'devorbit-checkout-demo');
});

test('never leaks the token in errors and fails closed on repeated server errors for writes', async () => {
  const token = FAKE_GITLAB_TOKEN + '9';
  const { fetchImpl } = mockFetch([{ status: 500, body: `boom ${token}` }]);
  const client = createGitLabClient({ baseUrl: 'http://127.0.0.1', token, fetchImpl, sleep: noopSleep, maxRetries: 1 });
  await assert.rejects(client.ensureIssue({ projectId: 42, title: 'x' }), error => {
    assert.ok(error instanceof GitLabError);
    assert.ok(!error.message.includes(token));
    return true;
  });
  await assert.rejects(client.ensureProject({ path: 'p' }), error => {
    assert.equal(error.inDoubt, false);
    return true;
  });
});

test('rejects insecure remote base URLs and embedded credentials', () => {
  assert.throws(() => createGitLabClient({ baseUrl: 'http://gitlab.example.com', token: 'x' }), /requires HTTPS/);
  assert.throws(() => createGitLabClient({ baseUrl: 'https://user:pw@127.0.0.1', token: 'x' }), /must not be embedded/);
  assert.throws(() => createGitLabClient({ baseUrl: 'http://127.0.0.1' }), /token is required/);
});

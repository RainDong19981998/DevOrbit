import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { ExternalAdapterError, HttpJsonClient, HttpKnowledgeAdapter, HttpObservabilityAdapter } from './http.js';

const exec = promisify(execFile);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

function sha(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }

function canonicalJson(value) {
  const normalize = item => {
    if (Array.isArray(item)) return item.map(child => child === undefined ? null : normalize(child));
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, normalize(item[key])]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

function assertSafeUrl(value, name) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use http or https`);
  if (!localHosts.has(url.hostname) && url.protocol !== 'https:') throw new Error(`${name} requires HTTPS outside localhost`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} must not contain credentials, query, or fragment`);
  return url;
}

function safeSegment(value, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(value || '')) throw new Error(`${name} contains unsafe characters`);
  return value;
}

function safeBranch(value) {
  if (!value || value.startsWith('-') || value.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(value)) throw new Error('git branch is unsafe');
  return value;
}

function lexicalRepoPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.startsWith('/') || relativePath.split('/').some(part => part === '..')) throw new ExternalAdapterError('repository path is outside workspace', { code: 'external_path_denied', retryable: false, operation: 'repository.path' });
  if (relativePath === '.git' || relativePath.startsWith('.git/')) throw new ExternalAdapterError('repository metadata path is denied', { code: 'external_path_denied', retryable: false, operation: 'repository.path' });
  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new ExternalAdapterError('repository path escapes workspace', { code: 'external_path_denied', retryable: false, operation: 'repository.path' });
  return target;
}

function pathDenied(message = 'repository path traverses a symbolic link') {
  return new ExternalAdapterError(message, { code: 'external_path_denied', retryable: false, operation: 'repository.path' });
}

function assertResolvedRepoPath(base, actualPath, { allowRoot = false } = {}) {
  const relativePath = relative(base, actualPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || (!allowRoot && resolve(actualPath) === base)) throw pathDenied('repository path resolves outside a file location');
  if (relativePath.split(sep).includes('.git')) throw pathDenied('repository metadata path is denied');
}

async function safeRepoPath(root, relativePath, { createParents = false } = {}) {
  const target = lexicalRepoPath(root, relativePath);
  const base = await realpath(root);
  if (resolve(root) !== base) throw pathDenied('repository workspace root must not be a symbolic link');
  const parts = relativePath.split('/').filter(part => part && part !== '.');
  let cursor = base;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = resolve(cursor, parts[index]);
    const isTarget = index === parts.length - 1;
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) throw pathDenied();
      if (!isTarget && !entry.isDirectory()) throw pathDenied('repository path parent is not a directory');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!createParents || isTarget) break;
      await mkdir(cursor, { mode: 0o700 });
    }
  }
  return target;
}

async function openRepoParent(root, relativePath, { createParents = false } = {}) {
  const target = await safeRepoPath(root, relativePath, { createParents });
  const base = await realpath(root);
  let parentHandle;
  try {
    parentHandle = await open(dirname(target), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    const actualParent = await realpath(`/proc/self/fd/${parentHandle.fd}`);
    assertResolvedRepoPath(base, actualParent, { allowRoot: true });
    return { base, parentHandle, target: `/proc/self/fd/${parentHandle.fd}/${basename(target)}` };
  } catch (error) {
    await parentHandle?.close();
    if (['ELOOP', 'EMLINK'].includes(error?.code)) throw pathDenied();
    if (error?.code === 'ENOENT' && error?.path?.startsWith('/proc/self/fd/')) throw pathDenied('repository access requires Linux proc file-descriptor isolation');
    throw error;
  }
}

async function writeRepoFile(root, relativePath, content) {
  const { base, parentHandle, target } = await openRepoParent(root, relativePath, { createParents: true });
  let handle;
  try {
    handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW, 0o600);
    const actualTarget = await realpath(`/proc/self/fd/${handle.fd}`);
    assertResolvedRepoPath(base, actualTarget);
    await handle.truncate(0);
    await handle.writeFile(content, 'utf8');
  } catch (error) {
    if (['ELOOP', 'EMLINK'].includes(error?.code)) throw pathDenied();
    throw error;
  } finally {
    await handle?.close();
    await parentHandle.close();
  }
}

async function readRepoFile(root, relativePath) {
  const { base, parentHandle, target } = await openRepoParent(root, relativePath);
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const actualTarget = await realpath(`/proc/self/fd/${handle.fd}`);
    assertResolvedRepoPath(base, actualTarget);
    return await handle.readFile('utf8');
  } catch (error) {
    if (['ELOOP', 'EMLINK'].includes(error?.code)) throw pathDenied();
    throw error;
  } finally {
    await handle?.close();
    await parentHandle.close();
  }
}

async function git(args, cwd, timeoutMs = 120000, extraEnv = {}) {
  try {
    const result = await exec('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv } });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    throw new ExternalAdapterError(`git ${args[0]} failed`, { code: 'external_git_error', retryable: false, operation: `git.${args[0]}`, requestId: error.code || null });
  }
}

export class IdempotencyLedger {
  constructor({ directory = null, namespace = 'default', lockTimeoutMs = 600000, pollIntervalMs = 25 } = {}) {
    this.entries = new Map();
    this.directory = directory ? resolve(directory) : null;
    this.namespace = safeSegment(namespace, 'idempotency namespace');
    this.lockTimeoutMs = lockTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
  }

  paths(key) {
    const id = createHash('sha256').update(`${this.namespace}\0${key}`).digest('hex');
    return { result: resolve(this.directory, `${id}.json`), lock: resolve(this.directory, `${id}.lock`) };
  }

  async readPersisted(path, requestDigest) {
    try {
      const entry = JSON.parse(await readFile(path, 'utf8'));
      if (entry.version !== 1 || entry.requestDigest !== requestDigest) {
        if (entry.requestDigest !== requestDigest) throw new ExternalAdapterError('idempotency key conflicts with a different request', { code: 'external_idempotency_conflict', retryable: false });
        throw new ExternalAdapterError('idempotency record is invalid', { code: 'external_idempotency_corrupt', retryable: false });
      }
      if (!Object.hasOwn(entry, 'result')) throw new ExternalAdapterError('idempotency record has no result', { code: 'external_idempotency_corrupt', retryable: false });
      return entry.result;
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) throw new ExternalAdapterError('idempotency record is invalid JSON', { code: 'external_idempotency_corrupt', retryable: false });
      throw error;
    }
  }

  async readLock(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw new ExternalAdapterError('idempotency lock is invalid JSON', { code: 'external_idempotency_corrupt', retryable: false });
      throw error;
    }
  }

  async writeRecord(path, value) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); } finally { await handle.close(); }
    await rename(temporary, path);
  }

  async tryCreateLock(path, value) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); } finally { await handle.close(); }
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    } finally {
      await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    }
  }

  assertRequestDigest(entry, requestDigest) {
    if (entry?.requestDigest && entry.requestDigest !== requestDigest) throw new ExternalAdapterError('idempotency key conflicts with a different request', { code: 'external_idempotency_conflict', retryable: false });
  }

  async persistentRun(key, requestDigest, operation) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const paths = this.paths(key);
    const persisted = await this.readPersisted(paths.result, requestDigest);
    if (persisted !== undefined) return persisted;
    const waitDeadline = Date.now() + this.lockTimeoutMs;
    let lockAcquired = false;
    while (!lockAcquired) {
      lockAcquired = await this.tryCreateLock(paths.lock, { version: 1, requestDigest, status: 'in_progress', pid: process.pid, createdAt: new Date().toISOString() });
      if (!lockAcquired) {
        const completed = await this.readPersisted(paths.result, requestDigest);
        if (completed !== undefined) return completed;
        const lock = await this.readLock(paths.lock);
        if (!lock) continue;
        this.assertRequestDigest(lock, requestDigest);
        const lockStat = await stat(paths.lock).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
        if (!lockStat) continue;
        const lockAgeMs = Date.now() - lockStat.mtimeMs;
        if (lock.status === 'in_doubt') throw new ExternalAdapterError('idempotent operation outcome is unknown and requires reconciliation', { code: 'external_idempotency_in_doubt', retryable: false });
        if (lockAgeMs > this.lockTimeoutMs) {
          await this.writeRecord(paths.lock, { ...lock, status: 'in_doubt', detectedAt: new Date().toISOString() });
          throw new ExternalAdapterError('idempotent operation outcome is unknown and requires reconciliation', { code: 'external_idempotency_in_doubt', retryable: false });
        }
        if (Date.now() >= waitDeadline) throw new ExternalAdapterError('idempotent operation is still in progress', { code: 'external_idempotency_busy', retryable: true });
        else await new Promise(resolvePromise => setTimeout(resolvePromise, this.pollIntervalMs));
      }
    }
    let completed = false;
    try {
      const persisted = await this.readPersisted(paths.result, requestDigest);
      if (persisted !== undefined) { completed = true; return persisted; }
      const result = await operation();
      if (result === undefined) throw new ExternalAdapterError('idempotent operation returned no result', { code: 'external_contract_error', retryable: false });
      await this.writeRecord(paths.result, { version: 1, requestDigest, completedAt: new Date().toISOString(), result });
      completed = true;
      return result;
    } catch (error) {
      await this.writeRecord(paths.lock, { version: 1, requestDigest, status: 'in_doubt', failedAt: new Date().toISOString(), error: { code: error?.code || 'external_operation_error', message: String(error?.message || error).slice(0, 500) } });
      throw error;
    } finally {
      if (completed) await unlink(paths.lock).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    }
  }

  async reconcile(key, input, result, { evidenceRef } = {}) {
    if (!this.directory) throw new ExternalAdapterError('persistent idempotency directory is required for reconciliation', { code: 'external_idempotency_persistence_required', retryable: false });
    if (!key) throw new ExternalAdapterError('idempotency key is required', { code: 'external_idempotency_required', retryable: false });
    if (typeof evidenceRef !== 'string' || !evidenceRef.trim()) throw new ExternalAdapterError('reconciliation evidence reference is required', { code: 'external_idempotency_evidence_required', retryable: false });
    const requestDigest = sha(canonicalJson(input));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const paths = this.paths(key);
    const persisted = await this.readPersisted(paths.result, requestDigest);
    if (persisted !== undefined) return persisted;
    const lock = await this.readLock(paths.lock);
    if (!lock || lock.status !== 'in_doubt') throw new ExternalAdapterError('idempotent operation is not awaiting reconciliation', { code: 'external_idempotency_not_in_doubt', retryable: false });
    this.assertRequestDigest(lock, requestDigest);
    await this.writeRecord(paths.result, { version: 1, requestDigest, completedAt: new Date().toISOString(), reconciled: true, reconciliationEvidenceRef: evidenceRef.trim(), result });
    await unlink(paths.lock);
    return result;
  }

  async run(key, input, operation) {
    if (!key) throw new ExternalAdapterError('idempotency key is required', { code: 'external_idempotency_required', retryable: false });
    const requestDigest = sha(canonicalJson(input));
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new ExternalAdapterError('idempotency key conflicts with a different request', { code: 'external_idempotency_conflict', retryable: false });
      return existing.promise;
    }
    const promise = (this.directory ? this.persistentRun(key, requestDigest, operation) : operation()).catch(error => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { requestDigest, promise });
    return promise;
  }
}

export class GitHubIssueAdapter {
  constructor({ baseUrl = 'https://api.github.com', token, owner, repo, perPage = 100, fetchImpl, sleep } = {}) {
    this.owner = safeSegment(owner, 'GitHub owner');
    this.repo = safeSegment(repo, 'GitHub repository');
    this.client = new HttpJsonClient({ baseUrl, token, fetchImpl, sleep });
    this.perPage = Math.min(Math.max(Number(perPage) || 100, 1), 100);
  }

  async fetchSignals({ caseId }, context) {
    const issues = await this.client.request(`/repos/${this.owner}/${this.repo}/issues?state=all&per_page=${this.perPage}`, { method: 'GET', idempotent: true, operation: 'github.issue.list', headers: { accept: 'application/vnd.github+json' } });
    if (!Array.isArray(issues)) throw new ExternalAdapterError('GitHub issues response is not an array', { code: 'external_contract_error', retryable: false, operation: 'github.issue.list' });
    const signals = issues.filter(issue => !issue.pull_request).map(issue => ({ source: 'GitHub Issue', id: `GH-ISSUE-${issue.number}`, text: `${issue.title || ''}\n${issue.body || ''}`.trim(), time: issue.updated_at || issue.created_at || '', url: issue.html_url || '', caseId }));
    return { signals, sourceCount: signals.length ? 1 : 0 };
  }
}

export class GitRepositoryAdapter {
  constructor({ repositoryUrl, branch = 'main', sourceRoot = tmpdir(), cloneTimeoutMs = 120000, authorization = null, pushBranches = false } = {}) {
    if (!repositoryUrl) throw new Error('DEVORBIT_GIT_REPOSITORY_URL is required');
    this.repositoryUrl = repositoryUrl;
    const parsed = repositoryUrl.startsWith('file:') ? new URL(repositoryUrl) : assertSafeUrl(repositoryUrl, 'git repository URL');
    if (parsed.protocol === 'http:' && !localHosts.has(parsed.hostname)) throw new Error('git repository URL requires HTTPS outside localhost');
    this.branch = safeBranch(branch);
    this.sourceRoot = sourceRoot;
    this.cloneTimeoutMs = cloneTimeoutMs;
    this.authorization = authorization;
    this.pushBranches = pushBranches;
    this.workspaces = new Map();
    this.baseline = null;
    this.ledger = new IdempotencyLedger();
  }

  async ensureBaseline() {
    if (this.baseline) return this.baseline;
    const workspace = await mkdtemp(`${this.sourceRoot}${sep}devorbit-git-readonly-`);
    try {
      await git(['clone', '--no-tags', '--single-branch', '--branch', this.branch, this.repositoryUrl, workspace], undefined, this.cloneTimeoutMs, this.gitAuthEnv());
      this.baseline = { path: workspace, commit: (await git(['rev-parse', 'HEAD'], workspace, this.cloneTimeoutMs)).stdout };
      return this.baseline;
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }

  async createWorkspace({ workspaceId, idempotencyKey }) {
    return this.ledger.run(idempotencyKey, { workspaceId, repositoryUrl: this.repositoryUrl, branch: this.branch }, async () => {
      const workspace = await mkdtemp(`${this.sourceRoot}${sep}devorbit-git-`);
      try {
        await git(['clone', '--no-tags', '--single-branch', '--branch', this.branch, this.repositoryUrl, workspace], undefined, this.cloneTimeoutMs, this.gitAuthEnv());
        const commit = (await git(['rev-parse', 'HEAD'], workspace, this.cloneTimeoutMs)).stdout;
        this.workspaces.set(workspaceId, { path: workspace, changedPaths: new Set(), remoteBranch: null });
        return { workspaceId, baseCommit: commit, branch: this.branch };
      } catch (error) {
        await rm(workspace, { recursive: true, force: true });
        throw error;
      }
    });
  }

  workspace(workspaceId) {
    const record = this.workspaces.get(workspaceId);
    if (!record) throw new ExternalAdapterError('workspace not found', { code: 'external_workspace_not_found', retryable: false, operation: 'git.workspace' });
    return record;
  }

  gitAuthEnv() {
    return this.authorization ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: ${this.authorization}` } : {};
  }

  async readFile({ workspaceId, path }) {
    const root = workspaceId ? this.workspace(workspaceId).path : (await this.ensureBaseline()).path;
    const content = await readRepoFile(root, path);
    return { path, content, digest: sha(content) };
  }

  async writeFile({ workspaceId, path, content, idempotencyKey }) {
    return this.ledger.run(idempotencyKey, { workspaceId, path, content }, async () => {
      const record = this.workspace(workspaceId);
      await writeRepoFile(record.path, path, content);
      record.changedPaths.add(path);
      return { path, digest: sha(content) };
    });
  }

  async prepareRevision(workspaceId, caseId) {
    const record = this.workspace(workspaceId);
    if (record.changedPaths.size) {
      await git(['add', '--', ...[...record.changedPaths].sort()], record.path, this.cloneTimeoutMs);
      const staged = (await git(['diff', '--cached', '--name-only'], record.path, this.cloneTimeoutMs)).stdout;
      if (staged) await git(['-c', 'user.name=DevOrbit', '-c', 'user.email=devorbit@localhost', 'commit', '-m', `DevOrbit ${caseId}`], record.path, this.cloneTimeoutMs);
      record.changedPaths.clear();
    }
    const commit = (await git(['rev-parse', 'HEAD'], record.path, this.cloneTimeoutMs)).stdout;
    if (this.pushBranches) {
      const normalizedCase = String(caseId).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const remoteBranch = `devorbit/${normalizedCase}`;
      await git(['push', 'origin', `HEAD:refs/heads/${remoteBranch}`], record.path, this.cloneTimeoutMs, this.gitAuthEnv());
      record.remoteBranch = remoteBranch;
    }
    return { repositoryUrl: this.repositoryUrl, commit, branch: record.remoteBranch || this.branch };
  }

  async disposeWorkspace({ workspaceId, idempotencyKey }) {
    return this.ledger.run(idempotencyKey, { workspaceId }, async () => {
      const record = this.workspaces.get(workspaceId);
      if (record?.remoteBranch) await git(['push', 'origin', `:refs/heads/${record.remoteBranch}`], record.path, this.cloneTimeoutMs, this.gitAuthEnv());
      if (record) await rm(record.path, { recursive: true, force: true });
      this.workspaces.delete(workspaceId);
      return { workspaceId, disposed: true };
    });
  }

  async close() {
    await Promise.all([...this.workspaces.values()].map(record => rm(record.path, { recursive: true, force: true })));
    this.workspaces.clear();
    if (this.baseline) await rm(this.baseline.path, { recursive: true, force: true });
    this.baseline = null;
  }
}

function normalizeJenkinsResult(data, testReport, durationMs) {
  const total = Number(testReport?.totalCount || 0);
  const failed = Number(testReport?.failCount || 0) + Number(testReport?.skipCount || 0) * 0;
  const skipped = Number(testReport?.skipCount || 0);
  const passed = Math.max(0, total - failed - skipped);
  const success = data?.result === 'SUCCESS' && failed === 0;
  const evidence = JSON.stringify({ build: data, tests: testReport });
  return { command: `jenkins://${data?.url || 'build'}`, exitCode: success ? 0 : 1, passed, failed, skipped, durationMs, artifact: sha(evidence), outputTail: `${data?.result || 'UNKNOWN'} ${data?.url || ''}`.trim() };
}

export class JenkinsCiAdapter {
  constructor({ baseUrl, jobPath, token, username = null, repository = null, pollIntervalMs = 1000, timeoutMs = 120000, idempotencyDirectory = null, fetchImpl, sleep } = {}) {
    if (!jobPath || jobPath.includes('..') || !jobPath.startsWith('/')) throw new Error('Jenkins jobPath must be an absolute safe path');
    this.jobPath = jobPath.replace(/\/$/, '');
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.repository = repository;
    const authorization = username ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}` : null;
    this.client = new HttpJsonClient({ baseUrl, token: username ? null : token, authorization, timeoutMs: Math.min(timeoutMs, 120000), fetchImpl, sleep });
    this.ledger = new IdempotencyLedger({ directory: idempotencyDirectory, namespace: 'jenkins-ci' });
  }

  async runTests({ workspaceId, idempotencyKey }, context) {
    return this.ledger.run(idempotencyKey, { workspaceId }, async () => {
      const started = Date.now();
      const revision = this.repository ? await this.repository.prepareRevision(workspaceId, context.caseId) : {};
      const parameters = new URLSearchParams({ DEVORBIT_WORKSPACE_ID: workspaceId, DEVORBIT_CASE_ID: context.caseId, DEVORBIT_IDEMPOTENCY_KEY: idempotencyKey, ...(revision.repositoryUrl ? { DEVORBIT_REPOSITORY_URL: revision.repositoryUrl } : {}), ...(revision.commit ? { DEVORBIT_COMMIT: revision.commit } : {}), ...(revision.branch ? { DEVORBIT_BRANCH: revision.branch } : {}) });
      let crumbHeaders = {};
      try {
        const crumb = await this.client.request('/crumbIssuer/api/json', { method: 'GET', idempotent: true, operation: 'jenkins.crumb' });
        if (crumb?.crumbRequestField && crumb?.crumb) crumbHeaders = { [crumb.crumbRequestField]: crumb.crumb };
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      const triggered = await this.client.request(`${this.jobPath}/buildWithParameters?${parameters}`, { method: 'POST', headers: crumbHeaders, idempotencyKey, operation: 'jenkins.build.trigger', returnMeta: true });
      const queueLocation = triggered.headers.location || triggered.data?.queueUrl;
      if (!queueLocation) {
        if (triggered.data?.result) return normalizeJenkinsResult(triggered.data, triggered.data.testReport, Date.now() - started);
        throw new ExternalAdapterError('Jenkins trigger did not return a queue location', { code: 'external_contract_error', retryable: false, operation: 'jenkins.build.trigger' });
      }
      const queueUrl = new URL(queueLocation, this.client.baseUrl);
      const deadline = Date.now() + this.timeoutMs;
      let build;
      while (Date.now() < deadline) {
        const queue = await this.client.request(`${queueUrl.pathname}${queueUrl.search}`, { method: 'GET', idempotent: true, operation: 'jenkins.queue.poll' });
        if (queue?.cancelled) throw new ExternalAdapterError('Jenkins queue item was cancelled', { code: 'external_ci_cancelled', retryable: false, operation: 'jenkins.queue.poll' });
        if (queue?.executable?.number !== undefined) {
          build = await this.client.request(`${this.jobPath}/${queue.executable.number}/api/json`, { method: 'GET', idempotent: true, operation: 'jenkins.build.poll' });
          if (!build.building) break;
        }
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
      if (!build || build.building) throw new ExternalAdapterError('Jenkins build timed out', { code: 'external_timeout', retryable: false, operation: 'jenkins.build.poll' });
      let testReport = null;
      try { testReport = await this.client.request(`${this.jobPath}/${build.number}/testReport/api/json`, { method: 'GET', idempotent: true, operation: 'jenkins.test-report' }); } catch (error) { if (error.code !== 'external_http_error') throw error; }
      return normalizeJenkinsResult(build, testReport, Date.now() - started);
    });
  }
}

export class ArgoRolloutsReleaseAdapter {
  constructor({ baseUrl, namespace, rollout, container = 'app', token, pollIntervalMs = 1000, timeoutMs = 120000, idempotencyDirectory = null, fetchImpl, sleep } = {}) {
    this.namespace = safeSegment(namespace, 'Kubernetes namespace');
    this.rollout = safeSegment(rollout, 'Argo Rollout name');
    this.container = safeSegment(container, 'Kubernetes container');
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.client = new HttpJsonClient({ baseUrl, token, timeoutMs: Math.min(timeoutMs, 120000), fetchImpl, sleep });
    this.ledger = new IdempotencyLedger({ directory: idempotencyDirectory, namespace: `argo-${this.namespace}-${this.rollout}` });
  }

  path() { return `/apis/argoproj.io/v1alpha1/namespaces/${this.namespace}/rollouts/${this.rollout}`; }

  async canary(args, context) {
    const { approvalToken: _approvalToken, idempotencyKey, version, caseId, approvalId } = args;
    return this.ledger.run(idempotencyKey, { version, caseId, approvalId }, async () => {
      const current = await this.client.request(this.path(), { method: 'GET', idempotent: true, operation: 'argo.rollout.get', returnMeta: true });
      const containers = current.data?.spec?.template?.spec?.containers;
      const containerIndex = Array.isArray(containers) ? containers.findIndex(item => item.name === this.container) : -1;
      const currentContainer = containerIndex >= 0 ? containers[containerIndex] : null;
      if (!currentContainer?.image) throw new ExternalAdapterError('Argo Rollout has no configured target container image', { code: 'external_contract_error', retryable: false, operation: 'argo.rollout.get' });
      const currentGeneration = Number(current.data?.metadata?.generation);
      if (!Number.isSafeInteger(currentGeneration) || currentGeneration < 1) throw new ExternalAdapterError('Argo Rollout metadata.generation is required', { code: 'external_contract_error', retryable: false, operation: 'argo.rollout.get' });
      const canarySteps = current.data?.spec?.strategy?.canary?.steps || [];
      if (!canarySteps.some(step => step?.setWeight === 10)) throw new ExternalAdapterError('Argo Rollout must declare an explicit 10% canary step', { code: 'external_release_policy_mismatch', retryable: false, operation: 'argo.rollout.get' });
      const imagePath = `/spec/template/spec/containers/${containerIndex}/image`;
      const patch = [{ op: 'test', path: `/spec/template/spec/containers/${containerIndex}/name`, value: this.container }, { op: 'replace', path: imagePath, value: version }];
      const patched = await this.client.request(this.path(), { method: 'PATCH', body: patch, contentType: 'application/json-patch+json', idempotencyKey, operation: 'argo.rollout.patch' });
      const requiredGeneration = Math.max(currentGeneration + 1, Number(patched?.metadata?.generation) || 0);
      const deadline = Date.now() + this.timeoutMs;
      let status = null;
      while (Date.now() < deadline) {
        status = await this.client.request(this.path(), { method: 'GET', idempotent: true, operation: 'argo.rollout.status' });
        const phase = String(status?.status?.phase || status?.status?.health || '').toLowerCase();
        const observedGeneration = Number(status?.status?.observedGeneration);
        const observedImage = status?.spec?.template?.spec?.containers?.find(item => item.name === this.container)?.image;
        const currentObservation = Number.isSafeInteger(observedGeneration) && observedGeneration >= requiredGeneration && observedImage === version;
        if (currentObservation && ['healthy', 'succeeded', 'complete'].includes(phase)) return { decision: 'promoted', rollbackExecuted: false, healthBefore: current.data?.status || {}, healthAfter: status.status || {}, canary: '10%', observationWindow: `argo rollout generation ${observedGeneration} healthy` };
        if (currentObservation && ['degraded', 'aborted', 'failed', 'error'].includes(phase)) break;
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
      const rollback = await this.client.request(this.path(), { method: 'PATCH', body: [{ op: 'test', path: `/spec/template/spec/containers/${containerIndex}/name`, value: this.container }, { op: 'replace', path: imagePath, value: currentContainer.image }], contentType: 'application/json-patch+json', idempotencyKey: `${idempotencyKey}:rollback`, operation: 'argo.rollout.rollback' });
      const rollbackGeneration = Math.max(requiredGeneration + 1, Number(rollback?.metadata?.generation) || 0);
      const rollbackDeadline = Date.now() + this.timeoutMs;
      let restored = false;
      while (Date.now() < rollbackDeadline) {
        const rollbackStatus = await this.client.request(this.path(), { method: 'GET', idempotent: true, operation: 'argo.rollout.rollback-status' });
        const image = rollbackStatus?.spec?.template?.spec?.containers?.find(item => item.name === this.container)?.image;
        const phase = String(rollbackStatus?.status?.phase || rollbackStatus?.status?.health || '').toLowerCase();
        const observedGeneration = Number(rollbackStatus?.status?.observedGeneration);
        if (image === currentContainer.image && Number.isSafeInteger(observedGeneration) && observedGeneration >= rollbackGeneration && ['healthy', 'succeeded', 'complete'].includes(phase)) { restored = true; break; }
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
      if (!restored) throw new ExternalAdapterError('Argo Rollout rollback could not be verified', { code: 'external_rollback_unverified', retryable: false, operation: 'argo.rollout.rollback-status' });
      return { decision: 'rolled_back', rollbackExecuted: true, healthBefore: current.data?.status || {}, healthAfter: status?.status || {}, canary: '10%', observationWindow: 'argo rollout health gate' };
    });
  }
}

export function createNativePlatformProvidersFromEnv(options = {}) {
  const platform = options.platform || process.env.DEVORBIT_PLATFORM;
  if (!platform) return null;
  if (platform !== 'github-jenkins-argo') throw new Error(`unsupported DEVORBIT_PLATFORM: ${platform}`);
  const token = options.token || process.env.DEVORBIT_PLATFORM_TOKEN;
  if (!token) throw new Error('DEVORBIT_PLATFORM_TOKEN is required for native platform mode');
  const idempotencyDirectory = options.idempotencyDirectory || process.env.DEVORBIT_IDEMPOTENCY_DIR;
  if (!idempotencyDirectory) throw new Error('DEVORBIT_IDEMPOTENCY_DIR is required for durable native platform writes');
  const issue = new GitHubIssueAdapter({ baseUrl: options.githubApiBaseUrl || process.env.DEVORBIT_GITHUB_API_BASE_URL || 'https://api.github.com', token: options.githubToken || process.env.DEVORBIT_GITHUB_TOKEN || token, owner: options.githubOwner || process.env.DEVORBIT_GITHUB_OWNER, repo: options.githubRepo || process.env.DEVORBIT_GITHUB_REPO, fetchImpl: options.fetchImpl, sleep: options.sleep });
  const gitToken = options.gitToken || process.env.DEVORBIT_GIT_TOKEN || token;
  const repository = new GitRepositoryAdapter({ repositoryUrl: options.repositoryUrl || process.env.DEVORBIT_GIT_REPOSITORY_URL, branch: options.branch || process.env.DEVORBIT_GIT_BRANCH || 'main', authorization: options.gitAuthorization || process.env.DEVORBIT_GIT_AUTHORIZATION || `Bearer ${gitToken}`, pushBranches: options.pushBranches ?? process.env.DEVORBIT_GIT_PUSH_BRANCHES === 'true', sourceRoot: options.sourceRoot });
  const ci = new JenkinsCiAdapter({ baseUrl: options.jenkinsBaseUrl || process.env.DEVORBIT_JENKINS_BASE_URL, jobPath: options.jenkinsJobPath || process.env.DEVORBIT_JENKINS_JOB_PATH, token: options.jenkinsToken || process.env.DEVORBIT_JENKINS_TOKEN || token, username: options.jenkinsUsername || process.env.DEVORBIT_JENKINS_USERNAME || null, repository, idempotencyDirectory, fetchImpl: options.fetchImpl, sleep: options.sleep, pollIntervalMs: options.pollIntervalMs || 1000 });
  const release = new ArgoRolloutsReleaseAdapter({ baseUrl: options.argoBaseUrl || process.env.DEVORBIT_ARGO_BASE_URL, namespace: options.argoNamespace || process.env.DEVORBIT_ARGO_NAMESPACE, rollout: options.argoRollout || process.env.DEVORBIT_ARGO_ROLLOUT, container: options.argoContainer || process.env.DEVORBIT_ARGO_CONTAINER || 'app', token: options.argoToken || process.env.DEVORBIT_ARGO_TOKEN || token, idempotencyDirectory, fetchImpl: options.fetchImpl, sleep: options.sleep, pollIntervalMs: options.pollIntervalMs || 1000 });
  const observabilityBaseUrl = options.observabilityBaseUrl || process.env.DEVORBIT_OBSERVABILITY_BASE_URL;
  const knowledgeBaseUrl = options.knowledgeBaseUrl || process.env.DEVORBIT_KNOWLEDGE_BASE_URL;
  if (!observabilityBaseUrl || !knowledgeBaseUrl) throw new Error('DEVORBIT_OBSERVABILITY_BASE_URL and DEVORBIT_KNOWLEDGE_BASE_URL are required for native platform mode');
  const observability = new HttpObservabilityAdapter(new HttpJsonClient({ baseUrl: observabilityBaseUrl, token: options.observabilityToken || token, fetchImpl: options.fetchImpl, sleep: options.sleep }));
  const knowledge = new HttpKnowledgeAdapter(new HttpJsonClient({ baseUrl: knowledgeBaseUrl, token: options.knowledgeToken || token, fetchImpl: options.fetchImpl, sleep: options.sleep }));
  return { issue, observability, repository, ci, knowledge, release };
}

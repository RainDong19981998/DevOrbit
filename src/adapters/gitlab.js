import { setTimeout as delay } from 'node:timers/promises';

export class GitLabError extends Error {
  constructor(message, { code = 'gitlab_error', status = null, retryable = false, inDoubt = false, operation } = {}) {
    super(message);
    this.name = 'GitLabError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.inDoubt = inDoubt;
    this.operation = operation;
  }
}

function boundedInteger(value, fallback, { name, minimum, maximum }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function redactToken(text, token) {
  let out = String(text ?? '');
  if (token) out = out.split(token).join('[REDACTED]');
  return out.slice(0, 400);
}

export function createGitLabClient({ baseUrl, token, timeoutMs = 15000, maxRetries = 2, maxResponseBytes = 4 * 1024 * 1024, fetchImpl = globalThis.fetch, sleep = delay } = {}) {
  if (!baseUrl) throw new Error('gitlab baseUrl is required');
  if (!token) throw new GitLabError('gitlab token is required; refusing anonymous platform access', { code: 'gitlab_token_required' });
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('gitlab baseUrl must use http or https');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('gitlab requires HTTPS outside localhost');
  if (url.username || url.password) throw new Error('gitlab credentials must not be embedded in baseUrl');
  if (url.search || url.hash) throw new Error('gitlab baseUrl cannot contain query or fragment');
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable');
  const base = url.toString().replace(/\/+$/, '');
  const boundedTimeout = boundedInteger(timeoutMs, 15000, { name: 'timeoutMs', minimum: 500, maximum: 120000 });
  const boundedRetries = boundedInteger(maxRetries, 2, { name: 'maxRetries', minimum: 0, maximum: 5 });
  const boundedResponse = boundedInteger(maxResponseBytes, 4 * 1024 * 1024, { name: 'maxResponseBytes', minimum: 4096, maximum: 64 * 1024 * 1024 });

  async function request(method, path, { body, allow404 = false, operation, rawText = false } = {}) {
    let attempt = 0;
    for (;;) {
      const at = Date.now();
      let response;
      try {
        response = await fetchImpl(`${base}/api/v4${path}`, {
          method,
          headers: {
            'PRIVATE-TOKEN': token,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(boundedTimeout)
        });
      } catch (error) {
        const retryable = error.name === 'TimeoutError' || error.name === 'AbortError' || ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'].includes(error.code);
        if (retryable && attempt < boundedRetries) {
          attempt += 1;
          await sleep(2 ** attempt * 500);
          continue;
        }
        throw new GitLabError(`gitlab ${method} ${path} failed: ${redactToken(error.message, token)}`, { code: 'gitlab_request_failed', retryable, inDoubt: retryable && method !== 'GET', operation });
      }
      const text = await response.text();
      if (text.length > boundedResponse) throw new GitLabError(`gitlab response exceeded ${boundedResponse} bytes`, { code: 'gitlab_response_too_large', status: response.status, operation });
      if (response.status === 404 && allow404) return { status: 404, data: null, latencyMs: Date.now() - at, attempts: attempt + 1 };
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        if (retryable && attempt < boundedRetries) {
          attempt += 1;
          await sleep(2 ** attempt * 500);
          continue;
        }
        throw new GitLabError(`gitlab ${method} ${path} HTTP ${response.status}: ${redactToken(text, token)}`, { code: 'gitlab_http_error', status: response.status, retryable, inDoubt: retryable && method !== 'GET', operation });
      }
      let data = null;
      if (text) {
        if (rawText) {
          data = text;
        } else {
          try { data = JSON.parse(text); } catch { throw new GitLabError(`gitlab ${method} ${path} returned invalid JSON`, { code: 'gitlab_invalid_json', status: response.status, operation }); }
        }
      }
      return { status: response.status, data, latencyMs: Date.now() - at, attempts: attempt + 1 };
    }
  }

  const encodeProject = projectId => encodeURIComponent(String(projectId));

  return {
    baseUrl: base,
    async getVersion() {
      return (await request('GET', '/version', { operation: 'meta.version' })).data;
    },
    async ensureProject({ path, name, description = '', visibility = 'private' }) {
      const existing = await request('GET', `/projects?search=${encodeURIComponent(path)}&owned=true&per_page=50`, { operation: 'project.search' });
      const found = (existing.data || []).find(item => item.path === path);
      if (found) return { project: found, created: false, idempotentReplay: true };
      const created = await request('POST', '/projects', { body: { path, name: name || path, description, visibility, initialize_with_readme: false, auto_devops_enabled: false }, operation: 'project.create' });
      return { project: created.data, created: true, idempotentReplay: false };
    },
    async updateProject({ projectId, attributes }) {
      const updated = await request('PUT', `/projects/${encodeProject(projectId)}`, { body: attributes, operation: 'project.update' });
      return { project: updated.data };
    },
    async ensureIssue({ projectId, title, description = '', labels = [] }) {
      const pid = encodeProject(projectId);
      const existing = await request('GET', `/projects/${pid}/issues?search=${encodeURIComponent(title)}&state=opened&per_page=50`, { operation: 'issue.search' });
      const found = (existing.data || []).find(item => item.title === title);
      if (found) return { issue: found, created: false, idempotentReplay: true };
      const created = await request('POST', `/projects/${pid}/issues`, { body: { title, description, labels: labels.join(',') }, operation: 'issue.create' });
      return { issue: created.data, created: true, idempotentReplay: false };
    },
    async ensureBranch({ projectId, branch, ref }) {
      const pid = encodeProject(projectId);
      const existing = await request('GET', `/projects/${pid}/repository/branches/${encodeURIComponent(branch)}`, { allow404: true, operation: 'branch.get' });
      if (existing.status !== 404) return { branch: existing.data, created: false, idempotentReplay: true };
      const created = await request('POST', `/projects/${pid}/repository/branches`, { body: { branch, ref }, operation: 'branch.create' });
      return { branch: created.data, created: true, idempotentReplay: false };
    },
    async commitActions({ projectId, branch, message, actions, authorName = 'DevOrbit', authorEmail = 'devorbit@localhost' }) {
      const pid = encodeProject(projectId);
      const created = await request('POST', `/projects/${pid}/repository/commits`, {
        body: { branch, commit_message: message, actions, author_name: authorName, author_email: authorEmail },
        operation: 'repository.commit'
      });
      return { commit: created.data };
    },
    async ensureMergeRequest({ projectId, sourceBranch, targetBranch, title, description = '' }) {
      const pid = encodeProject(projectId);
      const existing = await request('GET', `/projects/${pid}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened&per_page=20`, { operation: 'mr.search' });
      const found = (existing.data || []).find(item => item.source_branch === sourceBranch && item.target_branch === targetBranch);
      if (found) return { mergeRequest: found, created: false, idempotentReplay: true };
      const created = await request('POST', `/projects/${pid}/merge_requests`, { body: { source_branch: sourceBranch, target_branch: targetBranch, title, description, remove_source_branch: true }, operation: 'mr.create' });
      return { mergeRequest: created.data, created: true, idempotentReplay: false };
    },
    async createPipeline({ projectId, ref }) {
      const pid = encodeProject(projectId);
      const created = await request('POST', `/projects/${pid}/pipeline`, { body: { ref }, operation: 'pipeline.create' });
      return { pipeline: created.data };
    },
    async getPipeline({ projectId, pipelineId }) {
      return (await request('GET', `/projects/${encodeProject(projectId)}/pipelines/${pipelineId}`, { operation: 'pipeline.get' })).data;
    },
    async listPipelineJobs({ projectId, pipelineId }) {
      return (await request('GET', `/projects/${encodeProject(projectId)}/pipelines/${pipelineId}/jobs?per_page=100`, { operation: 'pipeline.jobs' })).data;
    },
    async getJobTrace({ projectId, jobId }) {
      return (await request('GET', `/projects/${encodeProject(projectId)}/jobs/${jobId}/trace`, { operation: 'job.trace', rawText: true })).data;
    },
    async getMergeRequest({ projectId, mrIid }) {
      return (await request('GET', `/projects/${encodeProject(projectId)}/merge_requests/${mrIid}`, { operation: 'mr.get' })).data;
    },
    async getTree({ projectId, ref = null, recursive = true }) {
      const query = `?per_page=100&recursive=${recursive}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
      return (await request('GET', `/projects/${encodeProject(projectId)}/repository/tree${query}`, { operation: 'repository.tree' })).data;
    },
    async getFile({ projectId, path, ref = 'main' }) {
      const result = await request('GET', `/projects/${encodeProject(projectId)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`, { operation: 'repository.file', allow404: true, rawText: true });
      return result.status === 404 ? null : result.data;
    },
    async mergeMergeRequest({ projectId, mrIid }) {
      return (await request('PUT', `/projects/${encodeProject(projectId)}/merge_requests/${mrIid}/merge`, { body: { should_remove_source_branch: true }, operation: 'mr.merge' })).data;
    }
  };
}

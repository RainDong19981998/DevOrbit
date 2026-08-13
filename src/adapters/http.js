import { setTimeout as delay } from 'node:timers/promises';

export const HTTP_ADAPTER_OPERATIONS = Object.freeze({
  'issue.fetch_signals': Object.freeze({ method: 'POST', path: '/v1/issue/signals', readOnly: true, requiresIdempotencyKey: false }),
  'observability.fetch_signals': Object.freeze({ method: 'POST', path: '/v1/observability/signals', readOnly: true, requiresIdempotencyKey: false }),
  'repository.read_file': Object.freeze({ method: 'POST', path: '/v1/repository/file', readOnly: true, requiresIdempotencyKey: false }),
  'repository.create_workspace': Object.freeze({ method: 'POST', path: '/v1/repository/workspaces', readOnly: false, requiresIdempotencyKey: true }),
  'repository.write_file': Object.freeze({ method: 'PUT', path: '/v1/repository/file', readOnly: false, requiresIdempotencyKey: true }),
  'repository.dispose_workspace': Object.freeze({ method: 'POST', path: '/v1/repository/workspaces/dispose', readOnly: false, requiresIdempotencyKey: true }),
  'ci.run_tests': Object.freeze({ method: 'POST', path: '/v1/ci/tests', readOnly: false, requiresIdempotencyKey: true }),
  'knowledge.search_cases': Object.freeze({ method: 'POST', path: '/v1/knowledge/search', readOnly: true, requiresIdempotencyKey: false }),
  'knowledge.write_case': Object.freeze({ method: 'POST', path: '/v1/knowledge/cases', readOnly: false, requiresIdempotencyKey: true }),
  'release.canary': Object.freeze({ method: 'POST', path: '/v1/release/canary', readOnly: false, requiresIdempotencyKey: true })
});

export class ExternalAdapterError extends Error {
  constructor(message, { code = 'external_adapter_error', status = null, retryable = false, operation, requestId = null } = {}) {
    super(message);
    this.name = 'ExternalAdapterError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.operation = operation;
    this.requestId = requestId;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return { raw: value.slice(0, 2000) }; }
}

function boundedInteger(value, fallback, { name, minimum, maximum }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

function correlationHeaders(context = {}) {
  return {
    ...(context.traceId ? { 'x-devorbit-trace-id': context.traceId } : {}),
    ...(context.caseId ? { 'x-devorbit-case-id': context.caseId } : {}),
    ...(context.agent ? { 'x-devorbit-agent': context.agent } : {})
  };
}

function requestOperation(client, operation, { body, context, idempotencyKey } = {}) {
  const contract = HTTP_ADAPTER_OPERATIONS[operation];
  if (!contract) throw new Error(`unknown HTTP adapter operation: ${operation}`);
  if (contract.requiresIdempotencyKey && !idempotencyKey) throw new ExternalAdapterError(`${operation} requires an idempotency key`, { code: 'external_idempotency_required', retryable: false, operation });
  return client.request(contract.path, {
    method: contract.method,
    body,
    headers: correlationHeaders(context),
    idempotencyKey,
    idempotent: contract.readOnly,
    operation
  });
}

export class HttpJsonClient {
  constructor({ baseUrl, token = null, timeoutMs = 8000, maxRetries = 2, maxRequestBytes = 2 * 1024 * 1024, maxResponseBytes = 2 * 1024 * 1024, fetchImpl = globalThis.fetch, sleep = delay } = {}) {
    if (!baseUrl) throw new Error('external adapter baseUrl is required');
    if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable');
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) throw new Error('external adapter baseUrl must use http or https');
    const local = ['localhost', '127.0.0.1', '::1'].includes(this.baseUrl.hostname);
    if (this.baseUrl.protocol !== 'https:' && !local) throw new Error('external adapter requires HTTPS outside localhost');
    if (this.baseUrl.username || this.baseUrl.password) throw new Error('external adapter credentials must not be embedded in baseUrl');
    if (this.baseUrl.search || this.baseUrl.hash) throw new Error('external adapter baseUrl cannot contain query or fragment');
    if (this.baseUrl.pathname !== '/' && this.baseUrl.pathname !== '') throw new Error('external adapter baseUrl cannot contain a path prefix');
    this.token = token;
    this.timeoutMs = boundedInteger(timeoutMs, 8000, { name: 'timeoutMs', minimum: 100, maximum: 120000 });
    this.maxRetries = boundedInteger(maxRetries, 2, { name: 'maxRetries', minimum: 0, maximum: 5 });
    this.maxRequestBytes = boundedInteger(maxRequestBytes, 2 * 1024 * 1024, { name: 'maxRequestBytes', minimum: 1024, maximum: 16 * 1024 * 1024 });
    this.maxResponseBytes = boundedInteger(maxResponseBytes, 2 * 1024 * 1024, { name: 'maxResponseBytes', minimum: 1024, maximum: 16 * 1024 * 1024 });
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  async request(path, { method = 'POST', body = undefined, headers = {}, idempotencyKey = null, idempotent = false, operation = path } = {}) {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) throw new Error('external adapter path cannot change origin');
    const normalizedMethod = method.toUpperCase();
    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod);
    const retryBudget = safeMethod || idempotent || idempotencyKey ? this.maxRetries : 0;
    let encodedBody;
    try {
      encodedBody = body === undefined ? undefined : JSON.stringify(body);
    } catch (error) {
      throw new ExternalAdapterError(`external ${operation} request is not JSON serializable: ${error.message}`, { code: 'external_request_invalid', retryable: false, operation });
    }
    if (encodedBody && new TextEncoder().encode(encodedBody).byteLength > this.maxRequestBytes) {
      throw new ExternalAdapterError(`external ${operation} request too large`, { code: 'external_request_too_large', retryable: false, operation });
    }
    let lastError = null;
    for (let attempt = 0; attempt <= retryBudget; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const requestHeaders = {
          ...headers,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-devorbit-operation': operation,
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
        };
        const response = await this.fetchImpl(url, {
          method: normalizedMethod,
          headers: requestHeaders,
          body: encodedBody,
          signal: controller.signal,
          redirect: 'error'
        });
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > this.maxResponseBytes) throw new ExternalAdapterError(`external ${operation} response too large`, { code: 'external_response_too_large', status: response.status, retryable: false, operation });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > this.maxResponseBytes) throw new ExternalAdapterError(`external ${operation} response too large`, { code: 'external_response_too_large', status: response.status, retryable: false, operation });
        const text = new TextDecoder().decode(bytes);
        if (response.ok && text && !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
          throw new ExternalAdapterError(`external ${operation} returned non-JSON content`, { code: 'external_contract_error', status: response.status, retryable: false, operation });
        }
        const payload = text ? safeJson(text) : null;
        if (response.ok) return payload;
        const retryable = isRetryableStatus(response.status);
        lastError = new ExternalAdapterError(`external ${operation} failed with HTTP ${response.status}`, {
          code: payload?.error?.code || payload?.code || 'external_http_error',
          status: response.status,
          retryable,
          operation,
          requestId: response.headers.get('x-request-id')
        });
        if (!retryable || attempt === retryBudget) throw lastError;
      } catch (error) {
        if (error instanceof ExternalAdapterError && !error.retryable) throw error;
        lastError = error.name === 'AbortError'
          ? new ExternalAdapterError(`external ${operation} timed out`, { code: 'external_timeout', retryable: true, operation })
          : error instanceof ExternalAdapterError
            ? error
            : new ExternalAdapterError(`external ${operation} network error: ${error.message}`, { code: 'external_network_error', retryable: true, operation });
        if (attempt === retryBudget) throw lastError;
      } finally {
        clearTimeout(timer);
      }
      await this.sleep(50 * (2 ** attempt));
    }
    throw lastError || new ExternalAdapterError(`external ${operation} failed`, { operation });
  }
}

function requireObject(value, operation) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExternalAdapterError(`${operation} returned non-object`, { code: 'external_contract_error', operation });
  return value;
}

function requireArray(value, field, operation) {
  if (!Array.isArray(value[field])) throw new ExternalAdapterError(`${operation} response missing ${field}[]`, { code: 'external_contract_error', operation });
  return value;
}

export class HttpIssueAdapter {
  constructor(client) { this.client = client; }
  async fetchSignals({ caseId }, context) {
    const output = requireArray(requireObject(await requestOperation(this.client, 'issue.fetch_signals', { body: { caseId }, context }), 'issue.fetch_signals'), 'signals', 'issue.fetch_signals');
    return { signals: output.signals, sourceCount: Number.isInteger(output.sourceCount) ? output.sourceCount : new Set(output.signals.map(item => item.source)).size };
  }
}

export class HttpObservabilityAdapter {
  constructor(client) { this.client = client; }
  async fetchSignals({ caseId }, context) {
    const output = requireArray(requireObject(await requestOperation(this.client, 'observability.fetch_signals', { body: { caseId }, context }), 'observability.fetch_signals'), 'signals', 'observability.fetch_signals');
    return { signals: output.signals, sourceCount: Number.isInteger(output.sourceCount) ? output.sourceCount : new Set(output.signals.map(item => item.source)).size };
  }
}

export class HttpRepositoryAdapter {
  constructor(client) { this.client = client; }
  createWorkspace(args, context) { return requestOperation(this.client, 'repository.create_workspace', { body: args, context, idempotencyKey: args.idempotencyKey }); }
  readFile(args, context) { return requestOperation(this.client, 'repository.read_file', { body: args, context }); }
  writeFile(args, context) { return requestOperation(this.client, 'repository.write_file', { body: args, context, idempotencyKey: args.idempotencyKey }); }
  disposeWorkspace(args, context) { return requestOperation(this.client, 'repository.dispose_workspace', { body: args, context, idempotencyKey: args.idempotencyKey }); }
}

export class HttpCiAdapter {
  constructor(client) { this.client = client; }
  runTests(args, context) { return requestOperation(this.client, 'ci.run_tests', { body: args, context, idempotencyKey: args.idempotencyKey }); }
}

export class HttpKnowledgeAdapter {
  constructor(client) { this.client = client; }
  searchCases(args, context) { return requestOperation(this.client, 'knowledge.search_cases', { body: args, context }); }
  writeCase(args, context) { return requestOperation(this.client, 'knowledge.write_case', { body: args, context, idempotencyKey: args.idempotencyKey }); }
}

export class HttpReleaseAdapter {
  constructor(client) { this.client = client; }
  canary(args, context) {
    const { approvalToken: _approvalToken, ...externalArgs } = args;
    return requestOperation(this.client, 'release.canary', { body: externalArgs, context, idempotencyKey: args.idempotencyKey });
  }
}

export function createHttpProviders({ baseUrl, token = process.env.DEVORBIT_ADAPTER_TOKEN, timeoutMs, maxRetries, maxRequestBytes, maxResponseBytes, fetchImpl, sleep } = {}) {
  const client = new HttpJsonClient({ baseUrl, token, timeoutMs, maxRetries, maxRequestBytes, maxResponseBytes, fetchImpl, sleep });
  return {
    issue: new HttpIssueAdapter(client),
    observability: new HttpObservabilityAdapter(client),
    repository: new HttpRepositoryAdapter(client),
    ci: new HttpCiAdapter(client),
    knowledge: new HttpKnowledgeAdapter(client),
    release: new HttpReleaseAdapter(client)
  };
}

export function createHttpProvidersFromEnv(options = {}) {
  const baseUrl = options.baseUrl || process.env.DEVORBIT_ADAPTER_BASE_URL;
  return baseUrl ? createHttpProviders({
    timeoutMs: process.env.DEVORBIT_ADAPTER_TIMEOUT_MS,
    maxRetries: process.env.DEVORBIT_ADAPTER_MAX_RETRIES,
    maxRequestBytes: process.env.DEVORBIT_ADAPTER_MAX_REQUEST_BYTES,
    maxResponseBytes: process.env.DEVORBIT_ADAPTER_MAX_RESPONSE_BYTES,
    ...options,
    baseUrl
  }) : null;
}

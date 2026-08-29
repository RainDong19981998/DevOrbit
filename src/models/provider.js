import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const MODEL_DRIVERS = Object.freeze(['ollama', 'openai-compat', 'fixture']);

export const DEFAULT_OPENAI_COMPAT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_OPENAI_COMPAT_MODEL = 'deepseek-v4-flash-0731';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const shaRef = value => `sha256:${sha256(value)}`;

export class ModelProviderError extends Error {
  constructor(message, { code = 'model_provider_error', status = null, retryable = false, driver = null } = {}) {
    super(message);
    this.name = 'ModelProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.driver = driver;
  }
}

function boundedInteger(value, fallback, { name, minimum, maximum }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

function normalizeBaseUrl(raw, { allowLocalHttp = true } = {}) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('model provider baseUrl must use http or https');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocalHttp && local)) throw new Error('model provider requires HTTPS outside localhost');
  if (url.username || url.password) throw new Error('model provider credentials must not be embedded in baseUrl');
  if (url.hash) throw new Error('model provider baseUrl cannot contain a fragment');
  return url.toString().replace(/\/+$/, '');
}

function sanitizeErrorText(text, apiKey) {
  let out = String(text ?? '');
  if (apiKey) out = out.split(apiKey).join('[REDACTED]');
  return out.slice(0, 500);
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function postJson({ url, headers, body, timeoutMs, maxRetries, fetchImpl, sleep, apiKey, maxResponseBytes }) {
  const payload = JSON.stringify(body);
  let attempt = 0;
  for (;;) {
    const at = Date.now();
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await response.text();
      if (text.length > maxResponseBytes) throw new ModelProviderError(`model response exceeded ${maxResponseBytes} bytes`, { code: 'model_response_too_large', status: response.status });
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(2 ** attempt * 500);
          continue;
        }
        throw new ModelProviderError(`model HTTP ${response.status}: ${sanitizeErrorText(text, apiKey)}`, { code: 'model_http_error', status: response.status, retryable });
      }
      let envelope;
      try { envelope = JSON.parse(text); } catch { throw new ModelProviderError('model returned invalid JSON', { code: 'model_invalid_json', status: response.status }); }
      return { envelope, latencyMs: Date.now() - at, attempts: attempt + 1, requestSha256: shaRef(payload), responseSha256: shaRef(text) };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      const retryable = error.name === 'TimeoutError' || error.name === 'AbortError' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED';
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new ModelProviderError(`model request failed: ${sanitizeErrorText(error.message, apiKey)}`, { code: 'model_request_failed', retryable });
    }
  }
}

function openAiCompatProvider({ baseUrl, apiKey, model, timeoutMs, maxRetries, maxResponseBytes, fetchImpl, sleep }) {
  const url = `${baseUrl}/chat/completions`;
  return {
    driver: 'openai-compat',
    model,
    keyFingerprint: sha256(apiKey).slice(0, 12),
    async chat({ agent = 'agent', system, user, responseSchema = null, temperature = 0, seed = null, maxTokens = 2048, enableThinking = undefined } = {}) {
      const body = {
        model,
        stream: false,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) }
        ],
        temperature,
        max_tokens: maxTokens,
        ...(seed === null || seed === undefined ? {} : { seed }),
        ...(responseSchema ? { response_format: { type: 'json_object' } } : {}),
        ...(enableThinking === false ? { enable_thinking: false } : {}),
        ...(enableThinking === true ? { enable_thinking: true } : {})
      };
      const { envelope, latencyMs, attempts, requestSha256, responseSha256 } = await postJson({ url, headers: { authorization: `Bearer ${apiKey}` }, body, timeoutMs, maxRetries, fetchImpl, sleep, apiKey, maxResponseBytes });
      const message = envelope.choices?.[0]?.message;
      if (!message || typeof message.content !== 'string') throw new ModelProviderError('openai-compat response missing choices[0].message.content', { code: 'model_bad_envelope', driver: 'openai-compat' });
      return {
        agent,
        driver: 'openai-compat',
        model: envelope.model || model,
        content: message.content,
        reasoningContent: typeof message.reasoning_content === 'string' ? message.reasoning_content : null,
        finishReason: envelope.choices?.[0]?.finish_reason || null,
        usage: {
          promptTokens: envelope.usage?.prompt_tokens ?? null,
          completionTokens: envelope.usage?.completion_tokens ?? null,
          reasoningTokens: envelope.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          totalTokens: envelope.usage?.total_tokens ?? null
        },
        latencyMs,
        attempts,
        requestSha256,
        responseSha256
      };
    }
  };
}

function ollamaProvider({ baseUrl, model, timeoutMs, maxRetries, maxResponseBytes, fetchImpl, sleep, contextTokens = null, thinking = null }) {
  const url = `${baseUrl}/api/chat`;
  return {
    driver: 'ollama',
    model,
    async chat({ agent = 'agent', system, user, responseSchema = null, temperature = 0, seed = null, maxTokens = 2048, thinking: chatThinking = thinking } = {}) {
      const body = {
        model,
        stream: false,
        ...(chatThinking === null || chatThinking === undefined ? {} : { think: chatThinking }),
        ...(responseSchema ? { format: responseSchema } : {}),
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) }
        ],
        options: {
          temperature,
          ...(seed === null || seed === undefined ? {} : { seed }),
          ...(contextTokens ? { num_ctx: contextTokens } : {}),
          num_predict: maxTokens
        }
      };
      const { envelope, latencyMs, attempts, requestSha256, responseSha256 } = await postJson({ url, headers: {}, body, timeoutMs, maxRetries, fetchImpl, sleep, apiKey: null, maxResponseBytes });
      if (typeof envelope.message?.content !== 'string') throw new ModelProviderError('ollama response missing message.content', { code: 'model_bad_envelope', driver: 'ollama' });
      return {
        agent,
        driver: 'ollama',
        model: envelope.model || model,
        content: envelope.message.content,
        reasoningContent: typeof envelope.message?.thinking === 'string' ? envelope.message.thinking : null,
        finishReason: envelope.done_reason || null,
        usage: {
          promptTokens: envelope.prompt_eval_count ?? null,
          completionTokens: envelope.eval_count ?? null,
          reasoningTokens: null,
          totalTokens: envelope.prompt_eval_count != null && envelope.eval_count != null ? envelope.prompt_eval_count + envelope.eval_count : null
        },
        latencyMs,
        attempts,
        requestSha256,
        responseSha256
      };
    }
  };
}

function fixtureProvider({ model = 'fixture-model', responses = null } = {}) {
  return {
    driver: 'fixture',
    model,
    async chat({ agent = 'agent', system, user, responseSchema = null } = {}) {
      const userText = typeof user === 'string' ? user : JSON.stringify(user);
      const canned = typeof responses === 'function' ? responses({ agent, system, user: userText }) : responses?.[agent];
      const content = typeof canned === 'string' ? canned : JSON.stringify(canned ?? { fixture: true, agent, inputSha256: sha256(userText).slice(0, 16) });
      return {
        agent,
        driver: 'fixture',
        model,
        content,
        reasoningContent: null,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        attempts: 1,
        requestSha256: shaRef(JSON.stringify({ agent, system, user: userText, responseSchema })),
        responseSha256: shaRef(content)
      };
    }
  };
}

export function createModelProvider({ driver, baseUrl, apiKey, model, timeoutMs = 300000, maxRetries = 2, maxResponseBytes = 4 * 1024 * 1024, fetchImpl = globalThis.fetch, sleep = delay, contextTokens = null, thinking = null, fixtureResponses = null } = {}) {
  if (!MODEL_DRIVERS.includes(driver)) throw new Error(`unknown model driver: ${driver}`);
  const boundedTimeout = boundedInteger(timeoutMs, 300000, { name: 'timeoutMs', minimum: 1000, maximum: 900000 });
  const boundedRetries = boundedInteger(maxRetries, 2, { name: 'maxRetries', minimum: 0, maximum: 5 });
  const boundedResponse = boundedInteger(maxResponseBytes, 4 * 1024 * 1024, { name: 'maxResponseBytes', minimum: 4096, maximum: 32 * 1024 * 1024 });
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable');
  if (driver === 'fixture') return fixtureProvider({ model: model || 'fixture-model', responses: fixtureResponses });
  if (!model) throw new Error(`model name is required for driver ${driver}`);
  if (driver === 'openai-compat') {
    if (!apiKey) throw new ModelProviderError('openai-compat driver requires an API key (set DASHSCOPE_API_KEY); refusing to fall back silently', { code: 'model_api_key_required', driver });
    return openAiCompatProvider({
      baseUrl: normalizeBaseUrl(baseUrl || DEFAULT_OPENAI_COMPAT_BASE_URL),
      apiKey,
      model,
      timeoutMs: boundedTimeout,
      maxRetries: boundedRetries,
      maxResponseBytes: boundedResponse,
      fetchImpl,
      sleep
    });
  }
  return ollamaProvider({
    baseUrl: normalizeBaseUrl(baseUrl || DEFAULT_OLLAMA_BASE_URL),
    model,
    timeoutMs: boundedTimeout,
    maxRetries: boundedRetries,
    maxResponseBytes: boundedResponse,
    fetchImpl,
    sleep,
    contextTokens,
    thinking
  });
}

export function createModelProviderFromEnv({ env = process.env, defaults = {}, fetchImpl } = {}) {
  const driver = env.DEVORBIT_MODEL_DRIVER || defaults.driver || 'ollama';
  return createModelProvider({
    driver,
    baseUrl: env.DEVORBIT_MODEL_BASE_URL || defaults.baseUrl,
    apiKey: env.DASHSCOPE_API_KEY || defaults.apiKey,
    model: env.DEVORBIT_MODEL_NAME || defaults.model || (driver === 'openai-compat' ? DEFAULT_OPENAI_COMPAT_MODEL : undefined),
    timeoutMs: env.DEVORBIT_MODEL_TIMEOUT_MS || defaults.timeoutMs,
    maxRetries: env.DEVORBIT_MODEL_MAX_RETRIES || defaults.maxRetries,
    contextTokens: defaults.contextTokens ?? null,
    thinking: defaults.thinking ?? null,
    fixtureResponses: defaults.fixtureResponses ?? null,
    fetchImpl
  });
}

export function redactModelSecrets(text, { env = process.env } = {}) {
  let out = String(text ?? '');
  for (const value of [env.DASHSCOPE_API_KEY, env.OPENAI_API_KEY]) {
    if (value) out = out.split(value).join('[REDACTED]');
  }
  return out;
}

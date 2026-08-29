const FAKE_KEY = 'sk-test-' + '0'.repeat(24);
const FAKE_KEY_B = 'sk-test-' + '1'.repeat(24);
const FAKE_KEY_C = 'sk-env-' + '0'.repeat(24);
const FAKE_KEY_D = 'sk-real-' + 'a'.repeat(24);
const FAKE_KEY_E = 'sk-real-' + 'b'.repeat(24);
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModelProvider, createModelProviderFromEnv, redactModelSecrets, ModelProviderError, DEFAULT_OPENAI_COMPAT_BASE_URL, DEFAULT_OPENAI_COMPAT_MODEL } from './provider.js';

const noopSleep = async () => {};

function mockFetchSequence(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step.throw) throw step.throw;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: async () => step.body
    };
  };
  return { calls, fetchImpl };
}

const okCompletion = JSON.stringify({
  model: 'deepseek-v4-flash',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}', reasoning_content: 'chain' } }],
  usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16, completion_tokens_details: { reasoning_tokens: 4 } }
});

test('openai-compat driver posts chat completions with auth and parses usage', async () => {
  const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: okCompletion }]);
  const provider = createModelProvider({ driver: 'openai-compat', apiKey: FAKE_KEY, model: 'deepseek-v4-flash', fetchImpl, sleep: noopSleep });
  const result = await provider.chat({ agent: 'rca-worker', system: 'sys', user: { hello: 'world' }, responseSchema: { type: 'object' }, temperature: 0, seed: 7, maxTokens: 128 });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, `${DEFAULT_OPENAI_COMPAT_BASE_URL}/chat/completions`);
  assert.equal(call.init.headers.authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'deepseek-v4-flash');
  assert.equal(body.temperature, 0);
  assert.equal(body.seed, 7);
  assert.equal(body.max_tokens, 128);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: '{"hello":"world"}' }]);
  assert.equal(result.content, '{"ok":true}');
  assert.equal(result.reasoningContent, 'chain');
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 6, reasoningTokens: 4, totalTokens: 16 });
  assert.equal(result.driver, 'openai-compat');
  assert.equal(result.model, 'deepseek-v4-flash');
  assert.match(result.requestSha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.responseSha256, /^sha256:[0-9a-f]{64}$/);
});

test('openai-compat retries 429 and succeeds', async () => {
  const { calls, fetchImpl } = mockFetchSequence([{ status: 429, body: '{"error":"rate limited"}' }, { status: 200, body: okCompletion }]);
  const provider = createModelProvider({ driver: 'openai-compat', apiKey: FAKE_KEY, model: 'deepseek-v4-flash', fetchImpl, sleep: noopSleep });
  const result = await provider.chat({ user: 'hi' });
  assert.equal(calls.length, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.content, '{"ok":true}');
});

test('openai-compat does not retry 400 and never leaks the API key', async () => {
  const secret = FAKE_KEY_B;
  const { calls, fetchImpl } = mockFetchSequence([{ status: 400, body: `{"error":"bad request with ${secret}"}` }]);
  const provider = createModelProvider({ driver: 'openai-compat', apiKey: secret, model: 'deepseek-v4-flash', fetchImpl, sleep: noopSleep });
  await assert.rejects(provider.chat({ user: 'hi' }), error => {
    assert.ok(error instanceof ModelProviderError);
    assert.equal(error.status, 400);
    assert.ok(!error.message.includes(secret));
    assert.ok(error.message.includes('[REDACTED]'));
    return true;
  });
  assert.equal(calls.length, 1);
});

test('openai-compat requires an API key and refuses silent fallback', () => {
  assert.throws(() => createModelProvider({ driver: 'openai-compat', model: 'deepseek-v4-flash' }), /requires an API key/);
});

test('openai-compat rejects non-HTTPS remote base URLs', () => {
  assert.throws(() => createModelProvider({ driver: 'openai-compat', apiKey: 'sk-x', model: 'm', baseUrl: 'http://example.com/v1' }), /requires HTTPS/);
  assert.throws(() => createModelProvider({ driver: 'openai-compat', apiKey: 'sk-x', model: 'm', baseUrl: 'https://user:pw@example.com/v1' }), /must not be embedded/);
});

test('ollama driver posts /api/chat with ollama-native options', async () => {
  const envelope = JSON.stringify({ model: 'qwen3:8b', message: { role: 'assistant', content: '{"a":1}' }, done_reason: 'stop', prompt_eval_count: 12, eval_count: 8 });
  const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: envelope }]);
  const provider = createModelProvider({ driver: 'ollama', model: 'qwen3:8b', fetchImpl, sleep: noopSleep, contextTokens: 32768, thinking: false });
  const result = await provider.chat({ agent: 'patch-worker', system: 'sys', user: 'payload', responseSchema: { type: 'object' }, temperature: 0.2, seed: 3, maxTokens: 256 });
  const call = calls[0];
  assert.equal(call.url, 'http://127.0.0.1:11434/api/chat');
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'qwen3:8b');
  assert.equal(body.think, false);
  assert.deepEqual(body.format, { type: 'object' });
  assert.equal(body.options.temperature, 0.2);
  assert.equal(body.options.seed, 3);
  assert.equal(body.options.num_ctx, 32768);
  assert.equal(body.options.num_predict, 256);
  assert.equal(result.content, '{"a":1}');
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 8, reasoningTokens: null, totalTokens: 20 });
});

test('fixture driver is deterministic and reports zero usage', async () => {
  const provider = createModelProvider({ driver: 'fixture', fixtureResponses: { 'rca-worker': '{"rootCause":"fixture"}' } });
  const first = await provider.chat({ agent: 'rca-worker', user: 'abc' });
  const second = await provider.chat({ agent: 'rca-worker', user: 'abc' });
  assert.equal(first.content, '{"rootCause":"fixture"}');
  assert.equal(first.requestSha256, second.requestSha256);
  assert.equal(first.usage.totalTokens, 0);
  assert.equal(first.driver, 'fixture');
  const fallback = await provider.chat({ agent: 'other', user: 'x' });
  assert.equal(JSON.parse(fallback.content).fixture, true);
});

test('createModelProviderFromEnv reads driver, key, base URL and model from env', () => {
  const provider = createModelProviderFromEnv({ env: { DEVORBIT_MODEL_DRIVER: 'openai-compat', DASHSCOPE_API_KEY: FAKE_KEY_C, DEVORBIT_MODEL_NAME: 'deepseek-v4-flash' }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => okCompletion }) });
  assert.equal(provider.driver, 'openai-compat');
  assert.equal(provider.model, 'deepseek-v4-flash');
  assert.match(provider.keyFingerprint, /^[0-9a-f]{12}$/);
  const defaulted = createModelProviderFromEnv({ env: { DEVORBIT_MODEL_DRIVER: 'openai-compat', DASHSCOPE_API_KEY: FAKE_KEY_C }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => okCompletion }) });
  assert.equal(defaulted.model, DEFAULT_OPENAI_COMPAT_MODEL);
  assert.throws(() => createModelProviderFromEnv({ env: { DEVORBIT_MODEL_DRIVER: 'openai-compat' } }), /requires an API key/);
});

test('redactModelSecrets strips configured keys from arbitrary text', () => {
  const env = { DASHSCOPE_API_KEY: FAKE_KEY_D, OPENAI_API_KEY: FAKE_KEY_E };
  const redacted = redactModelSecrets(`used ${env.DASHSCOPE_API_KEY} and ${env.OPENAI_API_KEY}`, { env });
  assert.equal(redacted, 'used [REDACTED] and [REDACTED]');
});

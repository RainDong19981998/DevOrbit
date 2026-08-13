import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpProviders, HttpJsonClient } from './adapters/http.js';

function response(status, value, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('HTTP adapter retries only idempotent writes and propagates contract headers', async () => {
  const calls = [];
  const client = new HttpJsonClient({
    baseUrl: 'http://127.0.0.1:9999',
    token: 'secret',
    maxRetries: 2,
    sleep: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1 ? response(503, { error: { code: 'transient' } }) : response(200, { ok: true });
    }
  });
  const result = await client.request('/write', { body: { value: 1 }, idempotencyKey: 'CASE:write', operation: 'test.write' });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret');
  assert.equal(calls[0].options.headers['idempotency-key'], 'CASE:write');
  assert.equal(calls[0].options.headers['x-devorbit-operation'], 'test.write');
  assert.equal(calls[0].options.redirect, 'error');
});

test('HTTP adapter retries semantic read POSTs and protects authority headers', async () => {
  const calls = [];
  const client = new HttpJsonClient({
    baseUrl: 'http://127.0.0.1:9999',
    token: 'trusted-token',
    maxRetries: 1,
    sleep: async () => {},
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return calls.length === 1 ? response(503, { error: { code: 'transient' } }) : response(200, { signals: [], sourceCount: 0 });
    }
  });
  const providers = createHttpProviders({
    baseUrl: 'http://127.0.0.1:9999',
    token: 'trusted-token',
    maxRetries: 1,
    sleep: async () => {},
    fetchImpl: client.fetchImpl
  });
  await providers.issue.fetchSignals({ caseId: 'CASE-A' }, { caseId: 'CASE-A', traceId: 'TRACE-A', agent: 'intake-worker' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.authorization, 'Bearer trusted-token');
  assert.equal(calls[0].headers['x-devorbit-case-id'], 'CASE-A');
  assert.equal(calls[0].headers['x-devorbit-trace-id'], 'TRACE-A');
  assert.equal(calls[0].headers['x-devorbit-agent'], 'intake-worker');
});

test('HTTP adapter does not retry non-idempotent writes', async () => {
  let calls = 0;
  const client = new HttpJsonClient({ baseUrl: 'http://localhost:9999', maxRetries: 2, sleep: async () => {}, fetchImpl: async () => { calls++; return response(503, { error: { code: 'transient' } }); } });
  await assert.rejects(() => client.request('/write', { method: 'POST', body: { value: 1 }, operation: 'unsafe.write' }), error => error.retryable === true && error.status === 503);
  assert.equal(calls, 1);
});

test('HTTP adapter rejects insecure remote origins and oversized responses', async () => {
  assert.throws(() => new HttpJsonClient({ baseUrl: 'http://example.com' }), /requires HTTPS/);
  assert.throws(() => new HttpJsonClient({ baseUrl: 'https://example.com/prefix' }), /path prefix/);
  assert.throws(() => new HttpJsonClient({ baseUrl: 'https://example.com?token=secret' }), /query or fragment/);
  const client = new HttpJsonClient({ baseUrl: 'http://127.0.0.1:9999', maxResponseBytes: 1024, fetchImpl: async () => response(200, { value: 'too large' }, { 'content-length': '2000' }) });
  await assert.rejects(() => client.request('/read', { method: 'GET' }), error => error.code === 'external_response_too_large' && error.retryable === false);
});

test('HTTP adapter bounds requests, requires JSON success, and strips approval tokens', async () => {
  const oversized = new HttpJsonClient({ baseUrl: 'http://127.0.0.1:9999', maxRequestBytes: 1024, fetchImpl: async () => response(200, {}) });
  await assert.rejects(() => oversized.request('/write', { body: { value: 'x'.repeat(2000) } }), error => error.code === 'external_request_too_large');

  const html = new HttpJsonClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl: async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(() => html.request('/read', { idempotent: true }), error => error.code === 'external_contract_error');

  let forwarded;
  const providers = createHttpProviders({
    baseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return response(200, { decision: 'promoted' });
    }
  });
  await providers.release.canary({ caseId: 'CASE-A', approvalId: 'APR-A', approvalToken: 'internal-secret', idempotencyKey: 'CASE-A:release' });
  assert.equal(forwarded.approvalToken, undefined);
  assert.equal(forwarded.approvalId, 'APR-A');
});

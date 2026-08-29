import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmbeddingProvider, cosineSimilarity, LOCAL_HASH_DIM } from './embedding.js';

test('local-hash driver produces deterministic normalized vectors', async () => {
  const provider = createEmbeddingProvider({ driver: 'local-hash' });
  const first = await provider.embed(['redis pool timeout duplicate order']);
  const second = await provider.embed(['redis pool timeout duplicate order']);
  assert.equal(first.embeddings[0].length, LOCAL_HASH_DIM);
  assert.deepEqual(first.embeddings[0], second.embeddings[0]);
  const norm = Math.sqrt(first.embeddings[0].reduce((sum, v) => sum + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
  assert.equal(first.usage.totalTokens, 0);
});

test('cosineSimilarity scores related text higher than unrelated', async () => {
  const provider = createEmbeddingProvider({ driver: 'local-hash' });
  const { embeddings } = await provider.embed(['redis pool timeout', 'redis connection pool exhausted', 'unrelated pastry recipe']);
  assert.ok(cosineSimilarity(embeddings[0], embeddings[1]) > cosineSimilarity(embeddings[0], embeddings[2]));
});

test('openai-compat driver posts embeddings and normalizes vectors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: 'text-embedding-v4', data: [{ index: 0, embedding: [3, 4] }], usage: { prompt_tokens: 5, total_tokens: 5 } })
    };
  };
  const provider = createEmbeddingProvider({ driver: 'openai-compat', apiKey: 'sk-test-embedding-key-000000000000', fetchImpl });
  const result = await provider.embed(['hello']);
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test-embedding-key-000000000000');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'text-embedding-v4', input: ['hello'] });
  assert.deepEqual(result.embeddings[0], [0.6, 0.8]);
  assert.equal(result.usage.totalTokens, 5);
});

test('openai-compat driver requires a key and fails closed', () => {
  assert.throws(() => createEmbeddingProvider({ driver: 'openai-compat' }), /requires DASHSCOPE_API_KEY/);
});

test('openai-compat driver enforces the 10-text batch limit', async () => {
  const provider = createEmbeddingProvider({ driver: 'openai-compat', apiKey: 'sk-test-embedding-key-000000000000', fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(provider.embed(Array(11).fill('x')), /limited to 10 texts/);
});

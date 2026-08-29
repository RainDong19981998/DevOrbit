import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HybridKnowledgeStore } from './hybrid-store.js';
import { createEmbeddingProvider } from '../models/embedding.js';

const seed = [
  { id: 'KB-A', title: 'Redis pool exhaustion', summary: 'connection pool shrunk causing timeouts', pattern: 'pool shrink', tags: ['redis', 'pool'], evidence: ['timeout log'] },
  { id: 'KB-B', title: 'Payment signature mismatch', summary: 'key rotation caused intermittent failures', pattern: 'key rotation', tags: ['payment', 'signature'], evidence: ['sig fail'] },
  { id: 'KB-C', title: 'Slow SQL inventory scan', summary: 'missing index caused checkout latency', pattern: 'index missing', tags: ['mysql', 'slow-sql'], evidence: ['explain plan'] }
];

test('falls back to lexical when no embedding provider', async () => {
  const store = new HybridKnowledgeStore(seed, null);
  const results = await store.search({ query: 'redis pool', topK: 2 });
  assert.ok(results.length <= 2);
  assert.equal(results[0].id, 'KB-A');
});

test('hybrid search reranks with embedding similarity', async () => {
  const provider = createEmbeddingProvider({ driver: 'local-hash' });
  const store = new HybridKnowledgeStore(seed, provider, 0.5);
  const lexical = await new HybridKnowledgeStore(seed, null).search({ query: 'redis connection pool timeout', topK: 3 });
  const hybrid = await store.search({ query: 'redis connection pool timeout', topK: 3 });
  assert.equal(hybrid.length, 3);
  assert.equal(hybrid[0].id, 'KB-A');
  assert.ok('vecScore' in hybrid[0]);
  assert.ok('combinedScore' in hybrid[0]);
});

test('embedding provider with cached vectors does not re-embed on second search', async () => {
  let calls = 0;
  const provider = { driver: 'spy', embed: async texts => { calls += 1; return { embeddings: texts.map(() => [1, 0, 0]), usage: { totalTokens: 0 } }; } };
  const store = new HybridKnowledgeStore(seed, provider, 0.5);
  await store.search({ query: 'pool', topK: 2 });
  const callsAfterFirst = calls;
  await store.search({ query: 'redis', topK: 2 });
  assert.equal(calls, callsAfterFirst + 1);
});

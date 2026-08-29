import { createHash } from 'node:crypto';

export const EMBEDDING_DRIVERS = Object.freeze(['openai-compat', 'local-hash']);
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';
export const LOCAL_HASH_DIM = 256;

export class EmbeddingProviderError extends Error {
  constructor(message, { code = 'embedding_error', status = null } = {}) {
    super(message);
    this.name = 'EmbeddingProviderError';
    this.code = code;
    this.status = status;
  }
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / norm);
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function lexicalHashVector(text, dim = LOCAL_HASH_DIM) {
  const vector = new Array(dim).fill(0);
  const tokens = String(text || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fff-]+/).filter(token => token.length > 1);
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const bucket = digest.readUInt32LE(0) % dim;
    const sign = digest.readUInt32LE(4) % 2 === 0 ? 1 : -1;
    vector[bucket] += sign * (1 + Math.min(token.length, 12) / 12);
  }
  return normalizeVector(vector);
}

export function createEmbeddingProvider({ driver = 'local-hash', baseUrl, apiKey, model = DEFAULT_EMBEDDING_MODEL, timeoutMs = 30000, fetchImpl = globalThis.fetch } = {}) {
  if (!EMBEDDING_DRIVERS.includes(driver)) throw new Error(`unknown embedding driver: ${driver}`);
  if (driver === 'local-hash') {
    return {
      driver,
      model: 'lexical-hash-v1',
      dimensions: LOCAL_HASH_DIM,
      async embed(texts) {
        const list = Array.isArray(texts) ? texts : [texts];
        return { embeddings: list.map(text => lexicalHashVector(text)), usage: { promptTokens: 0, totalTokens: 0 }, driver };
      }
    };
  }
  if (!apiKey) throw new EmbeddingProviderError('openai-compat embedding driver requires DASHSCOPE_API_KEY; refusing silent fallback', { code: 'embedding_api_key_required' });
  const url = `${(baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')}/embeddings`;
  return {
    driver,
    model,
    dimensions: null,
    async embed(texts) {
      const list = Array.isArray(texts) ? texts : [texts];
      if (!list.length) return { embeddings: [], usage: { promptTokens: 0, totalTokens: 0 }, driver };
      if (list.length > 10) throw new EmbeddingProviderError('embedding batch limited to 10 texts per call (DashScope constraint)', { code: 'embedding_batch_too_large' });
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: list }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await response.text();
      if (!response.ok) throw new EmbeddingProviderError(`embedding HTTP ${response.status}: ${text.slice(0, 300)}`, { code: 'embedding_http_error', status: response.status });
      let envelope;
      try { envelope = JSON.parse(text); } catch { throw new EmbeddingProviderError('embedding response was not valid JSON', { code: 'embedding_invalid_json' }); }
      const embeddings = (envelope.data || []).sort((a, b) => a.index - b.index).map(item => normalizeVector(item.embedding));
      if (embeddings.length !== list.length) throw new EmbeddingProviderError(`embedding count mismatch: sent ${list.length}, got ${embeddings.length}`, { code: 'embedding_count_mismatch' });
      return { embeddings, usage: { promptTokens: envelope.usage?.prompt_tokens ?? null, totalTokens: envelope.usage?.total_tokens ?? null }, driver, model: envelope.model || model };
    }
  };
}

import { writeFile } from 'node:fs/promises';
import { createModelProvider } from '../src/models/provider.js';

const root = new URL('../', import.meta.url);
const reportPath = new URL('reports/model-provider-smoke.json', root);
const started = Date.now();
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });

const driver = process.env.DEVORBIT_MODEL_DRIVER || 'openai-compat';
const model = process.env.DEVORBIT_MODEL_NAME || 'deepseek-v4-flash';
let provider;
try {
  provider = createModelProvider({ driver, apiKey: process.env.DASHSCOPE_API_KEY, model, timeoutMs: 120000 });
  check('provider created with env credentials', true, `driver=${driver} model=${model}`);
} catch (error) {
  check('provider created with env credentials', false, error.message);
  const report = { generatedAt: new Date().toISOString(), status: 'failed', boundary: 'Real-model provider smoke. Fails closed when DASHSCOPE_API_KEY is absent; no fixture substitution, no key material in this report.', checks };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.error(`FAIL model provider smoke: ${error.message}`);
  process.exit(1);
}

const rcaSchema = { type: 'object', required: ['rootCause', 'confidence', 'evidence'], properties: { rootCause: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } } } };
const first = await provider.chat({
  agent: 'rca-worker',
  system: 'You are an evidence-first root-cause analyst. Reply with a single JSON object containing exactly these keys: "rootCause" (string), "confidence" (number between 0 and 1), "evidence" (array of strings). No markdown, no prose.',
  user: JSON.stringify({ issue: 'POST /orders intermittently returns 502 after redis.client.poolSize changed 80 -> 8', logs: ['IdempotencyStore timeout after 3000ms'], metric: 'p95 420ms -> 2.8s' }),
  responseSchema: rcaSchema,
  temperature: 0,
  seed: 42,
  maxTokens: 4096
});
let parsed;
try { parsed = JSON.parse(first.content); } catch { parsed = null; }
check('structured JSON output parses', parsed !== null);
check('rca schema keys present', parsed && typeof parsed.rootCause === 'string' && typeof parsed.confidence === 'number' && Array.isArray(parsed.evidence));
check('first call completed without truncation', first.finishReason === 'stop', `finishReason=${first.finishReason}`);
check('usage accounting present', first.usage.promptTokens > 0 && first.usage.completionTokens > 0 && first.usage.totalTokens === first.usage.promptTokens + first.usage.completionTokens, `usage=${JSON.stringify(first.usage)}`);
check('request/response digests recorded', /^sha256:[0-9a-f]{64}$/.test(first.requestSha256) && /^sha256:[0-9a-f]{64}$/.test(first.responseSha256));

const second = await provider.chat({
  agent: 'triage-worker',
  system: 'You classify incidents. Reply with a single JSON object {"severity":"P1|P2|P3","domain":"..."} and nothing else.',
  user: 'Payment page spins forever; duplicate orders observed; p95 latency 6x baseline.',
  responseSchema: { type: 'object', required: ['severity', 'domain'], properties: { severity: { type: 'string' }, domain: { type: 'string' } } },
  temperature: 0,
  seed: 42,
  maxTokens: 1024
});
let triage;
try { triage = JSON.parse(second.content); } catch { triage = null; }
check('second structured call parses', triage !== null && ['P1', 'P2', 'P3'].includes(triage.severity), triage ? `severity=${triage.severity}` : 'unparsed');
check('second call completed without truncation', second.finishReason === 'stop', `finishReason=${second.finishReason}`);

const report = {
  generatedAt: new Date().toISOString(),
  status: checks.every(item => item.ok) ? 'passed' : 'failed',
  durationMs: Date.now() - started,
  provider: { driver, model, baseUrl: process.env.DEVORBIT_MODEL_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyFingerprint: provider.keyFingerprint || null },
  calls: [
    { agent: first.agent, model: first.model, latencyMs: first.latencyMs, usage: first.usage, finishReason: first.finishReason, requestSha256: first.requestSha256, responseSha256: first.responseSha256, contentPreview: first.content.slice(0, 500), reasoningContentPreview: first.reasoningContent ? first.reasoningContent.slice(0, 200) : null },
    { agent: second.agent, model: second.model, latencyMs: second.latencyMs, usage: second.usage, finishReason: second.finishReason, requestSha256: second.requestSha256, responseSha256: second.responseSha256, contentPreview: second.content.slice(0, 300) }
  ],
  boundary: 'Real hosted-model smoke against the configured OpenAI-compatible endpoint (default: Alibaba Cloud DashScope, deepseek-v4-flash). Proves connectivity, structured-output behavior, usage accounting and digest capture only. No benchmark, accuracy, or production claim. The API key is never printed; keyFingerprint is the truncated SHA-256 of the key for audit correlation.',
  checks
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
if (report.status !== 'passed') process.exit(1);
console.log(`PASS model provider smoke: ${checks.length}/${checks.length}, ${report.provider.driver}/${report.provider.model}`);

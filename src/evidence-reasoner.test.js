import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseFromEvidence, proposeEditsFromEvidence } from './reasoning/evidence-reasoner.js';

test('RCA derives checkout cause from current source and signal evidence', () => {
  const result = diagnoseFromEvidence({
    signals: [{ id: 'LOG-1', text: 'idempotency timeout and duplicate order' }],
    files: [
      { path: 'src/redisPool.js', content: 'export const c = { poolSize: 8, queueTimeoutMs: 250 };' },
      { path: 'src/order.js', content: 'export function createOrder({ idempotencyKey, payload }) { return payload; }' }
    ]
  });
  assert.match(result.causes[0].statement, /幂等键/);
  assert.ok(result.causes[0].evidence.includes('repo://src/order.js'));
  assert.ok(result.causes[0].evidence.includes('LOG-1'));
});

test('patch derives inventory guard without a preconfigured fixed file', () => {
  const source = 'export function deductStock({ sku, quantity }) {\n  const current = stockBySku.get(sku) ?? 0;\n  stockBySku.set(sku, current - quantity);\n}';
  const result = proposeEditsFromEvidence({ files: [{ path: 'src/stock.js', content: source }] });
  assert.equal(result.edits.length, 1);
  assert.match(result.edits[0].content, /current < quantity/);
  assert.match(result.edits[0].content, /status: 409/);
});

test('unknown source fails to invent an edit', () => {
  const result = proposeEditsFromEvidence({ files: [{ path: 'src/unknown.js', content: 'export const healthy = true;' }] });
  assert.deepEqual(result.edits, []);
});

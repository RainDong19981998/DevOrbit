import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapMean, metricFromBoolean, pairedBinaryComparison, validateJsonSchema, wilsonInterval } from './public-benchmark.js';

test('public benchmark statistics expose explicit denominators and intervals', () => {
  const interval = wilsonInterval(3, 4);
  assert.equal(interval.successes, 3);
  assert.equal(interval.total, 4);
  assert.ok(interval.low < interval.high);
  const metric = metricFromBoolean([{ ok: true }, { ok: false }, { ok: null }], 'ok');
  assert.equal(metric.numerator, 1);
  assert.equal(metric.denominator, 2);
  assert.equal(metric.excluded, 1);
});

test('bootstrap interval is deterministic for a fixed seed', () => {
  const left = bootstrapMean([1, 2, 3, 4], { seed: 'fixed', replicates: 1000 });
  const right = bootstrapMean([1, 2, 3, 4], { seed: 'fixed', replicates: 1000 });
  assert.deepEqual(left, right);
  assert.equal(left.mean, 2.5);
  assert.ok(left.low <= left.mean && left.mean <= left.high);
});

test('paired comparison reports discordance, exact McNemar p, and paired effect', () => {
  const left = [{ caseId: 'A', ok: true }, { caseId: 'B', ok: true }, { caseId: 'C', ok: false }];
  const right = [{ caseId: 'A', ok: false }, { caseId: 'B', ok: true }, { caseId: 'C', ok: false }];
  const result = pairedBinaryComparison(left, right, 'ok', { seed: 'paired-test' });
  assert.equal(result.pairs, 3);
  assert.equal(result.leftOnly, 1);
  assert.equal(result.rightOnly, 0);
  assert.equal(result.mcnemarExactP, 1);
  assert.equal(result.riskDifference.mean, 1 / 3);
});

test('benchmark schema validation resolves local refs and rejects unknown fields', () => {
  const schema = {
    type: 'object', required: ['id', 'items'], additionalProperties: false,
    properties: { id: { type: 'string', pattern: '^CASE-' }, items: { type: 'array', minItems: 1, items: { $ref: '#/$defs/item' } } },
    $defs: { item: { type: 'integer', minimum: 1 } }
  };
  assert.deepEqual(validateJsonSchema({ id: 'CASE-A', items: [1] }, schema), []);
  const errors = validateJsonSchema({ id: 'BAD', items: [0], extra: true }, schema);
  assert.ok(errors.some(error => error.includes('must match')));
  assert.ok(errors.some(error => error.includes('must be >= 1')));
  assert.ok(errors.some(error => error.includes('unknown extra')));
});

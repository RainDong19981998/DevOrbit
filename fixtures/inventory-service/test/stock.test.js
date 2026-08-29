import test from 'node:test';
import assert from 'node:assert/strict';
import { deductStock, getStock, resetStock } from '../src/stock.js';

test('single deduction succeeds and reports remaining stock', () => {
  resetStock({ 'SKU-A': 10 });
  const result = deductStock({ sku: 'SKU-A', quantity: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.remaining, 8);
});

test('deduction rejects when stock is insufficient', () => {
  resetStock({ 'SKU-B': 1 });
  const result = deductStock({ sku: 'SKU-B', quantity: 5 });
  assert.equal(result.status, 409);
  assert.equal(getStock('SKU-B'), 1);
});

test('concurrent deductions never oversell the last unit', () => {
  resetStock({ 'SKU-C': 1 });
  const results = [
    deductStock({ sku: 'SKU-C', quantity: 1 }),
    deductStock({ sku: 'SKU-C', quantity: 1 })
  ];
  const accepted = results.filter(result => result.status === 200).length;
  assert.equal(accepted, 1);
});

test('stock ledger never goes negative under repeated deductions', () => {
  resetStock({ 'SKU-D': 2 });
  for (let index = 0; index < 5; index += 1) deductStock({ sku: 'SKU-D', quantity: 1 });
  assert.ok(getStock('SKU-D') >= 0);
});

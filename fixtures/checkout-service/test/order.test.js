import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, resetOrders } from '../src/order.js';

test('first request creates an order', () => {
  resetOrders();
  const result = createOrder({ idempotencyKey: 'pay-101', payload: { sku: 'A-1' } });
  assert.equal(result.status, 201);
  assert.equal(result.order.id, 'ORD-1');
});

test('duplicate request returns the original order without creating another', () => {
  resetOrders();
  const first = createOrder({ idempotencyKey: 'pay-102', payload: { sku: 'A-2' } });
  const duplicate = createOrder({ idempotencyKey: 'pay-102', payload: { sku: 'A-2' } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.order.id, first.order.id);
});

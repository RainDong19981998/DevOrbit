import test from 'node:test';
import assert from 'node:assert/strict';
import { redisPoolConfig } from '../src/redisPool.js';

test('connection pool preserves checkout peak capacity', () => {
  assert.ok(redisPoolConfig.poolSize >= 64);
});

test('queue timeout absorbs short checkout bursts', () => {
  assert.ok(redisPoolConfig.queueTimeoutMs >= 800);
});

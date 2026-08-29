import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EpisodeStore } from './episode-store.js';

test('episode store filters by context metadata', () => {
  const store = new EpisodeStore();
  const results = store.search({
    query: '连接池 超时 重复订单',
    context: { tenant: 'acme-commerce', service: 'checkout-service', environment: 'production', gitRevision: 'a1b2c3d4' }
  });
  assert.ok(results.length > 0);
  for (const ep of results) {
    assert.equal(ep.tenant, 'acme-commerce');
    assert.equal(ep.service, 'checkout-service');
  }
});

test('different gitRevision excludes same-symptom episodes', () => {
  const store = new EpisodeStore();
  const results = store.search({
    query: '连接池 超时',
    context: { tenant: 'acme-commerce', service: 'checkout-service', environment: 'production', gitRevision: 'different_commit' }
  });
  for (const ep of results) {
    assert.notEqual(ep.gitRevision, 'a1b2c3d4');
  }
});

test('negative episodes are returned as warnings', () => {
  const store = new EpisodeStore();
  const sw = store.searchWithWarnings({
    query: '连接池 调大 崩溃',
    context: { tenant: 'acme-commerce', service: 'checkout-service' }
  });
  assert.ok(sw.results.length > 0);
  const negatives = sw.results.filter(ep => ep.recallStatus === 'negative');
  assert.ok(negatives.length > 0, 'should find negative episodes');
  for (const neg of negatives) {
    assert.ok(neg.negativeLessons?.length > 0);
    assert.ok(neg.warningMessage);
  }
});

test('pending episodes are not in default recall', () => {
  const store = new EpisodeStore();
  store.write({ episodeId: 'EP-TEST', title: 'test', recallStatus: 'pending', tags: ['test'], evidence: ['test'] });
  const results = store.search({ query: 'test', topK: 10 });
  const pending = results.filter(ep => ep.id === 'EP-TEST');
  assert.equal(pending.length, 0, 'pending episode should not be in default recall');
});

test('promoteToActive moves episode into default recall', () => {
  const store = new EpisodeStore();
  store.write({ episodeId: 'EP-PROMOTE', title: 'promote test', recallStatus: 'pending', tags: ['promote'], evidence: ['promote'] });
  store.promoteToActive('EP-PROMOTE', { windowMinutes: 15, metricsVerdict: 'healthy', reviewedBy: 'test' });
  const results = store.search({ query: 'promote', topK: 10 });
  const found = results.filter(ep => ep.id === 'EP-PROMOTE');
  assert.equal(found.length, 1);
  assert.equal(found[0].recallStatus, 'active');
  assert.equal(found[0].confidence, 'high');
});

test('markNegative makes episode available as warning only', () => {
  const store = new EpisodeStore();
  store.write({ episodeId: 'EP-NEG', title: 'negative test', recallStatus: 'pending', tags: ['negtest'], evidence: ['neg'] });
  store.markNegative('EP-NEG', { windowMinutes: 5, metricsVerdict: 'degraded', reviewedBy: 'test' });
  const results = store.search({ query: 'negative', topK: 10 });
  const found = results.filter(ep => ep.id === 'EP-NEG');
  assert.equal(found.length, 1);
  assert.equal(found[0].recallStatus, 'negative');
});

test('db-branch episode has observation data assertions', () => {
  const store = new EpisodeStore();
  const sw = store.searchWithWarnings({ query: '数据库 迁移 索引 慢查询' });
  const dbEpisodes = sw.results.filter(ep => ep.tags?.includes('db-branch'));
  assert.ok(dbEpisodes.length > 0, 'should find db-branch episodes');
  assert.ok(dbEpisodes[0].observation?.dataAssertions);
  assert.equal(dbEpisodes[0].observation.dataAssertions.foreignKeyIntegrity, true);
});

test('context governance: tenant drift blocks cross-tenant recall', () => {
  const store = new EpisodeStore();
  const results = store.search({
    query: '连接池 超时 重复订单 库存 超卖',
    context: { tenant: 'other-org', service: 'checkout-service', environment: 'production' }
  });
  assert.equal(results.length, 0, 'no episode may leak across tenants');
});

test('context governance: stale gitRevision blocks recall and fresh revision recalls domain episode', () => {
  const store = new EpisodeStore();
  const stale = store.search({
    query: '库存 扣减 超卖 乐观锁',
    context: { tenant: 'acme-commerce', service: 'inventory-service', environment: 'production', gitRevision: 'stale-revision', configRevision: 'release/2026.08' }
  });
  assert.equal(stale.filter(ep => ep.id === 'EP-007').length, 0, 'stale revision must not recall the domain episode');
  const fresh = store.search({
    query: '库存 扣减 超卖 乐观锁',
    context: { tenant: 'acme-commerce', service: 'inventory-service', environment: 'production', gitRevision: 'e5f6a7b8', configRevision: 'release/2026.08' }
  });
  assert.ok(fresh.some(ep => ep.id === 'EP-007'), 'matching revision recalls the domain episode');
});

test('context governance policy is declared with isolation and retention', () => {
  const policy = readFileSync(fileURLToPath(new URL('../../config/policy.yaml', import.meta.url)), 'utf8');
  assert.ok(policy.includes('context_governance:'));
  assert.ok(policy.includes('tenant_cross_recall: hard_filter'));
  assert.ok(policy.includes('stale_context: block_recall'));
  assert.ok(policy.includes('session_max: 100'));
  assert.ok(policy.includes('session_ttl_minutes: 30'));
  assert.ok(policy.includes('state_snapshots: terminal_state_cleanup'));
});

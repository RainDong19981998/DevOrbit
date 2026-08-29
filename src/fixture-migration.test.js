import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from './orchestrator.js';

test('inventory fixture migration closes the loop with unchanged mechanisms', async () => {
  const result = await runPipeline({ fixture: 'inventory' });
  assert.equal(result.state.status, 'learned');
  assert.equal(result.metrics.closedLoop, true);
  assert.equal(result.plan.baselineTests.failed, 3);
  assert.equal(result.plan.baselineTests.passed, 1);
  assert.equal(result.tests.failed, 0);
  assert.equal(result.tests.passed, 4);
  assert.equal(result.tests.gate, 'passed');
  assert.equal(result.release.decision, 'promoted');
  assert.ok(result.rca.causes[0].score >= 0.8);
  assert.ok(result.rca.causes[0].statement.includes('库存扣减'));
  assert.equal(result.rca.retrieval.results[0]?.id, 'EP-007');
  assert.equal(result.knowledge.outcome, 'promoted');
  assert.equal(result.metrics.agents, 7);
  assert.equal(result.evidenceChain.verified, true);
  assert.ok(result.plan.files.includes('src/stock.js'));
  assert.ok(result.plan.rollbackRef.startsWith('sha256:'));
});

test('migration reuses the same worker and skill sequence as the checkout baseline', async () => {
  const checkout = await runPipeline();
  const inventory = await runPipeline({ fixture: 'inventory' });
  const skillSequence = result => result.trace.filter(event => event.agent !== 'devorbit-lead').map(event => `${event.agent}:${event.skill}`);
  assert.deepEqual(skillSequence(inventory), skillSequence(checkout));
  const stateSequence = result => result.messages.filter(message => message.type === 'state_transition').map(message => message.to);
  assert.deepEqual(stateSequence(inventory), stateSequence(checkout));
  const toolSet = result => [...new Set(result.mcp.audit.map(item => item.tool))].sort();
  assert.deepEqual(toolSet(inventory), toolSet(checkout));
  assert.ok(inventory.mcp.audit.every(item => item.traceId === inventory.state.traceId));
});

test('migrated knowledge episode is scoped to the inventory service', async () => {
  const result = await runPipeline({ fixture: 'inventory' });
  const episode = result.knowledge;
  assert.equal(episode.service, 'inventory-service');
  assert.equal(episode.tenant, 'acme-commerce');
  assert.equal(episode.pattern, '乐观锁缺失 + 并发扣减超卖');
  assert.ok(episode.tags.includes('oversell'));
  assert.equal(episode.recallStatus, 'active');
});

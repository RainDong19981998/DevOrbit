import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { runPipeline } from './orchestrator.js';
import { DeliveryManager } from './runtime/manager.js';
import { getDemoCase } from './orchestrator.js';
import { createCaseState, transition } from './runtime/case-state.js';
import { releaseAgent } from './agents/release-agent.js';

test('independent workers close the loop using real patch tests', async () => {
  const result = await runPipeline();
  assert.equal(result.metrics.closedLoop, true);
  assert.equal(result.tests.failed, 0);
  assert.equal(result.tests.passed, 4);
  assert.equal(result.plan.baselineTests.failed, 3);
  assert.equal(result.approval.state, 'approved');
  assert.equal(result.release.decision, 'promoted');
  assert.equal(result.state.status, 'learned');
  assert.ok(result.knowledge.cardId);
  assert.ok(result.messages.some(message => message.to === 'verify-worker'));
  await access(result.tests ? new URL('../fixtures/checkout-service/test/order.test.js', import.meta.url) : '');
});

test('every worker output is attached to a manager dispatch span', async () => {
  const result = await runPipeline();
  const workerSpans = result.trace.filter(span => span.agent !== 'devorbit-lead');
  assert.equal(workerSpans.length, 7);
  assert.ok(workerSpans.every(span => span.parentSpanId?.startsWith('SPAN-')));
  assert.ok(workerSpans.every(span => span.inputDigest && span.outputDigest));
});

test('pending and rejected approval never call the release tool', async () => {
  for (const approvalState of ['pending', 'rejected']) {
    const result = await runPipeline({ approvalState });
    assert.equal(result.metrics.closedLoop, false);
    assert.equal(result.approval.state, approvalState);
    assert.equal(result.release.toolCalled, false);
    assert.equal(result.knowledge, null);
    assert.equal(result.plan.workspaceDisposed, true);
  }
});

test('approval resumes the same case and trace instead of recomputing', async () => {
  const manager = new DeliveryManager({ incident: getDemoCase(), approvalState: 'pending' });
  const pending = await manager.run();
  const resumed = await manager.resumeApproval('approved');
  assert.equal(resumed.state.caseId, pending.state.caseId);
  assert.equal(resumed.state.traceId, pending.state.traceId);
  assert.ok(resumed.trace.length > pending.trace.length);
  assert.equal(resumed.release.decision, 'promoted');
});

test('low confidence diagnosis stops before patch execution', async () => {
  const result = await runPipeline({ scenario: 'low-confidence' });
  assert.equal(result.state.status, 'needs_human');
  assert.equal(result.rca.decision, 'needs_human');
  assert.equal(result.plan, null);
  assert.equal(result.tests, null);
});

test('a real failing regression test blocks release', async () => {
  const result = await runPipeline({ scenario: 'test-failure' });
  assert.equal(result.tests.gate, 'failed');
  assert.equal(result.tests.failed, 1);
  assert.equal(result.state.status, 'needs_human');
  assert.equal(result.release, null);
});

test('canary regression executes rollback and still produces knowledge', async () => {
  const result = await runPipeline({ scenario: 'canary-regression' });
  assert.equal(result.release.decision, 'rolled_back');
  assert.equal(result.release.rollbackExecuted, true);
  assert.equal(result.metrics.closedLoop, true);
  assert.equal(result.knowledge.outcome, 'rolled_back');
});

test('case state rejects illegal workflow jumps', () => {
  const state = createCaseState(getDemoCase(), 'happy-path');
  assert.throws(() => transition(state, 'confirmed', 'skip all gates'), /illegal case transition/);
  assert.equal(state.state, 'received');
  assert.equal(state.revision, 1);
});

test('release worker cannot mint or bypass a manager gate receipt', async () => {
  const manager = new DeliveryManager({ incident: getDemoCase(), approvalState: 'pending' });
  const pending = await manager.run();
  assert.equal(pending.state.status, 'approval_pending');
  manager.context.approvalState = 'approved';
  manager.context.approvalReceipt = null;
  await assert.rejects(() => manager.dispatch(releaseAgent, 'release'), /manager-signed gate receipt/);
  assert.equal(manager.state.artifacts.release.toolCalled, false);
});

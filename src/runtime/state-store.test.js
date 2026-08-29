import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCaseStateStore } from './state-store.js';
import { DeliveryManager } from './manager.js';
import { getDemoCase } from '../orchestrator.js';

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'devorbit-state-'));
  return new FileCaseStateStore(dir);
}

test('state store saves and loads snapshots atomically', async () => {
  const store = await tempStore();
  const snapshot = { schema: 'devorbit.case-state/v1', savedAt: '2026-08-29T00:00:00.000Z', state: { case_id: 'CASE-TEST0001', trace_id: 'TRACE-1', state: 'approval_pending', revision: 9, scenario: 'happy-path', incident: { signals: [] }, risk_level: 'L2', evidence: [], artifacts: {}, decisions: [], messages: [], trace: [], outcome: null }, evidenceChain: { genesis: '0'.repeat(16), head: '0'.repeat(16), links: [] } };
  await store.save(snapshot);
  const loaded = await store.load('CASE-TEST0001');
  assert.equal(loaded.state.case_id, 'CASE-TEST0001');
  assert.equal(loaded.state.revision, 9);
  const leftovers = (await readdir(store.directory)).filter(name => name.includes('.tmp-'));
  assert.equal(leftovers.length, 0);
});

test('state store list isolates corrupt files and remove deletes snapshots', async () => {
  const store = await tempStore();
  const base = { schema: 'devorbit.case-state/v1', savedAt: 'x', evidenceChain: null };
  await store.save({ ...base, state: { case_id: 'CASE-VALID001', trace_id: 'T', state: 'approval_pending', revision: 3, scenario: 'happy-path', incident: { signals: [] }, risk_level: 'L2', evidence: [], artifacts: {}, decisions: [], messages: [], trace: [], outcome: null } });
  await writeFile(join(store.directory, 'CASE-CORRUPT1.json'), '{ not valid json');
  const summaries = await store.list();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].caseId, 'CASE-VALID001');
  assert.equal(await store.load('CASE-CORRUPT1'), null);
  assert.equal(await store.remove('CASE-VALID001'), true);
  assert.deepEqual(await store.list(), []);
});

test('state store rejects path traversal case ids', async () => {
  const store = await tempStore();
  await assert.rejects(() => store.load('../evil'), /invalid case id/);
  await assert.rejects(() => store.save({ state: { case_id: '../evil' } }), /invalid case id/);
});

test('restart recovery restores approval-pending case and resumes the same trace', async () => {
  const store = await tempStore();
  const manager = new DeliveryManager({ incident: getDemoCase(), approvalState: 'pending', stateStore: store });
  const pending = await manager.run();
  assert.equal(pending.state.status, 'approval_pending');
  const snapshot = await store.load(pending.state.caseId);
  assert.ok(snapshot, 'approval_pending snapshot must survive process exit');
  assert.equal(snapshot.state.case_id, pending.state.caseId);

  const restored = DeliveryManager.restore(snapshot, { stateStore: store });
  const resumed = await restored.resumeApproval('approved');
  assert.equal(resumed.state.caseId, pending.state.caseId);
  assert.equal(resumed.state.traceId, pending.state.traceId);
  assert.equal(resumed.state.status, 'learned');
  assert.equal(resumed.release.decision, 'promoted');
  assert.equal(resumed.state.restored, true);
  assert.equal(resumed.evidenceChain.verified, true);
  assert.ok(resumed.evidenceChain.linkCount > snapshot.evidenceChain.links.length, 'evidence chain must continue after restore');
  assert.equal(await store.load(pending.state.caseId), null, 'terminal state snapshot must be cleaned up');
  await manager.disposeWorkspace();
});

test('restore refuses non-approval-pending snapshots and tampered evidence chains', async () => {
  const store = await tempStore();
  const manager = new DeliveryManager({ incident: getDemoCase(), approvalState: 'pending', stateStore: store });
  const pending = await manager.run();
  const snapshot = await store.load(pending.state.caseId);

  const midFlight = structuredClone(snapshot);
  midFlight.state.state = 'diagnosed';
  assert.throws(() => DeliveryManager.restore(midFlight, {}), /only approval_pending snapshots can be restored/);

  const tampered = structuredClone(snapshot);
  tampered.evidenceChain.links[0].stageHash = 'deadbeefdeadbeef';
  assert.throws(() => DeliveryManager.restore(tampered, {}), /evidence chain snapshot failed verification/);
  await manager.disposeWorkspace();
});

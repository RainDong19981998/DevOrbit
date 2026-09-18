import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileRunArchive } from './run-archive.js';

test('run archive retains terminal evidence and exposes a compact index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devorbit-archive-'));
  try {
    const archive = new FileRunArchive(directory);
    const result = {
      state: { caseId: 'CASE-ARCHIVE-001', traceId: 'TRACE-001', status: 'learned', scenario: 'happy-path' },
      tests: { passed: 4, failed: 0 },
      approval: { state: 'approved' },
      metrics: { outcome: 'promoted' },
      evidenceChain: { finalHash: 'sha256:abc' },
      trace: [{ agent: 'verify-worker' }]
    };
    await archive.save(result);
    assert.deepEqual((await archive.load('CASE-ARCHIVE-001')).result, result);
    const [summary] = await archive.list();
    assert.equal(summary.status, 'learned');
    assert.equal(summary.tests, '4/4');
    assert.equal(summary.evidenceChain, 'sha256:abc');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

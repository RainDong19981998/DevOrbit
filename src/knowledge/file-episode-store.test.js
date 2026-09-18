import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileEpisodeStore } from './file-episode-store.js';

test('episode knowledge survives a store restart with trust state intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devorbit-episodes-'));
  try {
    const file = join(directory, 'episodes.json');
    const first = new FileEpisodeStore(file, { seed: [] });
    first.write({ episodeId: 'EP-PERSIST-001', title: 'query rewrite failed', summary: 'lock waits increased', tags: ['postgresql'], recallStatus: 'pending' });
    first.markNegative('EP-PERSIST-001', { reason: 'p95 regression', verifiedAt: '2026-09-17T00:00:00.000Z' });

    const restarted = new FileEpisodeStore(file, { seed: [] });
    const restored = restarted.cards.find(item => item.id === 'EP-PERSIST-001');
    assert.equal(restored.recallStatus, 'negative');
    assert.equal(restored.observation.reason, 'p95 regression');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

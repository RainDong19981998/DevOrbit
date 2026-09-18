import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EpisodeStore } from './episode-store.js';

export class FileEpisodeStore extends EpisodeStore {
  constructor(file, { seed, embeddingProvider = null, alpha = 0.5 } = {}) {
    let episodes = seed;
    try { episodes = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first start uses the bundled seed */ }
    super(episodes, embeddingProvider, alpha);
    this.file = file;
  }

  persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(this.cards, null, 2));
    renameSync(tmp, this.file);
  }

  write(episode) {
    const stored = super.write(episode);
    this.persist();
    return stored;
  }

  promoteToActive(id, observation) {
    const episode = super.promoteToActive(id, observation);
    if (episode) this.persist();
    return episode;
  }

  markNegative(id, observation) {
    const episode = super.markNegative(id, observation);
    if (episode) this.persist();
    return episode;
  }
}

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertStoreCaseId } from './state-store.js';

export class FileRunArchive {
  constructor(directory) {
    this.directory = directory;
  }

  pathFor(caseId) {
    return join(this.directory, `${assertStoreCaseId(caseId)}.json`);
  }

  async save(result) {
    const caseId = result?.state?.caseId;
    assertStoreCaseId(caseId);
    await mkdir(this.directory, { recursive: true });
    const file = this.pathFor(caseId);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify({ schema: 'devorbit.run-archive/v1', archivedAt: new Date().toISOString(), result }, null, 2));
    await rename(tmp, file);
    return file;
  }

  async load(caseId) {
    assertStoreCaseId(caseId);
    try {
      const value = JSON.parse(await readFile(this.pathFor(caseId), 'utf8'));
      return value?.result?.state?.caseId === caseId ? value : null;
    } catch {
      return null;
    }
  }

  async list() {
    let entries;
    try { entries = await readdir(this.directory); } catch { return []; }
    const runs = [];
    for (const entry of entries.filter(name => name.endsWith('.json') && !name.includes('.tmp-')).sort().reverse()) {
      const archived = await this.load(entry.slice(0, -5));
      if (!archived) continue;
      const result = archived.result;
      runs.push({
        caseId: result.state.caseId,
        traceId: result.state.traceId,
        status: result.state.status,
        scenario: result.state.scenario,
        archivedAt: archived.archivedAt,
        tests: result.tests ? `${result.tests.passed}/${result.tests.passed + result.tests.failed}` : null,
        approval: result.approval?.state || null,
        outcome: result.metrics?.outcome || result.state.status,
        evidenceChain: result.evidenceChain?.finalHash || null
      });
    }
    return runs;
  }
}

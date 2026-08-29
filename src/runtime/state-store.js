import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CASE_ID_PATTERN = /^CASE-[A-Z0-9-]+$/;

export function assertStoreCaseId(caseId) {
  if (typeof caseId !== 'string' || !CASE_ID_PATTERN.test(caseId)) {
    throw new Error(`invalid case id for state store: ${caseId}`);
  }
  return caseId;
}

export class FileCaseStateStore {
  constructor(directory) {
    this.directory = directory;
  }

  pathFor(caseId) {
    return join(this.directory, `${assertStoreCaseId(caseId)}.json`);
  }

  async save(snapshot) {
    const caseId = snapshot?.state?.case_id;
    assertStoreCaseId(caseId);
    await mkdir(this.directory, { recursive: true });
    const file = this.pathFor(caseId);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2));
    await rename(tmp, file);
    return file;
  }

  async load(caseId) {
    assertStoreCaseId(caseId);
    try {
      const raw = await readFile(this.pathFor(caseId), 'utf8');
      const snapshot = JSON.parse(raw);
      if (snapshot?.state?.case_id !== caseId) return null;
      return snapshot;
    } catch {
      return null;
    }
  }

  async list() {
    let entries;
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    const summaries = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json') || entry.includes('.tmp-')) continue;
      const caseId = entry.slice(0, -'.json'.length);
      if (!CASE_ID_PATTERN.test(caseId)) continue;
      const snapshot = await this.load(caseId);
      if (!snapshot) continue;
      summaries.push({
        caseId,
        status: snapshot.state.state,
        revision: snapshot.state.revision,
        scenario: snapshot.state.scenario,
        traceId: snapshot.state.trace_id,
        savedAt: snapshot.savedAt
      });
    }
    return summaries;
  }

  async remove(caseId) {
    assertStoreCaseId(caseId);
    try {
      await rm(this.pathFor(caseId));
      return true;
    } catch {
      return false;
    }
  }
}

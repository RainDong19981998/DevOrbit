import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSkillsRegistry, parseSkillFrontmatter } from '../src/skills-registry.js';
import { diagnoseFromEvidence } from '../src/reasoning/evidence-reasoner.js';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('../skills/', import.meta.url).pathname;
const reportPath = new URL('../reports/skill-upgrade-rollback.json', import.meta.url);
const traceId = `TRACE-SKILL-${randomUUID()}`;
const tempRoot = await mkdtemp(join(tmpdir(), 'devorbit-skill-drill-'));

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function verifyRca() {
  const output = diagnoseFromEvidence({
    signals: [{ id: 'ISSUE-DRILL', text: 'duplicate orders after idempotency timeout' }],
    files: [{ path: 'src/order.js', content: 'export function createOrder({ idempotencyKey, payload }) { return { status: 201, payload }; }' }]
  });
  return output.causes.length >= 2 && output.causes[0].evidence.includes('repo://src/order.js');
}

function snapshot(stage, registry, content) {
  const entry = registry.find(item => item.id === 'evidence-rca');
  const metadata = parseSkillFrontmatter(content);
  return {
    stage,
    at: new Date().toISOString(),
    version: entry?.version || metadata?.version || null,
    digest: entry?.digest || sha256(content),
    registryValid: Boolean(entry && entry.version === metadata?.version),
    goldenCheckPassed: verifyRca()
  };
}

let report;
try {
  await cp(sourceRoot, tempRoot, { recursive: true });
  const skillPath = join(tempRoot, 'evidence-rca', 'SKILL.md');
  const baseline = await readFile(skillPath, 'utf8');
  const before = snapshot('baseline-active', buildSkillsRegistry(tempRoot), baseline);

  const candidate = baseline
    .replace('version: 1.0.0', 'version: 1.0.1')
    .replace('5. Return `status`', '5. Record the repository and signal input digests before returning a decision.\n6. Return `status`');
  await writeFile(skillPath, candidate);
  const upgraded = snapshot('patch-activated', buildSkillsRegistry(tempRoot), candidate);

  await writeFile(skillPath, baseline);
  const rolledBackContent = await readFile(skillPath, 'utf8');
  const rolledBack = snapshot('rollback-activated', buildSkillsRegistry(tempRoot), rolledBackContent);
  const checks = {
    baselineVersion: before.version === '1.0.0',
    patchVersion: upgraded.version === '1.0.1',
    digestChanged: upgraded.digest !== before.digest,
    patchValidated: upgraded.registryValid && upgraded.goldenCheckPassed,
    rollbackVersion: rolledBack.version === '1.0.0',
    rollbackDigestRestored: rolledBack.digest === before.digest,
    rollbackValidated: rolledBack.registryValid && rolledBack.goldenCheckPassed,
    canonicalSkillUntouched: sha256(await readFile(new URL('../skills/evidence-rca/SKILL.md', import.meta.url), 'utf8')) === before.digest
  };
  report = {
    schema: 'devorbit.skill-upgrade-drill/v1',
    generatedAt: new Date().toISOString(),
    traceId,
    skill: 'evidence-rca',
    transition: '1.0.0 -> 1.0.1 -> 1.0.0',
    isolation: 'temporary registry; canonical production skill is read-only during this drill',
    events: [before, upgraded, rolledBack],
    checks,
    status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    boundary: 'This is a real local registry activation and rollback drill with digest and contract validation. It is not a production AgentTeams rollout.'
  };
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.status === 'passed' ? 'PASS' : 'FAIL'} skill PATCH upgrade/rollback ${report.transition} trace=${traceId}`);
if (report.status !== 'passed') process.exit(1);

import { readFile, writeFile } from 'node:fs/promises';
import { buildSkillsRegistry } from '../src/skills-registry.js';
import { skills } from '../src/skills.js';
import { DEVORBIT_VERSION } from '../src/version.js';

const workerBindings = {
  'signal-fusion': { worker: 'intake-worker', package: 'worker-packages/dist/intake-worker.zip' },
  'impact-map': { worker: 'impact-worker', package: 'worker-packages/dist/impact-worker.zip' },
  'evidence-rca': { worker: 'rca-worker', package: 'worker-packages/dist/rca-worker.zip' },
  'patch-plan': { worker: 'patch-worker', package: 'worker-packages/dist/patch-worker.zip' },
  'test-gate': { worker: 'verify-worker', package: 'worker-packages/dist/verify-worker.zip' },
  'release-guard': { worker: 'release-worker', package: 'worker-packages/dist/release-worker.zip' },
  'knowledge-card': { worker: 'learning-worker', package: 'worker-packages/dist/learning-worker.zip' }
};

const officialContract = JSON.parse(await readFile(new URL('../config/aliyun-official-skill.contract.json', import.meta.url), 'utf8'));
const catalog = new Map(skills.map(skill => [skill.id, skill]));

const entries = buildSkillsRegistry().map(entry => ({
  id: entry.id,
  version: entry.version,
  digest: entry.digest,
  path: entry.path,
  catalogName: catalog.get(entry.id)?.name || null,
  catalogVersionAligned: catalog.get(entry.id)?.version === entry.version,
  binding: workerBindings[entry.id] || null,
  lifecycle: {
    registry: 'skills-registry.json',
    versioning: 'SemVer（MAJOR.MINOR.PATCH）',
    distribution: 'worker package ZIP（skills/<id>/SKILL.md 打包进对应 Worker）',
    rollback: '保留上一版本 ZIP 与 SKILL.md 快照，digest 可比对',
    retirement: 'recallStatus/调用审计连续为空且无依赖案例时退役'
  }
}));

entries.push({
  id: officialContract.skill.name,
  version: officialContract.skill.version,
  official: true,
  digest: `sha256:${officialContract.artifact.skillMdSha256}`,
  path: officialContract.artifact.path,
  catalogName: catalog.get(officialContract.skill.name)?.name || null,
  catalogVersionAligned: catalog.get(officialContract.skill.name)?.version === officialContract.skill.version,
  binding: { workers: officialContract.integration.workers, mode: officialContract.integration.defaultDemoMode },
  lifecycle: {
    registry: 'skills-registry.json',
    versioning: '官方门户版本锁定（portalContentHash + repositorySnapshot）',
    distribution: '合规裁剪快照（third_party/aliyun/）',
    rollback: '门户下载 URL 与快照哈希可复核',
    retirement: '跟随官方门户版本策略'
  }
});

const report = {
  schema: 'devorbit.skills-registry/v1',
  version: DEVORBIT_VERSION,
  generatedAt: new Date().toISOString(),
  summary: { skills: entries.length, custom: entries.filter(entry => !entry.official).length, official: entries.filter(entry => entry.official).length, versionsAligned: entries.every(entry => entry.catalogVersionAligned) },
  traceability: '每次运行的 trace 事件记录 skillVersion 与 skillDigest（见 src/runtime/trace.js），MCP 审计按 Agent×Tool allowlist 关联；任一业务结果可回溯到产生它的 Skill 版本与文件摘要。',
  skills: entries
};

await writeFile(new URL('../reports/skills-registry.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(`PASS skills registry: ${report.summary.skills} skills (${report.summary.custom} custom + ${report.summary.official} official), versions aligned=${report.summary.versionsAligned}`);
if (!report.summary.versionsAligned) process.exit(1);

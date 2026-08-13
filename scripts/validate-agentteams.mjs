import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const resources = JSON.parse(await readFile(new URL('../config/agentteams.resources.json', import.meta.url), 'utf8'));
const contract = JSON.parse(await readFile(new URL('../config/agentteams-v1.2.2.contract.json', import.meta.url), 'utf8'));
const cloudSkillContract = JSON.parse(await readFile(new URL('../config/aliyun-official-skill.contract.json', import.meta.url), 'utf8'));
const expectedWorkers = new Map([
  ['devorbit-lead', null],
  ['intake-worker', 'signal-fusion'],
  ['impact-worker', 'impact-map'],
  ['rca-worker', 'evidence-rca'],
  ['patch-worker', 'patch-plan'],
  ['verify-worker', 'test-gate'],
  ['release-worker', 'release-guard'],
  ['learning-worker', 'knowledge-card']
]);
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });
const names = resources.map(resource => resource.metadata?.name);
const workers = resources.filter(resource => resource.kind === contract.resource.workerKind);
const teams = resources.filter(resource => resource.kind === contract.resource.teamKind);

check('version lock', contract.source.version === 'v1.2.2' && contract.source.commit === '849182af8e017168a5a200a87b1062142caf462d');
check('resource count', workers.length === 8 && teams.length === 1, `${workers.length} workers, ${teams.length} teams`);
check('unique resource names', new Set(names).size === names.length);
check('all expected workers', [...expectedWorkers.keys()].every(name => workers.some(worker => worker.metadata.name === name)));

for (const resource of resources) {
  check(`${resource.metadata.name} apiVersion`, resource.apiVersion === contract.resource.apiVersion);
  const allowed = new Set(resource.kind === 'Worker' ? contract.resource.workerSpecFields : contract.resource.teamSpecFields);
  const unknown = Object.keys(resource.spec || {}).filter(field => !allowed.has(field));
  check(`${resource.metadata.name} spec fields`, unknown.length === 0, unknown.join(', '));
}

for (const worker of workers) {
  const { name } = worker.metadata;
  check(`${name} model`, worker.spec.model === contract.resource.defaultModel);
  check(`${name} runtime`, contract.resource.runtimeEnum.includes(worker.spec.runtime));
  check(`${name} custom skill not duplicated`, !Object.hasOwn(worker.spec, 'skills'));
  check(`${name} package uploaded separately`, !Object.hasOwn(worker.spec, 'package'));
  for (const server of worker.spec.mcpServers || []) {
    check(`${name} MCP ${server.name}`, new URL(server.url).protocol.startsWith('http') && contract.resource.mcpTransportEnum.includes(server.transport || 'http'));
  }
}

const team = teams[0];
const members = team?.spec?.workerMembers || [];
check('team member count', members.length === 8);
check('team members reference workers', members.every(member => expectedWorkers.has(member.name)));
check('team roles valid', members.every(member => contract.resource.teamRoleEnum.includes(member.role)));
check('exactly one team leader', members.filter(member => member.role === 'team_leader').length === 1 && members.find(member => member.role === 'team_leader')?.name === 'devorbit-lead');
const mcpUrls = workers.flatMap(worker => (worker.spec.mcpServers || []).map(server => server.url));
check('single logical MCP endpoint', new Set(mcpUrls).size === 1 && mcpUrls[0] === 'https://devorbit.example/mcp');

for (const [worker, skill] of expectedWorkers) {
  if (!skill) continue;
  const zip = new URL(`../worker-packages/dist/${worker}.zip`, import.meta.url);
  const listing = execFileSync('unzip', ['-Z1', zip.pathname], { encoding: 'utf8' }).trim().split('\n');
  for (const required of contract.package.required) check(`${worker} package ${required}`, listing.includes(required));
  check(`${worker} bundled skill`, listing.includes(`skills/${skill}/SKILL.md`));
  const manifest = JSON.parse(execFileSync('unzip', ['-p', zip.pathname, 'manifest.json'], { encoding: 'utf8' }));
  check(`${worker} manifest fields`, Object.keys(manifest).every(field => contract.package.manifestTopFields.includes(field)));
  check(`${worker} manifest worker fields`, Object.keys(manifest.worker || {}).every(field => contract.package.manifestWorkerFields.includes(field)));
  check(`${worker} manifest identity`, manifest.worker?.suggested_name === worker && manifest.worker?.runtime === 'openclaw' && manifest.worker?.model === contract.resource.defaultModel);
  const skillText = execFileSync('unzip', ['-p', zip.pathname, `skills/${skill}/SKILL.md`], { encoding: 'utf8' });
  check(`${worker} skill frontmatter`, skillText.startsWith('---\n') && skillText.includes(`name: ${skill}`) && skillText.includes('description:'));
  const officialPath = `skills/${cloudSkillContract.skill.name}/SKILL.md`;
  check(`${worker} official cloud skill assignment`, cloudSkillContract.integration.workers.includes(worker) === listing.includes(officialPath));
  if (cloudSkillContract.integration.workers.includes(worker)) {
    const officialSkillText = execFileSync('unzip', ['-p', zip.pathname, officialPath]);
    check(`${worker} official cloud skill digest`, createHash('sha256').update(officialSkillText).digest('hex') === cloudSkillContract.artifact.skillMdSha256);
  }
}

const officialArchive = await readFile(new URL(`../${cloudSkillContract.artifact.path}`, import.meta.url));
check('official cloud skill archive digest', createHash('sha256').update(officialArchive).digest('hex') === cloudSkillContract.artifact.sha256);
check('official cloud skill version lock', cloudSkillContract.skill.name === 'alibabacloud-sls-query' && cloudSkillContract.skill.version === '0.0.2');

const rendered = await readFile(new URL('../config/agentteams.yaml', import.meta.url), 'utf8');
const renderedDocs = rendered.split('\n---\n').map(document => JSON.parse(document.slice(document.indexOf('{'))));
check('rendered manifest version annotation', rendered.includes(contract.source.commit));
check('rendered manifest has nine documents', rendered.split('\n---\n').length === 9);
check('rendered manifest round trip', JSON.stringify(renderedDocs) === JSON.stringify(resources));
check('deploy script uses official ZIP path', (await readFile(new URL('../scripts/deploy_agentteams.sh', import.meta.url), 'utf8')).includes('apply worker'));

const report = {
  generatedAt: new Date().toISOString(),
  source: contract.source,
  resourceDigest: createHash('sha256').update(JSON.stringify(resources)).digest('hex'),
  summary: {
    workers: workers.length,
    teams: teams.length,
    checks: checks.length,
    passed: checks.filter(item => item.ok).length,
    failed: checks.filter(item => !item.ok).length
  },
  checks
};
await writeFile(new URL('../reports/agentteams-contract.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const markdown = [
  '# AgentTeams v1.2.2 契约审计',
  '',
  `- 官方版本：${contract.source.version}`,
  `- Commit：\`${contract.source.commit}\``,
  `- 资源：${workers.length} Worker，${teams.length} Team`,
  `- 结果：${report.summary.passed}/${report.summary.checks} checks passed`,
  `- Resource digest：\`${report.resourceDigest.slice(0, 16)}\``,
  '',
  '| Check | Result | Detail |',
  '|---|---|---|',
  ...checks.map(item => `| ${item.label} | ${item.ok ? 'PASS' : 'FAIL'} | ${item.detail || ''} |`),
  '',
  '证据来源见 `config/agentteams-v1.2.2.contract.json`；本地 Demo 未声称已启动官方集群。'
].join('\n') + '\n';
await writeFile(new URL('../reports/agentteams-contract.md', import.meta.url), markdown);
for (const { label, ok, detail } of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
if (checks.some(item => !item.ok)) process.exit(1);

const digest = report.resourceDigest;
console.log(`PASS AgentTeams ${contract.source.version} contract: ${workers.length} workers, ${teams.length} team, resource digest ${digest.slice(0, 16)}`);

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const root = new URL('../', import.meta.url);
const readText = path => readFile(new URL(path, root), 'utf8');
const readJson = async path => JSON.parse(await readText(path));
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const manifestBytes = await readText('evaluation/public-model-pilot-v8.manifest.json');
const manifest = JSON.parse(manifestBytes);
const schema = await readJson('schemas/public-model-pilot-v8.schema.json');
const report = await readJson('reports/public-model-pilot-v8.json');
const transcript = await readJson(manifest.evidence.transcriptPath);
const controlReportPath = 'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-008-control-failure-001.json';
const controlTranscriptPath = 'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-008-control-failure-001-transcript.json';
const checks = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);
const digestMatches = async (path, digest) => shaRef(await readText(path)) === digest;

check('v8 manifest schema', validateJsonSchema(manifest, schema).length === 0);
for (const prior of manifest.priorRuns) check(`prior evidence ${prior.runId}`, await digestMatches(prior.evidencePath, prior.evidenceSha256));
for (const [pathKey, digestKey] of [['issuePath', 'issueSha256'], ['commentsPath', 'commentsSha256'], ['testPatchPath', 'testPatchSha256']]) {
  check(`input digest ${pathKey}`, await digestMatches(manifest.case[pathKey], manifest.case[digestKey]));
}
check('compatibility disclosure explicit', report.runId === 'run-008'
  && report.case.split === 'dev-validation-policy-guided-factory-compatibility'
  && report.disclosure.includes('Run 7 passed its frozen')
  && report.disclosure.includes('later source-level compatibility audit')
  && report.disclosure.includes('not independent generalization'));
check('real pinned model', report.model.digest === manifest.model.digest
  && report.model.name === 'qwen3:8b'
  && report.model.temperature === 0
  && report.model.seed === 847);
check('control failure retained', report.status === 'failed'
  && report.stage === 'completed'
  && report.error.includes('run-008-model.patch')
  && report.workflow.patchAttempts === 0
  && report.workflow.closedLoop === false);
check('no patch-agent output accepted', transcript.agents.map(item => item.agent).join(',') === 'rca-worker'
  && transcript.status === 'failed');
check('no gold access or comparison', transcript.leakageBoundary.enforced === true
  && transcript.leakageBoundary.goldComparisonPerformed === false
  && transcript.leakageBoundary.forbiddenArtifactsRead.length === 0);
check('control report backup digest', await digestMatches(controlReportPath, 'sha256:5a1cab29c2e2bbc5db0bfaa3c72d6ac0d74c62ea51607a1c830ee701d97a8e04'));
check('control transcript backup digest', await digestMatches(controlTranscriptPath, 'sha256:c788829d8f459033e2da0382da7e12080b855ab821aaf4d98ae3369f57caa7f9'));
check('current report matches backup', shaRef(await readText('reports/public-model-pilot-v8.json')) === shaRef(await readText(controlReportPath)));
const forbidden = ['expectedFixCommit', 'goldPatch', 'goldVerification', 'pullRequestUrl', 'pull request page', 'benchmark answer'];
const agentVisible = JSON.stringify(transcript.agents.map(item => ({ visibleEvidence: item.visibleEvidence, output: item.output })));
check('agent transcript contains no forbidden gold fields', forbidden.every(term => !agentVisible.includes(term)));

for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
const passed = checks.filter(([, ok]) => ok).length;
if (passed !== checks.length) process.exit(1);
console.log(`PASS public model run-008 control failure evidence: ${passed}/${checks.length}, zero patch accepted`);

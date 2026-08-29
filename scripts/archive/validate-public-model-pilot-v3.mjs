import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const root = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const manifestBytes = await readFile(new URL('evaluation/public-model-pilot-v3.manifest.json', root));
const manifest = JSON.parse(manifestBytes);
const schema = await readJson('schemas/public-model-pilot-v3.schema.json');
const report = await readJson('reports/public-model-pilot-v3.json');
const transcript = await readJson(manifest.evidence.transcriptPath);
const checks = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);

check('v3 manifest schema', validateJsonSchema(manifest, schema).length === 0);
check('pre-registration digest bound', transcript.manifestDigest === shaRef(manifestBytes));
for (const prior of manifest.priorRuns) check(`prior evidence ${prior.runId}`, shaRef(await readFile(new URL(prior.evidencePath, root))) === prior.evidenceSha256);
for (const [pathKey, digestKey] of [['issuePath', 'issueSha256'], ['commentsPath', 'commentsSha256'], ['testPatchPath', 'testPatchSha256']]) {
  check(`input digest ${pathKey}`, shaRef(await readFile(new URL(manifest.case[pathKey], root))) === manifest.case[digestKey]);
}
check('tuning repair disclosure explicit', report.runId === 'run-003' && report.case.split === 'dev-validation-tuning-repair' && report.disclosure.includes('not independent generalization'));
check('real pinned model', report.model.digest === manifest.model.digest && report.model.name === 'qwen3:8b' && report.model.temperature === 0 && report.model.seed === 847);
check('bounded two-attempt loop', report.workflow.patchAttempts === 2 && report.attempts.length === 2 && transcript.agents.map(item => item.agent).join(',') === 'rca-worker,patch-worker,verify-worker,patch-worker,verify-worker');
check('mandatory tests separated', report.workflow.targetExitCode === 0 && report.workflow.regressionExitCode === 0 && report.workflow.classificationExitCode === 1);
check('machine gate rejected over-broad patch', report.verification.machineGate.passed === false && report.verification.machineGate.failedChecks.includes('classificationPassed'));
check('model verifier cannot override gate', report.workflow.acceptanceRule === manifest.workflow.acceptanceRule && report.workflow.modelVerifierAccepted === false && report.workflow.verifyAccepted === false && report.workflow.closedLoop === false && report.status === 'failed');
check('over-broad default change preserved', report.patch.changedPaths.length === 1 && report.patch.changedPaths[0] === 'src/sqlfluff/core/parser/segments/base.py' && (await readFile(new URL(manifest.evidence.patchPath, root), 'utf8')).includes('+    is_whitespace = True'));
check('infrastructure retry disclosed', report.infrastructureRetries.length === 1 && report.infrastructureRetries[0].stage === 'prepare-source' && report.infrastructureRetries[0].agentsStarted === 0 && shaRef(await readFile(new URL(report.infrastructureRetries[0].path, root))) === report.infrastructureRetries[0].sha256);
check('no gold access or comparison', transcript.leakageBoundary.enforced === true && transcript.leakageBoundary.goldComparisonPerformed === false && transcript.leakageBoundary.forbiddenArtifactsRead.length === 0);
for (const [label, artifact] of Object.entries(report.artifacts)) check(`artifact digest ${label}`, shaRef(await readFile(new URL(artifact.path, root))) === artifact.sha256);
for (const [index, attempt] of report.attemptArtifacts.entries()) {
  for (const [label, artifact] of Object.entries(attempt)) check(`attempt ${index + 1} ${label}`, shaRef(await readFile(new URL(artifact.path, root))) === artifact.sha256);
}
const forbidden = ['expectedFixCommit', 'goldPatch', 'goldVerification', 'pullRequestUrl', 'pull request page', 'benchmark answer'];
const agentVisible = JSON.stringify(transcript.agents.map(item => ({ visibleEvidence: item.visibleEvidence, output: item.output })));
check('agent transcript contains no forbidden gold fields', forbidden.every(term => !agentVisible.includes(term)));

for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
const passed = checks.filter(([, ok]) => ok).length;
if (passed !== checks.length) process.exit(1);
console.log(`PASS public model run-003 failure evidence: ${passed}/${checks.length}, machine gate rejected over-broad patch`);

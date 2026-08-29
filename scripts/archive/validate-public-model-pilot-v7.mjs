import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const root = new URL('../', import.meta.url);
const readText = path => readFile(new URL(path, root), 'utf8');
const readJson = async path => JSON.parse(await readText(path));
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const manifestBytes = await readText('evaluation/public-model-pilot-v7.manifest.json');
const manifest = JSON.parse(manifestBytes);
const schema = await readJson('schemas/public-model-pilot-v7.schema.json');
const report = await readJson('reports/public-model-pilot-v7.json');
const transcript = await readJson(manifest.evidence.transcriptPath);
const checks = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);
const digestMatches = async (path, digest) => shaRef(await readText(path)) === digest;

check('v7 manifest schema', validateJsonSchema(manifest, schema).length === 0);
check('pre-registration digest bound', transcript.manifestDigest === shaRef(manifestBytes));
for (const prior of manifest.priorRuns) {
  check(`prior evidence ${prior.runId}`, await digestMatches(prior.evidencePath, prior.evidenceSha256));
}
for (const [pathKey, digestKey] of [['issuePath', 'issueSha256'], ['commentsPath', 'commentsSha256'], ['testPatchPath', 'testPatchSha256']]) {
  check(`input digest ${pathKey}`, await digestMatches(manifest.case[pathKey], manifest.case[digestKey]));
}

check('policy-guided disclosure explicit', report.runId === 'run-007'
  && report.case.split === 'dev-validation-policy-guided-tuning'
  && report.disclosure.includes('after six disclosed failures')
  && report.disclosure.includes('policy-guided tuning')
  && report.disclosure.includes('not independent generalization')
  && report.boundary.includes('No independent-generalization'));
check('real pinned model', report.model.digest === manifest.model.digest
  && report.model.name === 'qwen3:8b'
  && report.model.temperature === 0
  && report.model.seed === 847);
check('bounded attempt count', report.workflow.patchAttempts >= 1
  && report.workflow.patchAttempts <= manifest.workflow.patchAttemptLimit
  && report.attempts.length === report.workflow.patchAttempts);
check('all mandatory tests passed', report.workflow.targetExitCode === 0
  && report.workflow.regressionExitCode === 0
  && report.workflow.classificationExitCode === 0);
check('protected source invariant held', report.verification?.machineGate?.checks?.['policy:protected-source-invariant-1'] === true);
check('exact write path policy held', report.verification?.machineGate?.checks?.['policy:allowedWritePaths'] === true
  && report.patch?.changedPaths?.length === 1
  && report.patch.changedPaths[0] === manifest.workflow.allowedWritePaths[0]);
check('machine gate is authoritative', report.workflow.acceptanceRule === manifest.workflow.acceptanceRule
  && report.verification?.machineGate?.passed === true
  && report.workflow.machineGatePassed === true);
check('model verifier accepted machine-passing patch', report.verification?.model?.accept === true
  && report.verification?.effectiveVerdict?.accepted === true
  && report.workflow.modelVerifierAccepted === true
  && report.workflow.verifyAccepted === true);
check('closed loop accepted', report.status === 'passed'
  && report.workflow.closedLoop === true);
check('target evidence passed', (await readText(manifest.evidence.targetLogPath)).includes('1 passed'));
check('145-test regression evidence passed', (await readText(manifest.evidence.regressionLogPath)).includes('145 passed'));
check('classification evidence passed', (await readText(manifest.evidence.classificationLogPath)).includes('PASS token classification'));
check('no gold access or comparison', transcript.leakageBoundary.enforced === true
  && transcript.leakageBoundary.goldComparisonPerformed === false
  && transcript.leakageBoundary.forbiddenArtifactsRead.length === 0);

for (const [label, artifact] of Object.entries(report.artifacts || {})) {
  check(`artifact digest ${label}`, await digestMatches(artifact.path, artifact.sha256));
}
for (const [index, attempt] of (report.attemptArtifacts || []).entries()) {
  for (const [label, artifact] of Object.entries(attempt)) {
    check(`attempt ${index + 1} ${label}`, await digestMatches(artifact.path, artifact.sha256));
  }
}
const forbidden = ['expectedFixCommit', 'goldPatch', 'goldVerification', 'pullRequestUrl', 'pull request page', 'benchmark answer'];
const agentVisible = JSON.stringify(transcript.agents.map(item => ({ visibleEvidence: item.visibleEvidence, output: item.output })));
check('agent transcript contains no forbidden gold fields', forbidden.every(term => !agentVisible.includes(term)));

for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
const passed = checks.filter(([, ok]) => ok).length;
if (passed !== checks.length) process.exit(1);
console.log(`PASS public model run-007 evidence: ${passed}/${checks.length}, policy-guided local model closed loop accepted`);

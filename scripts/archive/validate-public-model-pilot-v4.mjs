import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const root = new URL('../', import.meta.url);
const readText = path => readFile(new URL(path, root), 'utf8');
const readJson = async path => JSON.parse(await readText(path));
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const manifestBytes = await readText('evaluation/public-model-pilot-v4.manifest.json');
const manifest = JSON.parse(manifestBytes);
const schema = await readJson('schemas/public-model-pilot-v4.schema.json');
const report = await readJson('reports/public-model-pilot-v4.json');
const transcript = await readJson(manifest.evidence.transcriptPath);
const checks = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);
const digestMatches = async (path, digest) => shaRef(await readText(path)) === digest;

check('v4 manifest schema', validateJsonSchema(manifest, schema).length === 0);
check('pre-registration digest bound', transcript.manifestDigest === shaRef(manifestBytes));
for (const prior of manifest.priorRuns) {
  check(`prior evidence ${prior.runId}`, await digestMatches(prior.evidencePath, prior.evidenceSha256));
}
for (const [pathKey, digestKey] of [['issuePath', 'issueSha256'], ['commentsPath', 'commentsSha256'], ['testPatchPath', 'testPatchSha256']]) {
  check(`input digest ${pathKey}`, await digestMatches(manifest.case[pathKey], manifest.case[digestKey]));
}

check('protected-repair disclosure explicit', report.runId === 'run-004'
  && report.case.split === 'dev-validation-tuning-protected-repair'
  && report.disclosure.includes('not independent generalization')
  && report.boundary.includes('No independent-generalization'));
check('real pinned model', report.model.digest === manifest.model.digest
  && report.model.name === 'qwen3:8b'
  && report.model.temperature === 0
  && report.model.seed === 847);
check('bounded two-attempt loop', report.workflow.patchAttempts === 2
  && report.attempts.length === 2
  && transcript.agents.map(item => item.agent).join(',') === 'rca-worker,patch-worker,verify-worker,patch-worker');
check('first attempt test evidence retained', report.attempts[0]?.testEvidence?.targetExitCode === 1
  && report.attempts[0]?.testEvidence?.regressionExitCode === 1
  && report.attempts[0]?.testEvidence?.classificationExitCode === 1);
check('diagnostic classification is recorded', (await readText(manifest.evidence.classificationLogPath)).includes('observed=')
  && (await readText(manifest.evidence.classificationLogPath)).includes('expected='));
check('second attempt patch contract rejected', report.attempts[1]?.rejection?.stage === 'patch-agent-attempt-2'
  && report.attempts[1]?.machineGate?.passed === false
  && report.attempts[1]?.machineGate?.failedChecks?.includes('patchContract'));
check('protected source invariant held', report.verification?.machineGate?.checks?.['policy:protected-source-invariant-1'] === true
  && report.attempts[0]?.machineGate?.checks?.['policy:protected-source-invariant-1'] === true);
check('machine gate rejected failed patch', report.workflow.machineGatePassed === false
  && report.verification?.machineGate?.passed === false);
check('model verifier cannot override gate', report.workflow.acceptanceRule === manifest.workflow.acceptanceRule
  && report.workflow.modelVerifierAccepted === false
  && report.workflow.verifyAccepted === false
  && report.workflow.closedLoop === false
  && report.status === 'failed'
  && report.verification?.effectiveVerdict?.accepted === false);
check('final evidence points to first applied attempt', report.patch?.changedPaths?.length === 1
  && report.patch.changedPaths[0].startsWith('src/'));
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
console.log(`PASS public model run-004 failure evidence: ${passed}/${checks.length}, patch contract and machine gate enforced`);

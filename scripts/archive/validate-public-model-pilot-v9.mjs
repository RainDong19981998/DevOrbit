import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const root = new URL('../', import.meta.url);
const readText = path => readFile(new URL(path, root), 'utf8');
const readJson = async path => JSON.parse(await readText(path));
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const manifestBytes = await readText('evaluation/public-model-pilot-v9.manifest.json');
const manifest = JSON.parse(manifestBytes);
const schema = await readJson('schemas/public-model-pilot-v9.schema.json');
const report = await readJson('reports/public-model-pilot-v9.json');
const transcript = await readJson(manifest.evidence.transcriptPath);
const checks = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);
const digestMatches = async (path, digest) => shaRef(await readText(path)) === digest;

check('v9 manifest schema', validateJsonSchema(manifest, schema).length === 0);
check('pre-registration digest bound', transcript.manifestDigest === shaRef(manifestBytes));
for (const prior of manifest.priorRuns) check(`prior evidence ${prior.runId}`, await digestMatches(prior.evidencePath, prior.evidenceSha256));
for (const [pathKey, digestKey] of [['issuePath', 'issueSha256'], ['commentsPath', 'commentsSha256'], ['testPatchPath', 'testPatchSha256']]) check(`input digest ${pathKey}`, await digestMatches(manifest.case[pathKey], manifest.case[digestKey]));
check('bounded-timeout disclosure explicit', report.runId === 'run-009'
  && report.case.split === 'dev-validation-policy-guided-bounded-timeout-compatibility'
  && report.disclosure.includes('Run 8 pre-registered the stronger audit')
  && report.disclosure.includes('not independent generalization'));
check('real pinned model', report.model.digest === manifest.model.digest && report.model.temperature === 0 && report.model.seed === 847);
check('timeout bound frozen and reported', report.workflow.responseTimeoutMs === manifest.workflow.responseTimeoutMs && report.workflow.responseTimeoutMs === 600000);
check('two patch contracts rejected', report.workflow.patchAttempts === 2
  && report.attempts.length === 2
  && report.attempts.every(item => item.rejection?.error.includes('oldText must occur exactly once, observed 0'))
  && report.attempts.every(item => item.machineGate?.failedChecks?.includes('patchContract')));
check('no test evidence fabricated', report.workflow.targetExitCode === null
  && report.workflow.regressionExitCode === null
  && report.workflow.classificationExitCode === null
  && report.patch === null);
check('closed loop rejected', report.status === 'failed'
  && report.workflow.machineGatePassed === false
  && report.workflow.verifyAccepted === false
  && report.workflow.closedLoop === false);
check('only transcript artifact exists', Object.keys(report.artifacts).join(',') === 'transcript'
  && await digestMatches(report.artifacts.transcript.path, report.artifacts.transcript.sha256));
check('model calls retained', transcript.agents.map(item => item.agent).join(',') === 'rca-worker,patch-worker,patch-worker');
check('no gold access or comparison', transcript.leakageBoundary.enforced === true
  && transcript.leakageBoundary.goldComparisonPerformed === false
  && transcript.leakageBoundary.forbiddenArtifactsRead.length === 0);
const forbidden = ['expectedFixCommit', 'goldPatch', 'goldVerification', 'pullRequestUrl', 'pull request page', 'benchmark answer'];
const agentVisible = JSON.stringify(transcript.agents.map(item => ({ visibleEvidence: item.visibleEvidence, output: item.output })));
check('agent transcript contains no forbidden gold fields', forbidden.every(term => !agentVisible.includes(term)));

for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
const passed = checks.filter(([, ok]) => ok).length;
if (passed !== checks.length) process.exit(1);
console.log(`PASS public model run-009 failure evidence: ${passed}/${checks.length}, cross-file oldText rejected`);

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const root = resolve(new URL('../', import.meta.url).pathname);
const checks = [];
const check = (name, condition, detail) => {
  if (!condition) throw new Error(`${name}: ${detail}`);
  checks.push({ name, passed: true });
};
const shaRef = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const readJson = async path => JSON.parse(await readFile(resolve(root, path)));
const absent = async path => {
  try { await access(resolve(root, path)); return false; } catch { return true; }
};

const manifestBytes = await readFile(resolve(root, 'evaluation/independent-model-pilot.manifest.json'));
const manifest = JSON.parse(manifestBytes);
const schema = await readJson('schemas/independent-model-pilot.schema.json');
const selectionBytes = await readFile(resolve(root, manifest.selection.recordPath));
const selection = JSON.parse(selectionBytes);
const issueBytes = await readFile(resolve(root, manifest.case.issuePath));
const testPatchBytes = await readFile(resolve(root, manifest.case.testPatchPath));
const requirementsBytes = await readFile(resolve(root, manifest.case.requirementsPath));
const classificationBytes = await readFile(resolve(root, manifest.case.classificationProbePath));
const runnerBytes = await readFile(resolve(root, manifest.implementation.runnerPath));
const report = await readJson('reports/independent-model-pilot.json');
const preflight = await readJson('reports/independent-model-pilot-preflight-001.json');
const transcript = await readJson(manifest.evidence.transcriptPath);
const preflightTranscript = await readJson('evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/preflight-001-transcript.json');
const rejection = await readJson('evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/contract-rejection.json');
const baselineBytes = await readFile(resolve(root, manifest.evidence.baselineLogPath));

check('manifest-schema', validateJsonSchema(manifest, schema).length === 0, 'manifest must satisfy frozen schema');
check('runner-binding', shaRef(runnerBytes) === manifest.implementation.runnerSha256, 'runner digest drifted');
check('selection-binding', shaRef(selectionBytes) === manifest.selection.recordSha256, 'selection record digest drifted');
check('issue-binding', shaRef(issueBytes) === manifest.case.issueSha256, 'issue digest drifted');
check('hidden-test-binding', shaRef(testPatchBytes) === manifest.case.testPatchSha256, 'test patch digest drifted');
check('dependency-binding', shaRef(requirementsBytes) === manifest.case.requirementsSha256, 'dependency lock digest drifted');
check('classification-binding', shaRef(classificationBytes) === manifest.case.classificationProbeSha256, 'classification probe digest drifted');
check('candidate-selected-once', selection.candidates.filter(item => item.selectionStatus === 'selected').length === 1 && selection.candidates.find(item => item.selectionStatus === 'selected')?.instanceId === manifest.case.instanceId, 'selection must bind exactly one candidate');
check('selection-before-model', manifest.selection.selectedBeforeModelInvocation && manifest.selection.replacementAfterOutcomeForbidden, 'anti-cherry-picking controls missing');
check('gold-isolation-selection', selection.goldIsolation.implementationPatchRead === false && selection.goldIsolation.implementationPatchStored === false && selection.goldIsolation.implementationPatchDigestStored === false, 'gold implementation metadata must be absent');
check('preflight-preserved', preflight.status === 'failed' && preflight.stage === 'verify-runtime' && preflight.workflow.patchAttempts === 0 && preflightTranscript.agents.length === 0, 'pre-model digest-format failure evidence changed');
check('terminal-result', report.status === 'failed' && report.stage === 'patch-worker' && transcript.status === 'failed' && transcript.stage === 'patch-worker', 'terminal stage must be patch contract rejection');
check('manifest-report-binding', report.manifestSha256 === shaRef(manifestBytes) && transcript.manifestSha256 === shaRef(manifestBytes), 'result is not bound to current manifest');
check('single-attempt', report.workflow.patchAttempts === 1 && manifest.workflow.patchAttemptLimit === 1, 'run must contain one patch attempt');
check('agent-sequence', JSON.stringify(report.workflow.agentsCompleted) === JSON.stringify(['triage-worker', 'rca-worker', 'patch-worker']) && transcript.agents.map(item => item.agent).join(',') === 'triage-worker,rca-worker,patch-worker', 'unexpected agent execution sequence');
check('model-binding', transcript.agents.every(item => item.model === manifest.model.name && item.modelDigest === manifest.model.digest), 'agent model drifted');
check('agent-output-digests', transcript.agents.every(item => shaRef(JSON.stringify(item.output)) === item.outputSha256), 'agent output digest mismatch');
const proposal = transcript.agents.find(item => item.agent === 'patch-worker')?.output;
check('proposal-recorded', proposal?.edits?.length === 2, 'expected two proposed edits');
check('duplicate-proposal-detected', JSON.stringify(proposal.edits[0]) === JSON.stringify(proposal.edits[1]) && rejection.rejection.duplicateEditCount === 1, 'duplicate proposal evidence missing');
check('contract-rejection-reason', report.error === 'oldText occurrence count 0: pydicom/dataelem.py' && rejection.rejection.reason === report.error, 'contract rejection reason drifted');
check('baseline-reproduced', baselineBytes.toString('utf8').includes(manifest.workflow.baselineExpected.requiredText) && transcript.tools.some(item => item.tool === 'ci.hidden-baseline-target' && item.exitCode === 1 && item.outputSha256 === shaRef(baselineBytes)), 'baseline evidence mismatch');
check('no-post-proposal-evaluation', rejection.workspace.patchedEvaluatorCreated === false && rejection.workspace.hiddenTestsExecutedAfterProposal === false && await absent(manifest.evidence.targetLogPath) && await absent(manifest.evidence.regressionLogPath) && await absent(manifest.evidence.classificationLogPath), 'post-proposal tests must not be claimed');
check('partial-write-disclosed', rejection.workspace.firstEditAppliedToEphemeralModelWorkspace === true && rejection.workspace.proposalAccepted === false, 'v1 partial workspace mutation must remain disclosed');
check('leakage-boundary', report.leakage.goldImplementationRead === false && report.leakage.goldComparisonPerformed === false && report.leakage.forbiddenArtifactsReadByModel.length === 0 && report.leakage.agentNetworkToolsAvailable === false, 'leakage boundary failed');
check('formal-benchmark-not-run', report.formalBenchmark.status === 'not_run' && report.formalBenchmark.scoredCases === 0, 'must not imply an aggregate benchmark');
check('claim-boundary', /not an aggregate|no aggregate/.test(report.claimBoundary), 'claim boundary missing');

console.log(JSON.stringify({ validator: 'devorbit-independent-model-pilot-v1', status: 'passed', checksPassed: checks.length, checks }, null, 2));

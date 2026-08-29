import { readFile } from 'node:fs/promises';
import { runPipeline } from '../src/orchestrator.js';
import { buildSkillsRegistry } from '../src/skills-registry.js';
import { skills } from '../src/skills.js';

const result = await runPipeline();
const checks = [
  ['closed loop', result.metrics.closedLoop === true],
  ['seven workers represented', result.metrics.agents === 7],
  ['real fixture tests green', result.tests.failed === 0 && result.tests.passed === 4 && result.tests.exitCode === 0],
  ['bug reproduced before patch', result.plan.baselineTests.failed === 3 && result.plan.baselineTests.exitCode !== 0],
  ['approval recorded', result.approval.required && result.approval.state === 'approved'],
  ['canary promoted', result.release.decision === 'promoted'],
  ['rollback ready', result.release.rollbackReady === true],
  ['knowledge card written', Boolean(result.knowledge.cardId || result.knowledge.episodeId)],
  ['trace has evidence', result.metrics.evidence >= 15],
  ['manager worker messages', result.metrics.messages >= 14],
  ['versioned case state', result.state.revision >= 8],
  ['real CI artifact digest', result.tests.artifact.startsWith('sha256:')]
  ,['MCP protocol version', result.mcp.protocolVersion === '2025-06-18']
  ,['MCP tools called', result.mcp.calls >= 15 && result.mcp.audit.every(item => item.status === 'ok' && item.traceId === result.state.traceId)]
  ,['workspace disposed', result.plan.workspaceDisposed === true]
  ,['RAG top result cited', (result.rca.retrieval.results[0]?.id === 'KB-HIST-001' || result.rca.retrieval.results[0]?.id === 'EP-001') && result.rca.retrieval.results[0]?.citation?.startsWith('knowledge://')]
];
const resources = JSON.parse(await readFile(new URL('../config/agentteams.resources.json', import.meta.url), 'utf8'));
checks.push(['official AgentTeams apiVersion', resources.every(resource => resource.apiVersion === 'agentteams.io/v1beta1')]);
checks.push(['team leader declared', resources.some(resource => resource.kind === 'Team' && resource.spec.workerMembers.filter(member => member.role === 'team_leader').length === 1)]);
for (const skill of ['signal-fusion', 'impact-map', 'evidence-rca', 'patch-plan', 'test-gate', 'release-guard', 'knowledge-card']) {
  const content = await readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
  checks.push([`skill package ${skill}`, content.includes(`name: ${skill}`)]);
  checks.push([`skill package ${skill} semver frontmatter`, /^version: \d+\.\d+\.\d+$/m.test(content)]);
}
const registry = buildSkillsRegistry();
checks.push(['skills registry builds with digests', registry.length === 7 && registry.every(entry => /^\d+\.\d+\.\d+$/.test(entry.version) && entry.digest.startsWith('sha256:'))]);
const catalogVersions = new Map(skills.filter(skill => !skill.official).map(skill => [skill.id, skill.version]));
checks.push(['skill versions aligned with catalog', registry.every(entry => catalogVersions.get(entry.id) === entry.version)]);
checks.push(['trace records skill version and digest', result.trace.filter(event => event.skill && event.skill !== 'case-orchestration').length >= 7 && result.trace.filter(event => event.skill && event.skill !== 'case-orchestration').every(event => event.skillVersion && event.skillDigest?.startsWith('sha256:'))]);
const lifecycle = await readFile(new URL('../config/case-lifecycle.yaml', import.meta.url), 'utf8');
checks.push(['lifecycle failure policy', lifecycle.includes('canary_regression: automatic_rollback')]);
const packageArtifact = await readFile(new URL('../worker-packages/dist/intake-worker.zip', import.meta.url)).catch(() => null);
checks.push(['worker package built', Boolean(packageArtifact)]);
const officialCloudSkill = JSON.parse(await readFile(new URL('../config/aliyun-official-skill.contract.json', import.meta.url), 'utf8'));
checks.push(['official cloud skill locked', officialCloudSkill.skill.name === 'alibabacloud-sls-query' && officialCloudSkill.skill.version === '0.0.2' && officialCloudSkill.integration.workers.length === 2]);
const evaluation = JSON.parse(await readFile(new URL('../reports/evaluation.json', import.meta.url), 'utf8'));
checks.push(['golden cases pass', evaluation.summary.passed === evaluation.summary.cases && evaluation.summary.cases >= 7]);
checks.push(['safety cases pass', evaluation.summary.safetyCorrect === evaluation.summary.safetyCases && evaluation.summary.safetyCases >= 5]);
checks.push(['evaluation evidence coverage', evaluation.summary.averageEvidenceCoverage === 1]);
checks.push(['evaluation RAG citations', evaluation.summary.ragCitationRate === 1]);
const ragEvaluation = JSON.parse(await readFile(new URL('../reports/rag-evaluation.json', import.meta.url), 'utf8'));
checks.push(['diverse RAG top-1 evaluation', ragEvaluation.summary.cases >= 4 && ragEvaluation.summary.lexicalTop1Accuracy === 1 && ragEvaluation.summary.hybridTop1Accuracy === 1 && ragEvaluation.summary.citationRate === 1]);
const benchmark = JSON.parse(await readFile(new URL('../reports/benchmark.json', import.meta.url), 'utf8'));
checks.push(['benchmark full policy accepted', benchmark.primary.outcomeAccuracy === 1 && benchmark.primary.safetyAccuracy === 1]);
checks.push(['benchmark includes naive baseline', benchmark.variants.some(variant => variant.name === 'monolithic-naive-baseline')]);
const securityEvaluation = JSON.parse(await readFile(new URL('../reports/security-evaluation.json', import.meta.url), 'utf8'));
checks.push(['adversarial policy cases pass', securityEvaluation.summary.passed === securityEvaluation.summary.cases && securityEvaluation.summary.cases >= 6]);
const otel = JSON.parse(await readFile(new URL('../reports/otel-happy-path.json', import.meta.url), 'utf8'));
checks.push(['OTLP agent and tool spans', otel.summary.agentSpans >= 14 && otel.summary.toolSpans >= 15 && otel.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.every(span => span.traceId.length === 32 && span.spanId.length === 16)]);
const toolPolicy = JSON.parse(await readFile(new URL('../config/tool-policy.json', import.meta.url), 'utf8'));
checks.push(['server-side tool policy contract', Object.keys(toolPolicy.rules).length === 10 && toolPolicy.rules['release.canary'].approval === true]);
const replay = JSON.parse(await readFile(new URL('../reports/runs/happy-path.json', import.meta.url), 'utf8'));
checks.push(['replayable run report', replay.release.decision === 'promoted' && replay.plan.baselineTests.failed === 3 && replay.tests.passed === 4]);
const adapterOpenApi = JSON.parse(await readFile(new URL('../schemas/http-adapter.openapi.json', import.meta.url), 'utf8'));
const adapterOperations = Object.values(adapterOpenApi.paths || {}).flatMap(pathItem => Object.values(pathItem).filter(value => value?.operationId));
checks.push(['HTTP Adapter OpenAPI', adapterOpenApi.openapi === '3.1.0' && adapterOpenApi.info?.version === '0.5.0' && adapterOperations.length === 10]);
checks.push(['HTTP Adapter idempotency contract', adapterOperations.filter(operation => operation['x-devorbit-idempotency-required']).length === 6]);
const containerEvidence = JSON.parse(await readFile(new URL('../reports/container-smoke.json', import.meta.url), 'utf8'));
checks.push(['hardened container evidence', containerEvidence.summary.passed === 14 && containerEvidence.summary.failed === 0 && containerEvidence.hardening.uid === 10001 && containerEvidence.hardening.readOnlyRootfs === true && containerEvidence.hardening.noNewPrivileges === true]);
const publicManifest = JSON.parse(await readFile(new URL('../evaluation/public-benchmark.manifest.json', import.meta.url), 'utf8'));
const publicReport = JSON.parse(await readFile(new URL('../reports/public-benchmark.json', import.meta.url), 'utf8'));
checks.push(['public benchmark is frozen with scored cases', publicManifest.status === 'frozen' && publicManifest.cases.length === 30 && publicReport.status === 'completed' && publicReport.manifest?.cases === 30 && Object.keys(publicReport.methods).length >= 2 && /^sha256:[0-9a-f]{64}$/.test(publicReport.manifestDigest || '')]);
checks.push(['public benchmark sources are HTTPS with snapshots', publicManifest.sources.length >= 1 && publicManifest.sources.every(source => source.url.startsWith('https://') && source.snapshot !== null)]);
checks.push(['public benchmark policy is explicit', publicManifest.selectionPolicy?.splitSeed && publicManifest.evaluationPolicy?.goldFixAccess === 'evaluator-only' && publicManifest.evaluationPolicy?.primarySplit === 'test']);
const publicPilot = JSON.parse(await readFile(new URL('../evaluation/public-benchmark-pilot.manifest.json', import.meta.url), 'utf8'));
checks.push(['public reproduction pilot is non-scored', publicPilot.status === 'frozen-reproduced-not-scored' && publicPilot.case.split === 'validation-pilot' && publicPilot.case.goldPatchStored === false && publicPilot.evidence.baselineExitCode === 1 && publicPilot.evidence.goldFailToPassPassed === 1 && publicPilot.evidence.goldAnsiFilePassed === 43]);
const complianceDisclosure = await readFile(new URL('../docs/第三方依赖与合规清单.md', import.meta.url), 'utf8');
checks.push(['dependency disclosure', complianceDisclosure.includes('AgentTeams') && complianceDisclosure.includes('alibabacloud-sls-query') && complianceDisclosure.includes('无第三方 npm 包')]);
const nativeContract = JSON.parse(await readFile(new URL('../config/platform-native.contract.json', import.meta.url), 'utf8'));
const nativeSchema = JSON.parse(await readFile(new URL('../schemas/platform-native.contract.schema.json', import.meta.url), 'utf8'));
checks.push(['native platform contract', nativeContract.mode === 'github-jenkins-argo' && nativeContract.security.argoCanarySetWeight === 10 && nativeContract.security.approvalTokenCrossesBoundary === false && nativeContract.security.repositorySymlinkTraversalDenied === true && nativeContract.security.idempotencyUnknownOutcomeFailsClosed === true && nativeContract.security.reconciliationEvidenceRequired === true && nativeContract.security.argoPatchMediaType === 'application/json-patch+json' && nativeContract.security.argoObservedGenerationRequired === true && nativeContract.evidence.command === 'npm run native-platform-smoke']);
const nativeReport = JSON.parse(await readFile(new URL('../reports/native-platform-smoke.json', import.meta.url), 'utf8'));
checks.push(['native platform connector evidence', nativeReport.status === 'passed' && nativeReport.summary.passed === nativeReport.summary.checks && nativeReport.evidence.baselineFailed === 3 && nativeReport.evidence.patchedPassed === 4 && nativeReport.evidence.mcpCalls === 15]);
const nativeRunnerReport = JSON.parse(await readFile(new URL('../reports/native-runner-smoke.json', import.meta.url), 'utf8'));
checks.push(['native runner container evidence', nativeRunnerReport.status === 'passed' && nativeRunnerReport.summary.passed === 6 && nativeRunnerReport.summary.failed === 0 && nativeRunnerReport.gitVersion === 'git version 2.39.5' && nativeRunnerReport.hardening.uid === 10001 && nativeRunnerReport.hardening.readOnlyRootfs === true && nativeRunnerReport.persistence.path === '/var/lib/devorbit/idempotency']);
const migration = JSON.parse(await readFile(new URL('../reports/scenario-migration.json', import.meta.url), 'utf8'));
checks.push(['scenario migration closes second domain loop', migration.summary.mechanismsIdentical === true && migration.cases.checkout.status === 'learned' && migration.cases.inventory.status === 'learned' && migration.cases.inventory.baseline.failed === 3 && migration.cases.inventory.patched.failed === 0 && migration.cases.inventory.evidenceChainVerified === true]);
const faultDrill = JSON.parse(await readFile(new URL('../reports/fault-drill.json', import.meta.url), 'utf8'));
checks.push(['fault drill matrix all pass', faultDrill.summary.passed === faultDrill.summary.drills && faultDrill.summary.drills >= 6 && faultDrill.drills.every(drill => drill.pass)]);
const skillsRegistry = JSON.parse(await readFile(new URL('../reports/skills-registry.json', import.meta.url), 'utf8'));
checks.push(['skills registry lifecycle evidence', skillsRegistry.summary.skills === 8 && skillsRegistry.summary.custom === 7 && skillsRegistry.summary.official === 1 && skillsRegistry.summary.versionsAligned === true && skillsRegistry.skills.every(skill => skill.digest && skill.binding)]);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const deliverables = new URL('../deliverables/', import.meta.url);
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });
const forbidden = [String.fromCodePoint(20013, 22269, 31227, 21160), String.fromCodePoint(28789, 30079)];
const secretPatterns = [
  /sk-[0-9a-f]{32,}/i,
  /sk-zhanlu-[A-Za-z0-9]{16,}/,
  /Bearer\s+sk-[A-Za-z0-9]{8,}/i,
  /(DASHSCOPE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*[=:]\s*['"]?sk-/i,
  /ghp_[A-Za-z0-9]{36,}/,
  /glpat-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/
];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const command = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', ...options });
const archiveEntries = path => command('unzip', ['-Z1', path]).trim().split('\n').filter(Boolean);
const archiveFile = (path, entry, encoding = null) => execFileSync('unzip', ['-p', path, entry], { ...(encoding ? { encoding } : {}), maxBuffer: 64 * 1024 * 1024 });
const hasForbidden = text => forbidden.some(word => text.includes(word));
const hasSecret = text => secretPatterns.some(pattern => pattern.test(text));

const intro = await readFile(new URL('../docs/作品简介.md', import.meta.url), 'utf8');
const introBody = intro.split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith('**')).join('');
check('intro length', introBody.length <= 500, `${introBody.length}/500 chars`);
check('intro required claims', introBody.includes('7 个自定义 Skill') && introBody.includes('官方日志查询 Skill'));
check('intro compliance', !hasForbidden(introBody));

const pdfPath = fileURLToPath(new URL('DevOrbit_复赛方案.pdf', deliverables));
const pdfInfo = command('pdfinfo', [pdfPath]);
const pdfText = command('pdftotext', ['-layout', pdfPath, '-']);
check('PDF page count', /^Pages:\s+18$/m.test(pdfInfo));
check('PDF submission date', pdfText.includes('2026') && pdfText.includes('8') && pdfText.includes('31'));
check('PDF product positioning', pdfText.includes('缺陷') && pdfText.includes('Agent') && pdfText.includes('闭环'));
check('PDF official Skill evidence', pdfText.includes('Skill') && pdfText.includes('AgentTeams'));
check('PDF V1.0.0 cover and evidence', pdfText.includes('V1.0.0') && pdfText.includes('113/113') && pdfText.includes('AgentTeams') && pdfText.includes('SWE-bench'));
check('PDF mandatory sections', pdfText.includes('初赛反馈') && pdfText.includes('场景闭环') && pdfText.includes('风险边界') && pdfText.includes('可复制'));
check('PDF compliance', !hasForbidden(pdfText));

const pptxPath = fileURLToPath(new URL('DevOrbit_复赛方案.pptx', deliverables));
const pptxText = archiveEntries(pptxPath)
  .filter(entry => entry.startsWith('ppt/') && entry.endsWith('.xml'))
  .map(entry => archiveFile(pptxPath, entry, 'utf8'))
  .join('\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
check('PPTX official Skill evidence', pptxText.includes('Skill') && pptxText.includes('AgentTeams'));
check('PPTX V1.0.0 cover and evidence', pptxText.includes('V1.0.0') && pptxText.includes('edit-based') && pptxText.includes('SWE-bench') && pptxText.includes('113'));
check('PPTX compliance', !hasForbidden(pptxText));

const videoPath = fileURLToPath(new URL('DevOrbit_演示视频.mp4', deliverables));
const video = await readFile(videoPath);
const videoDigest = sha256(video);
const videoProbe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', videoPath]));
const stream = videoProbe.streams?.find(item => item.codec_type === 'video') || {};
check('video format', stream.codec_name === 'h264' && stream.width === 1280 && stream.height === 800 && stream.pix_fmt === 'yuv420p');
check('video has no audio stream', !videoProbe.streams?.some(item => item.codec_type === 'audio'));
check('video duration', Math.abs(Number(videoProbe.format?.duration) - 129) < 0.05, `${videoProbe.format?.duration}s`);
check('video reviewed digest unchanged', videoDigest === 'e55914a513f3dac224d9cf2debe093deb06e25e097bb45b9ef45782211bec238', videoDigest.slice(0, 16));
const videoMetadata = command('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', videoPath]);
check('video metadata compliance', !hasForbidden(videoMetadata));
const explainerPath = fileURLToPath(new URL('DevOrbit_初赛讲解视频_无配音版.mp4', deliverables));
let explainerDigest = 'n/a', explainerProbe = { streams: [] };
try { explainerDigest = sha256(await readFile(explainerPath)); explainerProbe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', explainerPath])); } catch { /* V0.9.5 removed initial-round explainer video */ }
const explainerStream = explainerProbe.streams?.find(item => item.codec_type === 'video') || {};
const explainerAudio = explainerProbe.streams?.find(item => item.codec_type === 'audio');
const explainerPresent = explainerDigest !== 'n/a';
check('explainer video format', !explainerPresent || (explainerStream.codec_name === 'h264' && explainerStream.width === 1280 && explainerStream.height === 720 && explainerStream.pix_fmt === 'yuv420p'));
check('explainer has no audio stream', !explainerPresent || !explainerAudio);
check('explainer video duration', !explainerPresent || (Number(explainerProbe.format?.duration) >= 135 && Number(explainerProbe.format?.duration) <= 145), `${explainerProbe.format?.duration}s`);
check('explainer reviewed digest unchanged', !explainerPresent || explainerDigest === '1ff3dcac9d6e8502c5f539ea46eb23dd83b9aa05c59a7cba280b621f951bec2a', explainerDigest.slice(0, 16));
let explainerMetadata = '{}';
try { explainerMetadata = command('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', explainerPath]); } catch { /* explainer video absent (V0.9.5+ removed initial-round explainer) */ }
check('explainer metadata compliance', !hasForbidden(explainerMetadata));

for (const [name, evidence] of [
  ['DevOrbit_AgentTeams本地运行验证.pdf', 'AgentTeams 本地运行验证'],
  ['DevOrbit_Agent-Identity清单.pdf', 'Agent Identity 清单'],
  ['DevOrbit_Skill清单.pdf', 'Skill 清单'],
  ['DevOrbit_工具与云产品清单.pdf', '工具与云产品清单'],
  ['DevOrbit_威胁模型.pdf', 'Fail-closed'],
  ['DevOrbit_证据索引.pdf', '评分证据索引'],
  ['DevOrbit_对照与消融评测.pdf', 'Wilson'],
  ['DevOrbit_对抗安全评测.pdf', '9/9'],
  ['DevOrbit_公开基准复现试点.pdf', '公开基准复现试点']
]) {
  const path = fileURLToPath(new URL(name, deliverables));
  const info = command('pdfinfo', [path]);
  const text = command('pdftotext', [path, '-']);
  check(`supporting PDF ${name}`, /^Pages:\s+[1-9]\d*$/m.test(info) && text.includes(evidence));
}

const codeZipPath = fileURLToPath(new URL('DevOrbit_复赛可执行代码包.zip', deliverables));
command('unzip', ['-tq', codeZipPath]);
const codeEntries = archiveEntries(codeZipPath);
for (const required of [
  'README.md', 'LICENSE', 'package.json', 'Dockerfile', 'Dockerfile.native', '.dockerignore', 'config/agentteams.yaml',
  'config/tool-policy.json', 'docs/威胁模型.md', 'docs/证据索引.md', 'docs/AgentTeams本地运行验证.md',
  'evaluation/agentteams-runtime-case.manifest.json', 'schemas/agentteams-runtime-case.schema.json', 'schemas/agentteams-runtime-report.schema.json',
  'reports/agentteams-runtime.json', 'scripts/agentteams-identity-proxy.mjs', 'scripts/configure-agentteams-local-runtime.mjs', 'scripts/run-agentteams-runtime-case.mjs', 'scripts/validate-agentteams-runtime.mjs',
  'docs/Adapter生产契约.md', 'schemas/http-adapter.openapi.json', 'src/adapters/http.js',
  'scripts/adapter-contract-smoke.mjs', 'scripts/api-security-smoke.mjs', 'scripts/container-smoke.sh',
  'config/aliyun-official-skill.contract.json',
  'third_party/aliyun/alibabacloud-sls-query-0.0.2-devorbit-curated.zip',
  'reports/agentteams-contract.md', 'reports/benchmark.json', 'reports/security-evaluation.json', 'reports/otel-happy-path.json', 'reports/container-smoke.json',
  'config/platform-native.contract.json', 'schemas/platform-native.contract.schema.json', 'docs/原生平台连接器.md', 'reports/native-platform-smoke.json', 'scripts/native-platform-smoke.mjs', 'scripts/native-runner-smoke.sh', 'scripts/write-native-runner-report.mjs', 'scripts/reconcile-idempotency.mjs', 'reports/native-runner-smoke.json', 'src/adapters/platforms.js', 'src/platform-adapters.test.js',
  'evaluation/public-benchmark.manifest.json', 'reports/public-benchmark.json', 'reports/public-benchmark.md',
  'schemas/public-benchmark.schema.json', 'schemas/public-benchmark-results.schema.json', 'schemas/public-benchmark-report.schema.json',
  'scripts/public-benchmark.mjs', 'src/evaluation/public-benchmark.js', 'src/evaluation/public-benchmark.test.js', 'docs/公开基准协议.md',
  'evaluation/public-benchmark-pilot.manifest.json', 'schemas/public-benchmark-pilot.schema.json', 'docs/公开基准复现试点.md', 'reports/public-benchmark-pilot.json',
  'evaluation/public-pilot/sqlfluff__sqlfluff-884/test.patch', 'evaluation/public-pilot/sqlfluff__sqlfluff-884/requirements.lock',
  'evaluation/public-pilot/sqlfluff__sqlfluff-884/evidence/baseline-normalized.log', 'evaluation/public-pilot/sqlfluff__sqlfluff-884/evidence/gold-fail-to-pass-normalized.log', 'evaluation/public-pilot/sqlfluff__sqlfluff-884/evidence/gold-ansi-file-normalized.log',
  'scripts/validate-public-pilot.mjs', 'scripts/reproduce-public-pilot.sh',
  'evaluation/public-model-pilot-v11.manifest.json', 'schemas/public-model-pilot-v11.schema.json', 'reports/public-model-pilot-v11.json',
  'scripts/run-public-model-pilot.mjs', 'scripts/validate-public-model-pilot-v11.mjs', 'src/evaluation/model-pilot-gate.js', 'src/evaluation/model-pilot-gate.test.js',
  'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-011-transcript.json',
  'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-011-model.patch',
  'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-011-target.log',
  'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-011-regression.log',
  'evaluation/public-model-pilot/sqlfluff__sqlfluff-884/evidence/run-011-classification.log',
  'evaluation/independent-model-pilot.manifest.json', 'schemas/independent-model-pilot.schema.json',
  'evaluation/independent-model-pilot/candidate-selection.json', 'evaluation/independent-model-pilot/pydicom__pydicom-965/issue.json',
  'evaluation/independent-model-pilot/pydicom__pydicom-965/test.patch', 'evaluation/independent-model-pilot/pydicom__pydicom-965/requirements.lock',
  'evaluation/independent-model-pilot/pydicom__pydicom-965/classification_probe.py', 'evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/transcript.json',
  'evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/baseline-target.log', 'evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/contract-rejection.json',
  'reports/independent-model-pilot.json', 'reports/independent-model-pilot-preflight-001.json',
  'scripts/run-independent-model-pilot.mjs', 'scripts/validate-independent-model-pilot.mjs',
  'src/evaluation/exact-edit-transaction.js', 'src/evaluation/exact-edit-transaction.test.js',
  'scripts/release-audit.mjs'
]) check(`code ZIP ${required}`, codeEntries.includes(required));
check('code ZIP cache free', !codeEntries.some(entry => entry.includes('__pycache__') || entry.endsWith('.pyc')));
const codePackage = JSON.parse(archiveFile(codeZipPath, 'package.json', 'utf8'));
check('code ZIP version', codePackage.version === '1.0.0' && codePackage.scripts?.['validate-agentteams-runtime'] && codePackage.scripts?.['native-platform-smoke'] && codePackage.scripts?.['native-runner-smoke'] && codePackage.scripts?.['reconcile-idempotency'] && codePackage.scripts?.['validate-public-model-pilot-v11'] && codePackage.scripts?.['validate-independent-model-pilot'] && codePackage.scripts?.['model-provider-smoke'] && codePackage.scripts?.['gitlab-e2e'] && codePackage.scripts?.['public-benchmark'] && codePackage.scripts?.['canary-docker'] && codePackage.scripts?.['model-ablation'] && codePackage.scripts?.['benchmark-knowledge']);
const agentTeamsRuntime = JSON.parse(archiveFile(codeZipPath, 'reports/agentteams-runtime.json', 'utf8'));
const agentTeamsRuntimeText = JSON.stringify(agentTeamsRuntime);
check('code ZIP official AgentTeams local runtime', agentTeamsRuntime.status === 'passed'
  && agentTeamsRuntime.runtime?.team?.phase === 'Active'
  && agentTeamsRuntime.runtime?.team?.leaderReady === true
  && agentTeamsRuntime.runtime?.team?.readyWorkers === 7
  && agentTeamsRuntime.evidence?.workerMcp?.length === 16
  && agentTeamsRuntime.evidence?.teamHarness?.length === 31
  && agentTeamsRuntime.evidence?.workerMatrix?.length === 7
  && agentTeamsRuntime.evidence?.auditChecks?.every(item => item.observed === true));
check('code ZIP AgentTeams honest boundary', agentTeamsRuntime.boundary?.includes('Local official AgentTeams v1.2.2')
  && agentTeamsRuntime.boundary?.includes('not a cloud account')
  && agentTeamsRuntime.boundary?.includes('production-cluster run'));
check('code ZIP AgentTeams report credential scan', !/(Bearer\s+[A-Za-z0-9._~+\/-]{16,}|MATRIX_ACCESS_TOKEN|WORKER_KEY|ADMIN_PASSWORD)/i.test(agentTeamsRuntimeText));
const adapterOpenApi = JSON.parse(archiveFile(codeZipPath, 'schemas/http-adapter.openapi.json', 'utf8'));
const adapterOperations = Object.values(adapterOpenApi.paths || {}).flatMap(pathItem => Object.values(pathItem).filter(value => value?.operationId));
check('code ZIP HTTP Adapter contract', adapterOpenApi.openapi === '3.1.0' && adapterOpenApi.info?.version === '0.5.0' && adapterOperations.length === 10);
check('code ZIP idempotency boundaries', adapterOperations.filter(operation => operation['x-devorbit-idempotency-required']).length === 6);
const containerEvidence = JSON.parse(archiveFile(codeZipPath, 'reports/container-smoke.json', 'utf8'));
check('code ZIP hardened container evidence', containerEvidence.summary?.passed === 14 && containerEvidence.summary?.failed === 0 && containerEvidence.hardening?.uid === 10001 && containerEvidence.hardening?.readOnlyRootfs === true && containerEvidence.hardening?.noNewPrivileges === true);
check('code ZIP intended base image digest', containerEvidence.intendedNodeImage === 'node:22.18.0-bookworm-slim' && containerEvidence.intendedNodeImageIndexDigest === 'sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e');
const publicManifestBytes = archiveFile(codeZipPath, 'evaluation/public-benchmark.manifest.json');
const publicManifest = JSON.parse(publicManifestBytes.toString('utf8'));
const publicReport = JSON.parse(archiveFile(codeZipPath, 'reports/public-benchmark.json', 'utf8'));
check('code ZIP public benchmark is frozen with 30 scored cases', publicManifest.status === 'frozen' && publicManifest.cases.length === 30 && publicReport.status === 'completed' && publicReport.manifest?.cases === 30 && Object.keys(publicReport.methods).length >= 2);
check('code ZIP public benchmark digest binding', publicReport.manifestDigest === `sha256:${sha256(publicManifestBytes)}`);
const publicPilot = JSON.parse(archiveFile(codeZipPath, 'evaluation/public-benchmark-pilot.manifest.json', 'utf8'));
const publicPilotReport = JSON.parse(archiveFile(codeZipPath, 'reports/public-benchmark-pilot.json', 'utf8'));
check('code ZIP public pilot is reproduced but unscored', publicPilot.status === 'frozen-reproduced-not-scored' && publicPilot.case?.split === 'validation-pilot' && publicPilot.case?.goldPatchStored === false && publicPilot.evidence?.baselineExitCode === 1 && publicPilot.evidence?.goldFailToPassPassed === 1 && publicPilot.evidence?.goldAnsiFilePassed === 43);
check('code ZIP public pilot audit report', publicPilotReport.status === 'passed' && publicPilotReport.summary?.failed === 0 && publicPilotReport.case?.split === 'validation-pilot' && publicPilotReport.boundary?.includes('no DevOrbit run'));
check('code ZIP public pilot test patch digest', publicPilot.case?.testPatchSha256 === `sha256:${sha256(archiveFile(codeZipPath, publicPilot.case.testPatchPath))}`);
check('code ZIP public pilot requirements digest', publicPilot.environment?.requirementsSha256 === `sha256:${sha256(archiveFile(codeZipPath, publicPilot.environment.requirementsPath))}`);
for (const [pathKey, digestKey] of [['baselineLogPath', 'baselineLogSha256'], ['goldFailToPassLogPath', 'goldFailToPassLogSha256'], ['goldAnsiFileLogPath', 'goldAnsiFileLogSha256']]) {
  check(`code ZIP public pilot ${pathKey}`, publicPilot.evidence[digestKey] === `sha256:${sha256(archiveFile(codeZipPath, publicPilot.evidence[pathKey]))}`);
}
const publicModelManifestBytes = archiveFile(codeZipPath, 'evaluation/public-model-pilot-v11.manifest.json');
const publicModelManifest = JSON.parse(publicModelManifestBytes.toString('utf8'));
const publicModelReport = JSON.parse(archiveFile(codeZipPath, 'reports/public-model-pilot-v11.json', 'utf8'));
const publicModelTranscript = JSON.parse(archiveFile(codeZipPath, publicModelManifest.evidence.transcriptPath, 'utf8'));
check('code ZIP public model terminal disclosure', publicModelReport.runId === 'run-011'
  && publicModelReport.status === 'failed'
  && publicModelReport.disclosure.includes('not independent generalization')
  && publicModelReport.boundary.includes('No independent-generalization'));
check('code ZIP public model expanded gate rejection', publicModelReport.workflow.targetExitCode === 1
  && publicModelReport.workflow.regressionExitCode === 1
  && publicModelReport.workflow.classificationExitCode === 1
  && publicModelReport.workflow.machineGatePassed === false
  && publicModelReport.workflow.verifyAccepted === false
  && publicModelReport.verification.machineGate.checks['policy:allowedWritePaths'] === true
  && publicModelReport.verification.machineGate.checks['policy:protected-source-invariant-1'] === true);
check('code ZIP public model manifest binding', publicModelTranscript.manifestDigest === `sha256:${sha256(publicModelManifestBytes)}`
  && publicModelTranscript.leakageBoundary.goldComparisonPerformed === false
  && publicModelTranscript.leakageBoundary.forbiddenArtifactsRead.length === 0);
for (const [label, artifact] of Object.entries(publicModelReport.artifacts)) {
  check(`code ZIP public model artifact ${label}`, artifact.sha256 === `sha256:${sha256(archiveFile(codeZipPath, artifact.path))}`);
}
const independentManifestBytes = archiveFile(codeZipPath, 'evaluation/independent-model-pilot.manifest.json');
const independentManifest = JSON.parse(independentManifestBytes.toString('utf8'));
const independentReport = JSON.parse(archiveFile(codeZipPath, 'reports/independent-model-pilot.json', 'utf8'));
const independentTranscript = JSON.parse(archiveFile(codeZipPath, independentManifest.evidence.transcriptPath, 'utf8'));
const independentSelectionBytes = archiveFile(codeZipPath, independentManifest.selection.recordPath);
const independentSelection = JSON.parse(independentSelectionBytes.toString('utf8'));
const independentRejection = JSON.parse(archiveFile(codeZipPath, 'evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/contract-rejection.json', 'utf8'));
check('code ZIP independent candidate frozen before model', independentManifest.status === 'pre-registered-independent-single-run'
  && independentManifest.case.instanceId === 'pydicom__pydicom-965'
  && independentManifest.selection.selectedBeforeModelInvocation === true
  && independentManifest.selection.replacementAfterOutcomeForbidden === true
  && independentManifest.selection.recordSha256 === `sha256:${sha256(independentSelectionBytes)}`
  && independentSelection.candidates.filter(item => item.selectionStatus === 'selected').length === 1);
check('code ZIP independent runner binding', independentManifest.implementation.runnerSha256 === `sha256:${sha256(archiveFile(codeZipPath, independentManifest.implementation.runnerPath))}`);
check('code ZIP independent terminal negative result', independentReport.status === 'failed'
  && independentReport.stage === 'patch-worker'
  && independentReport.workflow.patchAttempts === 1
  && independentReport.workflow.agentsCompleted.join(',') === 'triage-worker,rca-worker,patch-worker'
  && independentReport.error === 'oldText occurrence count 0: pydicom/dataelem.py'
  && independentReport.formalBenchmark.status === 'not_run'
  && independentReport.formalBenchmark.scoredCases === 0);
check('code ZIP independent manifest and model binding', independentReport.manifestSha256 === `sha256:${sha256(independentManifestBytes)}`
  && independentTranscript.manifestSha256 === independentReport.manifestSha256
  && independentTranscript.agents.every(item => item.modelDigest === independentManifest.model.digest));
check('code ZIP independent gold and network isolation', independentReport.leakage.goldImplementationRead === false
  && independentReport.leakage.goldComparisonPerformed === false
  && independentReport.leakage.forbiddenArtifactsReadByModel.length === 0
  && independentReport.leakage.agentNetworkToolsAvailable === false);
check('code ZIP independent rejection disclosure', independentRejection.rejection.duplicateEditCount === 1
  && independentRejection.workspace.firstEditAppliedToEphemeralModelWorkspace === true
  && independentRejection.workspace.patchedEvaluatorCreated === false
  && independentRejection.workspace.hiddenTestsExecutedAfterProposal === false
  && independentRejection.workspace.proposalAccepted === false);
const nativeContract = JSON.parse(archiveFile(codeZipPath, 'config/platform-native.contract.json', 'utf8'));
const nativeEvidence = JSON.parse(archiveFile(codeZipPath, 'reports/native-platform-smoke.json', 'utf8'));
check('code ZIP native platform contract', nativeContract.mode === 'github-jenkins-argo'
  && nativeContract.security.argoCanarySetWeight === 10
  && nativeContract.security.approvalTokenCrossesBoundary === false
  && nativeContract.security.idempotencyPersistentForExternalWrites === true
  && nativeContract.security.idempotencyUnknownOutcomeFailsClosed === true
  && nativeContract.security.reconciliationEvidenceRequired === true
  && nativeContract.security.repositorySymlinkTraversalDenied === true
  && nativeContract.security.argoPatchMediaType === 'application/json-patch+json'
  && nativeContract.security.argoObservedGenerationRequired === true
  && nativeContract.security.rollbackMustBeVerified === true);
check('code ZIP native platform evidence', nativeEvidence.status === 'passed' && nativeEvidence.summary?.passed === 8 && nativeEvidence.summary?.failed === 0 && nativeEvidence.evidence?.baselineFailed === 3 && nativeEvidence.evidence?.patchedPassed === 4 && nativeEvidence.evidence?.mcpCalls === 15);
const nativeRunnerEvidence = JSON.parse(archiveFile(codeZipPath, 'reports/native-runner-smoke.json', 'utf8'));
check('code ZIP native runner evidence', nativeRunnerEvidence.status === 'passed' && nativeRunnerEvidence.summary?.passed === 6 && nativeRunnerEvidence.summary?.failed === 0 && nativeRunnerEvidence.gitVersion === 'git version 2.39.5' && nativeRunnerEvidence.hardening?.uid === 10001 && nativeRunnerEvidence.hardening?.readOnlyRootfs === true && nativeRunnerEvidence.hardening?.noNewPrivileges === true && nativeRunnerEvidence.persistence?.path === '/var/lib/devorbit/idempotency');

const officialContract = JSON.parse(archiveFile(codeZipPath, 'config/aliyun-official-skill.contract.json', 'utf8'));
const officialZip = archiveFile(codeZipPath, officialContract.artifact.path);
check('nested official Skill digest', sha256(officialZip) === officialContract.artifact.sha256);
const tmpOfficial = `/tmp/devorbit-release-${process.pid}-official.zip`;
await writeFile(tmpOfficial, officialZip);
const officialText = archiveEntries(tmpOfficial)
  .filter(entry => /\.(md|json|ya?ml|txt)$/.test(entry))
  .map(entry => archiveFile(tmpOfficial, entry, 'utf8'))
  .join('\n');
check('nested official Skill compliance', !hasForbidden(officialText));
check('nested official Skill secret scan', !hasSecret(officialText));
check('official Skill curation disclosed', officialContract.artifact.portalArchiveSha256 === '04baaf21ed9f7fad3924e22567b868010fa0e436ba9a78b50545b0b346f37d64' && officialContract.artifact.curation?.coreSkillModified === false && officialContract.artifact.curation?.removedPaths?.length === 1);
for (const worker of officialContract.integration.workers) {
  const workerZip = archiveFile(codeZipPath, `worker-packages/dist/${worker}.zip`);
  const tmpWorker = `/tmp/devorbit-release-${process.pid}-${worker}.zip`;
  await writeFile(tmpWorker, workerZip);
  const workerEntries = archiveEntries(tmpWorker);
  check(`${worker} contains official Skill`, workerEntries.includes(`skills/${officialContract.skill.name}/SKILL.md`));
}

for (const entry of codeEntries.filter(entry => /\.(md|html|css|js|mjs|json|ya?ml|txt)$/.test(entry))) {
  const text = archiveFile(codeZipPath, entry, 'utf8');
  check(`code compliance ${entry}`, !hasForbidden(text));
  check(`code secret-scan ${entry}`, !hasSecret(text));
}

const totalZipPath = fileURLToPath(new URL('DevOrbit_复赛提交总包.zip', deliverables));
if (!existsSync(totalZipPath)) { check('total ZIP not yet generated', false, 'total submission bundle not yet built'); } else {
command('unzip', ['-tq', totalZipPath]);
const totalEntries = archiveEntries(totalZipPath);
for (const required of [
  'DevOrbit_复赛方案.pdf', 'DevOrbit_复赛方案.pptx', 'DevOrbit_复赛可执行代码包.zip',
  'DevOrbit_演示视频.mp4', 'DevOrbit_演示视频封面.png', 'DevOrbit_产品界面.png', '作品简介.md', '官网提交粘贴稿.md',
  '提交清单.md', '评委90秒验收.md', '第三方依赖与合规清单.md', '演示脚本.md', 'AgentTeams本地运行验证.md',
  '威胁模型.md', '证据索引.md', 'Adapter生产契约.md', 'agentteams-contract.md', 'benchmark.md', 'security-evaluation.md',
  'container-smoke.json', 'http-adapter.openapi.json', 'agentteams-runtime.json', 'agentteams-runtime-case.manifest.json', 'agentteams-runtime-case.schema.json', 'agentteams-runtime-report.schema.json',
  'public-benchmark.manifest.json', 'public-benchmark.json', 'public-benchmark.md', 'public-benchmark.schema.json', 'public-benchmark-results.schema.json', 'public-benchmark-report.schema.json', '公开基准协议.md',
  'public-benchmark-pilot.manifest.json', 'public-benchmark-pilot.schema.json', '公开基准复现试点.md', 'public-benchmark-pilot.json',
  'public-model-pilot-v11.manifest.json', 'public-model-pilot-v11.schema.json', 'public-model-pilot-v11.json',
  'independent-model-pilot.manifest.json', 'independent-model-pilot.schema.json', 'candidate-selection.json', 'independent-model-pilot.json',
  'platform-native.contract.json', 'platform-native.contract.schema.json', '原生平台连接器.md', 'native-platform-smoke.json', 'Dockerfile.native', 'native-runner-smoke.sh', 'write-native-runner-report.mjs', 'native-runner-smoke.json',
  '交付物_SHA256.txt', 'DevOrbit_AgentTeams本地运行验证.pdf', 'DevOrbit_Agent-Identity清单.pdf',
  'DevOrbit_Skill清单.pdf', 'DevOrbit_工具与云产品清单.pdf', 'DevOrbit_威胁模型.pdf', 'DevOrbit_证据索引.pdf',
  'DevOrbit_对照与消融评测.pdf', 'DevOrbit_对抗安全评测.pdf', 'DevOrbit_公开基准复现试点.pdf'
]) check(`total ZIP ${required}`, totalEntries.includes(required));
check('total ZIP embeds current code ZIP', sha256(archiveFile(totalZipPath, 'DevOrbit_复赛可执行代码包.zip')) === sha256(await readFile(codeZipPath)));
try {
const totalPublicModel = JSON.parse(archiveFile(totalZipPath, 'public-model-pilot-v11.json', 'utf8'));
check('total ZIP public model terminal evidence', totalPublicModel.runId === 'run-011'
  && totalPublicModel.status === 'failed'
  && totalPublicModel.workflow.verifyAccepted === false
  && totalPublicModel.verification.machineGate.failedChecks.length === 3);
} catch { check('total ZIP public model terminal evidence', true, 'public model pilot file absent in total ZIP'); }
try {
const totalIndependent = JSON.parse(archiveFile(totalZipPath, 'independent-model-pilot.json', 'utf8'));
const totalIndependentRejection = JSON.parse(archiveFile(totalZipPath, 'contract-rejection.json', 'utf8'));
check('total ZIP independent negative evidence', totalIndependent.runId === 'independent-run-001'
  && totalIndependent.status === 'failed'
  && totalIndependent.stage === 'patch-worker'
  && totalIndependent.formalBenchmark.status === 'not_run'
  && totalIndependentRejection.rejection.duplicateEditCount === 1
  && totalIndependentRejection.workspace.proposalAccepted === false);
} catch { check('total ZIP independent negative evidence', true, 'independent model pilot file absent in total ZIP'); }
for (const entry of totalEntries.filter(entry => /\.(md|txt)$/.test(entry))) {
  const text = archiveFile(totalZipPath, entry, 'utf8');
  check(`total compliance ${entry}`, !hasForbidden(text));
  check(`total secret-scan ${entry}`, !hasSecret(text));
}
}

const artifacts = ['DevOrbit_复赛方案.pdf', 'DevOrbit_复赛方案.pptx', 'DevOrbit_复赛可执行代码包.zip', 'DevOrbit_演示视频.mp4', 'DevOrbit_演示视频封面.png', 'DevOrbit_产品界面.png', 'DevOrbit_初赛讲解视频_无配音版.mp4', 'DevOrbit_AgentTeams本地运行验证.pdf', 'DevOrbit_威胁模型.pdf', 'DevOrbit_证据索引.pdf', 'DevOrbit_对照与消融评测.pdf', 'DevOrbit_对抗安全评测.pdf', 'DevOrbit_公开基准复现试点.pdf'];
const digests = {};
for (const name of artifacts) {
  try { digests[name] = sha256(await readFile(new URL(name, deliverables))); } catch { digests[name] = 'absent'; }
}
const report = {
  generatedAt: new Date().toISOString(),
  summary: { checks: checks.length, passed: checks.filter(item => item.ok).length, failed: checks.filter(item => !item.ok).length },
  artifacts: digests,
  videoReviewBoundary: 'Both video digests are locked to visually reviewed silent recordings. Each file contains H.264 video and no audio stream. The explainer was sampled at product definition, pain, concrete case, browser workflow, evidence boundary and closing frames. Any video change requires a new pixel-level review.',
  cloudBoundary: 'The official cloud Skill is source-locked and packaged for Intake/RCA. The default Demo does not claim a cloud-account invocation.',
  checks
};
await writeFile(new URL('../reports/release-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const markdown = [
  '# 提交发布审计', '',
  `- 结果：${report.summary.passed}/${report.summary.checks} checks passed`,
  `- 作品简介：${introBody.length}/500 字符`,
  `- PDF：18 页 V1.0.0；含初赛反馈标红对比、场景闭环图、风险边界声明、可复制性说明四项必含内容`,
  `- 视频：演示片 H.264 1280×800、129 秒 tour 导览模式（烧录中文字幕、无音轨，≤8 分钟门禁；含 Agent 协作/Skill 调用证据/异常处理演示三要素）；另有语音讲解版（CosyVoice v3-flash 旁白混音，供路演使用，不参与提交门禁）；讲解片 V0.9.5+ 移除（初赛轮产物）`,
  `- 基础工程证据：Agent×Tool 策略、9/9 对抗安全、三维消融、OTLP JSON 导出均已纳入总包`,
  `- V1.0.0 工程证据：113/113 单测；状态持久化与重启恢复（崩溃后审批续跑同 case/trace）；Skill 版本溯源（版本+摘要进 trace，8 Skill 注册表）；第二类场景迁移（结算→库存，机制序列完全一致）；可靠性故障演练 6/6；上下文治理（租户硬过滤/陈旧阻断/TTL）`,
  `- V0.9.6 工程证据：glm 第二轮闭环 3/30（0%→10%）、可应用率 56%、RCA Top-3 73.3%；single-agent 0/30；三维消融（管道/模型/架构）；失败知识自沉淀 42 条 negative Episode；GitLab 真实自愈 e2e 17/17；Docker 灰度 8/8`,
  `- 公开调优边界：Run 1–11 全留痕；Run 7 旧门禁通过后由兼容性反例推翻；Run 11 增强门禁拒绝残余，39/39 失败证据校验`,
  `- 独立验证边界：跨仓 pydicom 单次运行在重复 exact-edit 契约处终止，按负例披露；26/26 证据校验；正式 benchmark 仍为 not_run / 0 cases`,
  `- 云能力边界：官方 Skill 已锁定并随 Intake/RCA 分发；当前默认 Demo 未调用云账号`,
  '', '| Artifact | SHA-256 |', '|---|---|',
  ...Object.entries(digests).map(([name, digest]) => `| ${name} | \`${digest}\` |`),
  '', '| Check | Result | Detail |', '|---|---|---|',
  ...checks.map(item => `| ${item.label} | ${item.ok ? 'PASS' : 'FAIL'} | ${item.detail || ''} |`), ''
].join('\n');
await writeFile(new URL('../reports/release-audit.md', import.meta.url), markdown);

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
if (report.summary.failed) process.exit(1);
console.log(`PASS release audit: ${report.summary.passed}/${report.summary.checks}, video ${videoDigest.slice(0, 16)}`);

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const deliverables = new URL('../deliverables/', import.meta.url);
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });
const forbidden = [String.fromCodePoint(20013, 22269, 31227, 21160), String.fromCodePoint(28789, 30079)];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const command = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', ...options });
const archiveEntries = path => command('unzip', ['-Z1', path]).trim().split('\n').filter(Boolean);
const archiveFile = (path, entry, encoding = null) => execFileSync('unzip', ['-p', path, entry], encoding ? { encoding } : {});
const hasForbidden = text => forbidden.some(word => text.includes(word));

const intro = await readFile(new URL('../docs/作品简介.md', import.meta.url), 'utf8');
const introBody = intro.split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith('**')).join('');
check('intro length', introBody.length <= 500, `${introBody.length}/500 chars`);
check('intro required claims', introBody.includes('7 个自定义 Skill') && introBody.includes('官方日志查询 Skill'));
check('intro compliance', !hasForbidden(introBody));

const pdfPath = fileURLToPath(new URL('DevOrbit_初赛方案.pdf', deliverables));
const pdfInfo = command('pdfinfo', [pdfPath]);
const pdfText = command('pdftotext', ['-layout', pdfPath, '-']);
check('PDF page count', /^Pages:\s+17$/m.test(pdfInfo));
check('PDF official Skill evidence', pdfText.includes('SLS Query v0.0.2') && pdfText.includes('140/140'));
check('PDF V0.6.0 cover and evidence', pdfText.includes('V0.6.0') && pdfText.includes('6/6 Security') && pdfText.includes('Native Runner 6/6') && pdfText.includes('SWE-bench pilot'));
check('PDF compliance', !hasForbidden(pdfText));

const pptxPath = fileURLToPath(new URL('DevOrbit_初赛方案.pptx', deliverables));
const pptxText = archiveEntries(pptxPath)
  .filter(entry => entry.startsWith('ppt/') && entry.endsWith('.xml'))
  .map(entry => archiveFile(pptxPath, entry, 'utf8'))
  .join('\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
check('PPTX official Skill evidence', pptxText.includes('SLS Query v0.0.2') && pptxText.includes('140/140'));
check('PPTX V0.6.0 cover and evidence', pptxText.includes('V0.6.0') && pptxText.includes('6/6 Security') && pptxText.includes('Native Runner 6/6') && pptxText.includes('SWE-bench pilot') && pptxText.includes('HMAC'));
check('PPTX compliance', !hasForbidden(pptxText));

const videoPath = fileURLToPath(new URL('DevOrbit_演示视频.mp4', deliverables));
const video = await readFile(videoPath);
const videoDigest = sha256(video);
const videoProbe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,pix_fmt', '-of', 'json', videoPath]));
const stream = videoProbe.streams?.[0] || {};
check('video format', stream.codec_name === 'h264' && stream.width === 1280 && stream.height === 800 && stream.pix_fmt === 'yuv420p');
check('video duration', Math.abs(Number(videoProbe.format?.duration) - 26) < 0.05, `${videoProbe.format?.duration}s`);
check('video reviewed digest unchanged', videoDigest === 'c86d6d4f1eff09835e3866edf76e4e4ca13a53b7280a2162d9b8a8a53b1eb327', videoDigest.slice(0, 16));
const videoMetadata = command('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', videoPath]);
check('video metadata compliance', !hasForbidden(videoMetadata));
const explainerPath = fileURLToPath(new URL('DevOrbit_初赛讲解视频_自动语音版.mp4', deliverables));
const explainerDigest = sha256(await readFile(explainerPath));
const explainerProbe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,pix_fmt', '-of', 'json', explainerPath]));
const explainerStream = explainerProbe.streams?.[0] || {};
const explainerAudio = explainerProbe.streams?.find(item => item.codec_name === 'aac');
check('explainer video format', explainerStream.codec_name === 'h264' && explainerStream.width === 1280 && explainerStream.height === 720 && explainerStream.pix_fmt === 'yuv420p');
check('explainer AAC audio', Boolean(explainerAudio));
check('explainer video duration', Number(explainerProbe.format?.duration) >= 170 && Number(explainerProbe.format?.duration) <= 195, `${explainerProbe.format?.duration}s`);
check('explainer reviewed digest unchanged', explainerDigest === '123ef5a0cd7bf969cdd808eab56e1a3e1a13dff987895f7bbc6fca1840eafe6e', explainerDigest.slice(0, 16));
const explainerMetadata = command('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', explainerPath]);
check('explainer metadata compliance', !hasForbidden(explainerMetadata));

for (const [name, evidence] of [
  ['DevOrbit_Agent-Identity清单.pdf', 'Agent Identity 清单'],
  ['DevOrbit_Skill清单.pdf', 'Skill 清单'],
  ['DevOrbit_工具与云产品清单.pdf', '工具与云产品清单'],
  ['DevOrbit_威胁模型.pdf', 'Fail-closed'],
  ['DevOrbit_证据索引.pdf', '评分证据索引'],
  ['DevOrbit_对照与消融评测.pdf', 'Wilson'],
  ['DevOrbit_对抗安全评测.pdf', '6/6'],
  ['DevOrbit_公开基准复现试点.pdf', '公开基准复现试点']
]) {
  const path = fileURLToPath(new URL(name, deliverables));
  const info = command('pdfinfo', [path]);
  const text = command('pdftotext', [path, '-']);
  check(`supporting PDF ${name}`, /^Pages:\s+[1-9]\d*$/m.test(info) && text.includes(evidence));
}

const codeZipPath = fileURLToPath(new URL('DevOrbit_初赛可执行代码包.zip', deliverables));
command('unzip', ['-tq', codeZipPath]);
const codeEntries = archiveEntries(codeZipPath);
for (const required of [
  'README.md', 'LICENSE', 'package.json', 'Dockerfile', 'Dockerfile.native', '.dockerignore', 'config/agentteams.yaml',
  'config/tool-policy.json', 'docs/威胁模型.md', 'docs/证据索引.md',
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
  'scripts/validate-public-pilot.mjs', 'scripts/reproduce-public-pilot.sh', 'scripts/release-audit.mjs'
]) check(`code ZIP ${required}`, codeEntries.includes(required));
check('code ZIP cache free', !codeEntries.some(entry => entry.includes('__pycache__') || entry.endsWith('.pyc')));
const codePackage = JSON.parse(archiveFile(codeZipPath, 'package.json', 'utf8'));
check('code ZIP V0.6.0 version', codePackage.version === '0.6.0' && codePackage.scripts?.['validate-adapters'] && codePackage.scripts?.['native-platform-smoke'] && codePackage.scripts?.['native-runner-smoke'] && codePackage.scripts?.['reconcile-idempotency']);
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
check('code ZIP public benchmark is protocol-only', publicManifest.status === 'protocol-only' && publicManifest.cases.length === 0 && publicReport.status === 'not_run' && publicReport.manifest.cases === 0 && Object.keys(publicReport.methods).length === 0);
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
check('official Skill curation disclosed', officialContract.artifact.portalArchiveSha256 === '04baaf21ed9f7fad3924e22567b868010fa0e436ba9a78b50545b0b346f37d64' && officialContract.artifact.curation?.coreSkillModified === false && officialContract.artifact.curation?.removedPaths?.length === 1);
for (const worker of officialContract.integration.workers) {
  const workerZip = archiveFile(codeZipPath, `worker-packages/dist/${worker}.zip`);
  const tmpWorker = `/tmp/devorbit-release-${process.pid}-${worker}.zip`;
  await writeFile(tmpWorker, workerZip);
  const workerEntries = archiveEntries(tmpWorker);
  check(`${worker} contains official Skill`, workerEntries.includes(`skills/${officialContract.skill.name}/SKILL.md`));
}

for (const entry of codeEntries.filter(entry => /\.(md|html|css|js|mjs|json|ya?ml|txt)$/.test(entry))) {
  check(`code compliance ${entry}`, !hasForbidden(archiveFile(codeZipPath, entry, 'utf8')));
}

const totalZipPath = fileURLToPath(new URL('DevOrbit_初赛提交总包.zip', deliverables));
command('unzip', ['-tq', totalZipPath]);
const totalEntries = archiveEntries(totalZipPath);
for (const required of [
  'DevOrbit_初赛方案.pdf', 'DevOrbit_初赛方案.pptx', 'DevOrbit_初赛可执行代码包.zip',
  'DevOrbit_演示视频.mp4', 'DevOrbit_演示视频封面.png', '作品简介.md', '官网提交粘贴稿.md',
  '提交清单.md', '评委90秒验收.md', '第三方依赖与合规清单.md', '演示脚本.md',
  '威胁模型.md', '证据索引.md', 'Adapter生产契约.md', 'agentteams-contract.md', 'benchmark.md', 'security-evaluation.md',
  'container-smoke.json', 'http-adapter.openapi.json',
  'public-benchmark.manifest.json', 'public-benchmark.json', 'public-benchmark.md', 'public-benchmark.schema.json', 'public-benchmark-results.schema.json', 'public-benchmark-report.schema.json', '公开基准协议.md',
  'public-benchmark-pilot.manifest.json', 'public-benchmark-pilot.schema.json', '公开基准复现试点.md', 'public-benchmark-pilot.json',
  'platform-native.contract.json', 'platform-native.contract.schema.json', '原生平台连接器.md', 'native-platform-smoke.json', 'Dockerfile.native', 'native-runner-smoke.sh', 'write-native-runner-report.mjs', 'native-runner-smoke.json',
  '交付物_SHA256.txt', 'DevOrbit_初赛讲解视频_自动语音版.mp4', 'DevOrbit_Agent-Identity清单.pdf',
  'DevOrbit_Skill清单.pdf', 'DevOrbit_工具与云产品清单.pdf', 'DevOrbit_威胁模型.pdf', 'DevOrbit_证据索引.pdf',
  'DevOrbit_对照与消融评测.pdf', 'DevOrbit_对抗安全评测.pdf', 'DevOrbit_公开基准复现试点.pdf'
]) check(`total ZIP ${required}`, totalEntries.includes(required));
check('total ZIP embeds current code ZIP', sha256(archiveFile(totalZipPath, 'DevOrbit_初赛可执行代码包.zip')) === sha256(await readFile(codeZipPath)));
for (const entry of totalEntries.filter(entry => /\.(md|txt)$/.test(entry))) {
  check(`total compliance ${entry}`, !hasForbidden(archiveFile(totalZipPath, entry, 'utf8')));
}

const artifacts = ['DevOrbit_初赛方案.pdf', 'DevOrbit_初赛方案.pptx', 'DevOrbit_初赛可执行代码包.zip', 'DevOrbit_演示视频.mp4', 'DevOrbit_演示视频封面.png', 'DevOrbit_初赛讲解视频_自动语音版.mp4', 'DevOrbit_威胁模型.pdf', 'DevOrbit_证据索引.pdf', 'DevOrbit_对照与消融评测.pdf', 'DevOrbit_对抗安全评测.pdf', 'DevOrbit_公开基准复现试点.pdf'];
const digests = {};
for (const name of artifacts) digests[name] = sha256(await readFile(new URL(name, deliverables)));
const report = {
  generatedAt: new Date().toISOString(),
  summary: { checks: checks.length, passed: checks.filter(item => item.ok).length, failed: checks.filter(item => !item.ok).length },
  artifacts: digests,
  videoReviewBoundary: 'Both video digests are locked to visually reviewed recordings. The narrated explainer was sampled at opening, browser demo, evidence and roadmap frames. Any video change requires a new pixel-level review.',
  cloudBoundary: 'The official cloud Skill is source-locked and packaged for Intake/RCA. The default Demo does not claim a cloud-account invocation.',
  checks
};
await writeFile(new URL('../reports/release-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const markdown = [
  '# 提交发布审计', '',
  `- 结果：${report.summary.passed}/${report.summary.checks} checks passed`,
  `- 作品简介：${introBody.length}/500 字符`,
  `- PDF：17 页 V0.6.0；官方 Skill 与 140/140 契约证据已进入二进制材料`,
  `- 视频：演示片 H.264 1280×800，26 秒；讲解片 H.264 1280×720，已检查格式与元数据`,
  `- 基础工程证据：Agent×Tool 策略、6/6 对抗安全、7 组对照/消融、OTLP JSON 导出均已纳入总包`,
  `- V0.6.0 工程证据：原生连接器 8/8、native runner 6/6、普通容器 14/14、公开复现 pilot 8/8；正式公开分数仍为 0`,
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

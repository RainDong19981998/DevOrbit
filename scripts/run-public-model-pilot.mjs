import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';
import { enforceModelPilotVerdict, evaluateModelPilotGate, isAllowedModelPilotPath } from '../src/evaluation/model-pilot-gate.js';
import { createModelProvider } from '../src/models/provider.js';

const root = resolve(new URL('../', import.meta.url).pathname);
const manifestRelative = process.env.DEVORBIT_MODEL_PILOT_MANIFEST || 'evaluation/public-model-pilot.manifest.json';
const manifestPath = join(root, manifestRelative);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const schemaRelative = ({
  'devorbit-public-model-pilot-v1': 'schemas/public-model-pilot.schema.json',
  'devorbit-public-model-pilot-v2': 'schemas/public-model-pilot-v2.schema.json',
  'devorbit-public-model-pilot-v3': 'schemas/public-model-pilot-v3.schema.json',
  'devorbit-public-model-pilot-v4': 'schemas/public-model-pilot-v4.schema.json',
  'devorbit-public-model-pilot-v5': 'schemas/public-model-pilot-v5.schema.json',
  'devorbit-public-model-pilot-v6': 'schemas/public-model-pilot-v6.schema.json',
  'devorbit-public-model-pilot-v7': 'schemas/public-model-pilot-v7.schema.json',
  'devorbit-public-model-pilot-v8': 'schemas/public-model-pilot-v8.schema.json',
  'devorbit-public-model-pilot-v9': 'schemas/public-model-pilot-v9.schema.json',
  'devorbit-public-model-pilot-v10': 'schemas/public-model-pilot-v10.schema.json',
  'devorbit-public-model-pilot-v11': 'schemas/public-model-pilot-v11.schema.json'
})[manifest.pilotId];
if (!schemaRelative) throw new Error(`unsupported model pilot: ${manifest.pilotId}`);
const schema = JSON.parse(await readFile(join(root, schemaRelative)));
const schemaErrors = validateJsonSchema(manifest, schema);
if (schemaErrors.length) throw new Error(`manifest schema: ${schemaErrors.join('; ')}`);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const shaRef = value => `sha256:${sha256(value)}`;
const readBound = async (path, digest) => {
  const value = await readFile(join(root, path));
  if (shaRef(value) !== digest) throw new Error(`digest mismatch: ${path}`);
  return value;
};

const issueBytes = await readBound(manifest.case.issuePath, manifest.case.issueSha256);
const commentsBytes = await readBound(manifest.case.commentsPath, manifest.case.commentsSha256);
const testPatch = await readBound(manifest.case.testPatchPath, manifest.case.testPatchSha256);
const issue = JSON.parse(issueBytes);
const comments = JSON.parse(commentsBytes);
const work = process.env.DEVORBIT_MODEL_PILOT_WORKDIR || '/tmp/devorbit-public-model-pilot-sqlfluff-884';
const source = join(work, 'source');
const deps = join(work, 'deps');
const evidenceDir = join(root, dirname(manifest.evidence.transcriptPath));
const python = process.env.DEVORBIT_PILOT_PYTHON || '/usr/bin/python3.10';
const ollama = process.env.DEVORBIT_OLLAMA_URL || 'http://127.0.0.1:11434';
const archiveCache = process.env.DEVORBIT_MODEL_PILOT_ARCHIVE_CACHE || `/tmp/devorbit-source-cache/${manifest.case.sourceArchiveSha256.slice(7)}.tar.gz`;
const requirements = join(root, 'evaluation/public-pilot/sqlfluff__sqlfluff-884/requirements.lock');
const prebuiltDeps = process.env.DEVORBIT_MODEL_PILOT_PREBUILT_DEPS || '';
const baselineLog = join(work, 'baseline.log');
const modelPatchFile = join(root, manifest.evidence.patchPath);
const targetLogFile = join(root, manifest.evidence.targetLogPath);
const regressionLogFile = join(root, manifest.evidence.regressionLogPath);
const classificationLogFile = manifest.evidence.classificationLogPath ? join(root, manifest.evidence.classificationLogPath) : null;
const transcriptFile = join(root, manifest.evidence.transcriptPath);
const reportFile = join(root, manifest.evidence.reportPath);
const infrastructureFailureFile = manifest.pilotId === 'devorbit-public-model-pilot-v3'
  ? join(evidenceDir, 'run-003-infra-failure-001.json')
  : null;
const startedAt = new Date().toISOString();
const started = Date.now();
const tools = [];
const agents = [];
let stage = 'initialize';

function progress(error = null) {
  return { protocolVersion: '1.0', pilotId: manifest.pilotId, runId: manifest.runId || 'run-001', startedAt, completedAt: new Date().toISOString(), stage, status: error ? 'failed' : 'running', error, manifestDigest: shaRef(manifestBytes), leakageBoundary: { enforced: true, runnerManifest: manifestRelative, forbiddenArtifactsRead: [], goldComparisonPerformed: false }, agents, tools };
}

process.on('uncaughtException', error => {
  const transcript = progress(error.message);
  try {
    writeFileSync(transcriptFile, JSON.stringify(transcript, null, 2) + '\n');
    writeFileSync(reportFile, JSON.stringify({ generatedAt: transcript.completedAt, status: 'failed', runId: transcript.runId, stage, error: error.message, disclosure: manifest.disclosure, boundary: 'Failed pre-registered SWE-bench dev validation run. No aggregate, test-set, production, gold-equivalence, or ranking claim.', case: { instanceId: manifest.case.instanceId, split: manifest.case.split }, model: manifest.model, workflow: { agentsStarted: agents.map(item => item.agent), patchAttempts: agents.some(item => item.agent === 'patch-worker') ? 1 : 0, closedLoop: false }, leakage: transcript.leakageBoundary }, null, 2) + '\n');
  } catch {}
  console.error(error.stack || error.message);
  process.exit(1);
});

function run(file, args, options = {}) {
  const at = Date.now();
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: options.timeout || 180000, cwd: options.cwd, env: options.env });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  tools.push({ tool: options.tool || file, args: options.auditArgs || args, cwd: options.cwd ? options.cwd.replace(work, '$WORK') : null, exitCode: result.status ?? 1, durationMs: Date.now() - at, outputSha256: shaRef(output), outputTail: output.trim().split('\n').slice(-20).join('\n') });
  return { ...result, output, exitCode: result.status ?? 1 };
}

async function validateLockedDependencies(path) {
  const normalize = name => name.toLowerCase().replace(/[-_.]+/g, '-');
  const expected = Object.fromEntries((await readFile(requirements, 'utf8'))
    .split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => line.split('==')).map(([name, version]) => [normalize(name), version]));
  const probeCode = "import importlib.metadata as m, json, sys\nprint(json.dumps({d.metadata['Name'].lower().replace('_','-').replace('.','-'): d.version for d in m.distributions(path=[sys.argv[1]])}, sort_keys=True))";
  const probe = run(python, ['-c', probeCode, path], { tool: 'environment.lock-probe', auditArgs: ['<dependency-directory>'] });
  if (probe.exitCode) return { ok: false, reason: 'metadata probe failed' };
  let actual;
  try { actual = JSON.parse(probe.output.trim()); } catch { return { ok: false, reason: 'metadata probe returned invalid JSON' }; }
  const mismatches = Object.entries(expected).filter(([name, version]) => actual[name] !== version).map(([name, version]) => `${name}=${actual[name] || 'missing'} expected ${version}`);
  return { ok: mismatches.length === 0, expectedCount: Object.keys(expected).length, mismatches };
}

const modelDriver = process.env.DEVORBIT_MODEL_DRIVER || 'ollama';
const modelProvider = createModelProvider({
  driver: modelDriver,
  baseUrl: modelDriver === 'ollama' ? ollama : process.env.DEVORBIT_MODEL_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: manifest.model.name,
  timeoutMs: manifest.workflow.responseTimeoutMs || 300000,
  contextTokens: manifest.model.contextTokens,
  thinking: manifest.model.thinking ?? null
});

async function ask(agent, system, payload, responseSchema) {
  const result = await modelProvider.chat({
    agent,
    system,
    user: JSON.stringify(payload),
    responseSchema,
    temperature: manifest.model.temperature,
    seed: manifest.model.seed,
    maxTokens: manifest.model.maxOutputTokens,
    thinking: manifest.model.thinking
  });
  const output = JSON.parse(result.content || '{}');
  const record = { agent, driver: result.driver, inputSha256: result.requestSha256, visibleEvidence: payload.visibleEvidence, output, outputSha256: shaRef(JSON.stringify(output)), durationMs: result.latencyMs, promptEvalCount: result.usage.promptTokens ?? null, evalCount: result.usage.completionTokens ?? null, reasoningTokens: result.usage.reasoningTokens ?? null, model: result.model, modelDigest: manifest.model.digest, requestSha256: result.requestSha256, responseSha256: result.responseSha256, providerAttempts: result.attempts };
  agents.push(record);
  return output;
}

await rm(work, { recursive: true, force: true });
stage = 'prepare-source';
await mkdir(source, { recursive: true });
await mkdir(deps, { recursive: true });
await mkdir(evidenceDir, { recursive: true });
const archive = join(work, 'source.tar.gz');
await mkdir(dirname(archiveCache), { recursive: true });
let cacheValid = false;
try { cacheValid = shaRef(await readFile(archiveCache)) === manifest.case.sourceArchiveSha256; } catch {}
if (!cacheValid) {
  const partial = `${archiveCache}.partial-${process.pid}`;
  await rm(partial, { force: true });
  const download = run('curl', ['--noproxy', '*', '-fL', '--retry', '3', '--retry-all-errors', '--connect-timeout', '15', '--max-time', '180', '-o', partial, manifest.case.sourceArchiveUrl], { tool: 'source.download', auditArgs: [manifest.case.sourceArchiveUrl] });
  if (download.exitCode || shaRef(await readFile(partial)) !== manifest.case.sourceArchiveSha256) { await rm(partial, { force: true }); throw new Error('source download or digest verification failed'); }
  await rename(partial, archiveCache);
  tools.push({ tool: 'source.cache-store', args: [manifest.case.sourceArchiveSha256], cwd: null, exitCode: 0, durationMs: 0, outputSha256: manifest.case.sourceArchiveSha256, outputTail: 'verified content-addressed cache' });
} else {
  tools.push({ tool: 'source.cache-hit', args: [manifest.case.sourceArchiveSha256], cwd: null, exitCode: 0, durationMs: 0, outputSha256: manifest.case.sourceArchiveSha256, outputTail: 'verified content-addressed cache' });
}
await copyFile(archiveCache, archive);
if (shaRef(await readFile(archive)) !== manifest.case.sourceArchiveSha256) throw new Error('source archive digest mismatch after cache copy');
if (run('tar', ['-xzf', archive, '-C', source, '--strip-components=1'], { tool: 'source.extract' }).exitCode) throw new Error('source extract failed');
if (prebuiltDeps) {
  const validation = await validateLockedDependencies(prebuiltDeps);
  if (!validation.ok) throw new Error(`prebuilt dependency lock mismatch: ${(validation.mismatches || [validation.reason]).join(', ')}`);
  if (run('cp', ['-a', `${prebuiltDeps}/.`, deps], { tool: 'environment.copy-locked-deps', auditArgs: ['<validated-prebuilt-deps>', '$WORK/deps'] }).exitCode) throw new Error('prebuilt dependency copy failed');
  tools.push({ tool: 'environment.lock-accepted', args: [shaRef(await readFile(requirements))], cwd: null, exitCode: 0, durationMs: 0, outputSha256: shaRef(JSON.stringify(validation)), outputTail: `${validation.expectedCount} locked distributions matched` });
} else {
  const install = run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-deps', '--target', deps, '-r', requirements], { tool: 'environment.install', timeout: 300000 });
  if (install.exitCode) throw new Error('dependency install failed');
}
const installedValidation = await validateLockedDependencies(deps);
if (!installedValidation.ok) throw new Error(`installed dependency lock mismatch: ${(installedValidation.mismatches || [installedValidation.reason]).join(', ')}`);
const installEnv = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: deps };
const packageInstall = run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-deps', '--no-build-isolation', '--upgrade', '--target', deps, '.'], { cwd: source, env: installEnv, tool: 'environment.install-project', timeout: 300000 });
if (packageInstall.exitCode) throw new Error(`project install failed: ${packageInstall.output.trim().split('\n').slice(-8).join('\n')}`);
run('git', ['init', '-q'], { cwd: source, tool: 'repository.init' });
run('git', ['add', '.'], { cwd: source, tool: 'repository.stage-base' });
run('git', ['-c', 'user.name=DevOrbit Model Pilot', '-c', 'user.email=devorbit-model@localhost', 'commit', '-qm', 'base'], { cwd: source, tool: 'repository.commit-base' });
await writeFile(join(work, 'test.patch'), testPatch);
if (run('git', ['apply', join(work, 'test.patch')], { cwd: source, tool: 'evaluator.apply-test-patch', auditArgs: ['<frozen-test.patch>'] }).exitCode) throw new Error('test patch apply failed');
const testEnv = { ...installEnv, PYTHONPATH: `${join(source, 'src')}:${deps}` };
const importProbe = run(python, ['-c', 'import sqlfluff; print(sqlfluff.__file__)'], { cwd: source, env: testEnv, tool: 'environment.import-probe' });
if (importProbe.exitCode || !importProbe.output.trim().startsWith(join(source, 'src'))) throw new Error(`tests are not loading source workspace: ${importProbe.output.trim()}`);
const targetArgs = ['-m', 'pytest', '-q', 'test/core/dialects/ansi_test.py::test__dialect__ansi_is_whitespace'];
const baseline = run(python, targetArgs, { cwd: source, env: testEnv, tool: 'ci.baseline-target' });
await writeFile(baselineLog, baseline.output);
if (baseline.exitCode !== 1 || !baseline.output.includes('assert raw_seg.is_whitespace')) throw new Error('exact baseline failure not reproduced');

const search = run('rg', ['-n', 'is_whitespace|type=["\'\"](?:whitespace|newline)["\'\"]|name=["\'\"](?:whitespace|newline)["\'\"]', 'src/sqlfluff'], { cwd: source, tool: 'repository.search' });
const excerptSpecs = [
  ['src/sqlfluff/core/parser/segments/base.py', 55, 90],
  ['src/sqlfluff/core/parser/segments/raw.py', 1, 145],
  ['src/sqlfluff/core/parser/lexer.py', 145, 320],
  ['src/sqlfluff/core/dialects/dialect_ansi.py', 45, 95],
  ['src/sqlfluff/core/rules/base.py', 395, 425]
];
const candidates = {};
for (const [path, startLine, endLine] of excerptSpecs) {
  const lines = (await readFile(join(source, path), 'utf8')).split('\n');
  candidates[`${path}#L${startLine}-L${endLine}`] = lines.slice(startLine - 1, endLine).join('\n');
}
const inspectionCode = "from sqlfluff.core import FluffConfig\nfrom sqlfluff.core.parser import Lexer\nlexer = Lexer(config=FluffConfig(overrides={'dialect':'ansi'}))\nfor matcher in lexer.matcher.submatchers:\n    cls = matcher.target_seg_class\n    if matcher.name in ('whitespace', 'newline', 'code'):\n        print(matcher.name, cls.__name__, cls.type, cls.is_whitespace)";
const inspection = run(python, ['-c', inspectionCode], { cwd: source, env: testEnv, tool: 'repository.runtime-class-probe' });
if (inspection.exitCode) throw new Error('runtime class probe failed');
const visibleEvidence = ['issue.json', 'comments.json', 'baseline-target.log', 'repository.search', 'repository.runtime-class-probe', ...Object.keys(candidates)];
const v2 = manifest.pilotId === 'devorbit-public-model-pilot-v2';
const v3 = manifest.pilotId === 'devorbit-public-model-pilot-v3';
const v4 = manifest.pilotId === 'devorbit-public-model-pilot-v4';
const v5 = manifest.pilotId === 'devorbit-public-model-pilot-v5';
const v6 = manifest.pilotId === 'devorbit-public-model-pilot-v6';
const v7 = manifest.pilotId === 'devorbit-public-model-pilot-v7';
const v8 = manifest.pilotId === 'devorbit-public-model-pilot-v8';
const v9 = manifest.pilotId === 'devorbit-public-model-pilot-v9';
const v10 = manifest.pilotId === 'devorbit-public-model-pilot-v10';
const v11 = manifest.pilotId === 'devorbit-public-model-pilot-v11';
stage = 'rca-agent';
const rcaSystem = v3 || v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11
  ? `You are an evidence-first root-cause analyst. Use only supplied evidence. Trace how ANSI lexer kwargs flow through SingletonMatcher.from_shorthand and RawSegment.make into runtime-generated segment classes. Distinguish segment type from is_whitespace behavior. ${v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11 ? 'BaseSegment.is_whitespace=False is a machine-protected invariant because ordinary code segments must remain non-whitespace; do not propose changing that default.' : ''} Do not request or use any pull request, expected fix, gold patch, benchmark answer, or network resource. Return concise JSON with cited evidence paths.`
  : 'You are an evidence-first root-cause analyst. Use only the supplied evidence. Do not infer or request any pull request, expected fix, gold patch, benchmark answer, or network resource. Return concise JSON with cited evidence paths.';
const rca = await ask('rca-worker', rcaSystem, { visibleEvidence, issue, comments, baseline: baseline.output.slice(-5000), search: search.output.slice(0, 12000), runtimeClassProbe: inspection.output, files: candidates }, { type: 'object', required: ['rootCause', 'confidence', 'evidence', 'filesToChange', 'risk'], properties: { rootCause: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } }, filesToChange: { type: 'array', items: { type: 'string' } }, risk: { type: 'string' } } });
await writeFile(transcriptFile, JSON.stringify(progress(), null, 2) + '\n');
const exactEdit = v2 || v3 || v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11;
const attemptLimit = manifest.workflow.patchAttemptLimit;
const originals = new Map();
const attempts = [];
const attemptArtifacts = [];
let previousAttempt = null;
let patch;
let changed = [];
let diff;
let target;
let regression;
let classification;
let machineGate;
let verify;
let effectiveVerdict;
let finalPatch = null;
let finalChanged = [];
let finalDiff = { output: '' };
let finalTarget = { exitCode: null, output: '' };
let finalRegression = { exitCode: null, output: '' };
let finalClassification = { exitCode: null, output: '' };
let finalMachineGate = null;
let finalVerify = null;
let finalEffectiveVerdict = null;
const regressionArgs = exactEdit ? ['-m', 'pytest', '-q', 'test/core/parser', 'test/core/dialects/ansi_test.py'] : ['-m', 'pytest', '-q', 'test/core/dialects/ansi_test.py'];
const classificationCode = v8 || v9 || v10 || v11
  ? "from sqlfluff.core import FluffConfig\nfrom sqlfluff.core.parser import Lexer\nfrom sqlfluff.core.parser.segments.raw import RawSegment\ntokens, errors = Lexer(config=FluffConfig(overrides={'dialect':'ansi'})).lex('select x\\n')\nobserved = [(x.type, x.is_whitespace) for x in tokens]\nexpected = [('raw', False), ('whitespace', True), ('raw', False), ('newline', True)]\nprint('observed=', observed)\nprint('expected=', expected)\nassert not errors\nassert observed == expected\nfactory_observed = []\nfor label, kwargs in [('explicit', dict(name='whitespace', type='whitespace', is_whitespace=True)), ('type_alias', dict(name='space_alias', type='whitespace')), ('newline_alias', dict(name='line_alias', type='newline')), ('code', dict(name='code_alias', type='raw'))]:\n    cls = RawSegment.make('x', **kwargs)\n    factory_observed.append((label, cls.is_whitespace))\nfactory_expected = [('explicit', True), ('type_alias', True), ('newline_alias', True), ('code', False)]\nprint('factory_observed=', factory_observed)\nprint('factory_expected=', factory_expected)\nassert factory_observed == factory_expected\nprint('PASS token and factory classification')"
  : "from sqlfluff.core import FluffConfig\nfrom sqlfluff.core.parser import Lexer\ntokens, errors = Lexer(config=FluffConfig(overrides={'dialect':'ansi'})).lex('select x\\n')\nobserved = [(x.type, x.is_whitespace) for x in tokens]\nexpected = [('raw', False), ('whitespace', True), ('raw', False), ('newline', True)]\nprint('observed=', observed)\nprint('expected=', expected)\nassert not errors\nassert observed == expected\nprint('PASS token classification')";
for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
  if (attempt > 1) {
    for (const [path, content] of originals) await writeFile(join(source, path), content);
  }
  stage = `patch-agent-attempt-${attempt}`;
  try {
  if (exactEdit) {
    const priorRunFeedback = v3 || v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11 ? manifest.priorRunFeedback : manifest.priorRun.feedback;
    const repairInstruction = attempt > 1
      ? 'This is the only permitted repair attempt. Use the supplied prior diff and failing machine evidence, change executable behavior, and do not repeat the failed edit.'
      : 'Change executable behavior; a comment-only edit is rejected by the deterministic machine gate.';
    const patchContractInstruction = v5 || v6 || v7 || v8 || v9 || v10 || v11
      ? 'Return one file and an edits array containing one or two exact replacements. Each oldText must be copied byte-for-byte from a supplied source excerpt and occur exactly once when applied in order to the clean source.'
      : 'Return exactly one source edit: file, oldText copied byte-for-byte from a supplied source excerpt, and newText. The runner requires oldText to occur exactly once in the clean source.';
    const patchSchema = v5 || v6 || v7 || v8 || v9 || v10 || v11
      ? { type: 'object', required: ['summary', 'file', 'edits', 'rollback'], properties: { summary: { type: 'string' }, file: { type: 'string' }, edits: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', required: ['oldText', 'newText'], properties: { oldText: { type: 'string' }, newText: { type: 'string' } } } }, rollback: { type: 'string' } } }
      : { type: 'object', required: ['summary', 'file', 'oldText', 'newText', 'rollback'], properties: { summary: { type: 'string' }, file: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, rollback: { type: 'string' } } };
    patch = await ask('patch-worker', `You are a minimal-patch engineer. ${repairInstruction} Trace the runtime-generated segment class factory. ${patchContractInstruction} Modify only src/. Do not modify tests, CI, dependencies, generated files, or BaseSegment defaults. ${v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11 ? 'The protectedSourceInvariants in the payload are enforced by code. Locate the narrow executable change in the dynamic class factory or lexer configuration.' : ''} ${(manifest.workflow.allowedWritePaths || []).length ? `The machine-enforced allowedWritePaths are ${manifest.workflow.allowedWritePaths.join(', ')}; every edit must use one of those exact paths.` : ''} ${manifest.workflow.patchGuidance || ''} Do not request or use a pull request, expected fix, gold patch, benchmark answer, or network resource.`, { visibleEvidence: [...visibleEvidence, 'rca-worker.output', 'prior-run.feedback', ...(previousAttempt ? ['previous-attempt.diff', 'previous-attempt.machine-gate', 'previous-attempt.test-evidence'] : [])], issue, baseline: baseline.output.slice(-5000), search: search.output.slice(0, 12000), runtimeClassProbe: inspection.output, files: candidates, rca, priorRunFeedback, protectedSourceInvariants: manifest.workflow.protectedSourceInvariants || [], allowedWritePaths: manifest.workflow.allowedWritePaths || [], previousAttempt }, patchSchema);
    const path = patch.file;
    if (!isAllowedModelPilotPath(path, manifest.workflow.allowedWritePrefix, manifest.workflow.forbiddenWritePrefixes)) throw new Error(`model edit violates path policy: ${path}`);
    if ((manifest.workflow.allowedWritePaths || []).length && !manifest.workflow.allowedWritePaths.includes(path)) throw new Error(`model edit is outside allowedWritePaths: ${path}`);
    const file = join(source, path);
    const before = await readFile(file, 'utf8');
    if (!originals.has(path)) originals.set(path, before);
    const edits = v5 || v6 || v7 || v8 || v9 || v10 || v11 ? patch.edits : [{ oldText: patch.oldText, newText: patch.newText }];
    let after = before;
    for (const [index, edit] of edits.entries()) {
      if (!edit.oldText || edit.oldText === edit.newText) throw new Error(`model edit ${index + 1} must contain a non-empty change`);
      const occurrences = after.split(edit.oldText).length - 1;
      if (occurrences !== 1) throw new Error(`model edit ${index + 1} oldText must occur exactly once, observed ${occurrences}`);
      after = after.replace(edit.oldText, edit.newText);
    }
    await writeFile(file, after);
    const generated = run('git', ['diff', '--', path], { cwd: source, tool: `repository.generate-diff.attempt-${attempt}` });
    if (!generated.output.trim()) throw new Error('model edit produced no diff');
    await writeFile(modelPatchFile, generated.output);
    changed = [path];
  } else {
    patch = await ask('patch-worker', 'You are a minimal-patch engineer. Use only supplied evidence and RCA. Return a unified git diff in patch. It may modify only files under src/. Do not modify tests, snapshots, CI, dependencies, or generated files. Do not request or use a pull request, expected fix, gold patch, benchmark answer, or network resource. The patch must be syntactically valid for git apply.', { visibleEvidence: [...visibleEvidence, 'rca-worker.output'], issue, baseline: baseline.output.slice(-5000), search: search.output.slice(0, 12000), files: candidates, rca }, { type: 'object', required: ['summary', 'patch', 'files', 'rollback'], properties: { summary: { type: 'string' }, patch: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, rollback: { type: 'string' } } });
    const normalizedPatch = patch.patch.replace(/\r\n/g, '\n').trim() + '\n';
    if (!normalizedPatch.startsWith('diff --git ')) throw new Error('model did not return a unified git diff');
    await writeFile(modelPatchFile, normalizedPatch);
    changed = [...new Set([...normalizedPatch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].flatMap(match => [match[1], match[2]]))];
    if (!changed.length || changed.some(path => !isAllowedModelPilotPath(path, manifest.workflow.allowedWritePrefix, manifest.workflow.forbiddenWritePrefixes))) throw new Error(`model patch violates path policy: ${changed.join(', ')}`);
    if (run('git', ['apply', '--check', modelPatchFile], { cwd: source, tool: 'repository.patch-check', auditArgs: ['<model.patch>'] }).exitCode) throw new Error('model patch failed git apply --check');
    if (run('git', ['apply', modelPatchFile], { cwd: source, tool: 'repository.patch-apply', auditArgs: ['<model.patch>'] }).exitCode) throw new Error('model patch failed to apply');
  }
  } catch (error) {
    const rejectionGate = { authority: 'deterministic-machine-gate', passed: false, checks: { patchContract: false }, failedChecks: ['patchContract'] };
    const rejection = { attempt, rejection: { stage, error: error.message, modelPatch: patch || null }, machineGate: rejectionGate, modelVerification: { accept: false, reason: 'Patch contract rejected before execution.', checks: [], residualRisk: 'No test evidence is accepted for this attempt.' }, effectiveVerdict: { accepted: false, machineGatePassed: false, modelAccept: false, rule: 'machineGatePassed && modelAccept' } };
    attempts.push(rejection);
    previousAttempt = { rejection: rejection.rejection, machineGate: rejectionGate, modelVerification: rejection.modelVerification };
    if (attempt >= attemptLimit) {
      if (!finalMachineGate) finalMachineGate = rejectionGate;
      if (!finalVerify) finalVerify = rejection.modelVerification;
      if (!finalEffectiveVerdict) finalEffectiveVerdict = rejection.effectiveVerdict;
      break;
    }
    continue;
  }
  stage = `verification-tools-attempt-${attempt}`;
  diff = run('git', ['diff', '--', 'src'], { cwd: source, tool: `repository.diff.attempt-${attempt}` });
  target = run(python, targetArgs, { cwd: source, env: testEnv, tool: `ci.target.attempt-${attempt}` });
  regression = run(python, regressionArgs, { cwd: source, env: testEnv, tool: `ci.regression.attempt-${attempt}`, timeout: 300000 });
  classification = run(python, ['-c', classificationCode], { cwd: source, env: testEnv, tool: `ci.token-classification.attempt-${attempt}` });
  await writeFile(targetLogFile, target.output);
  await writeFile(regressionLogFile, regression.output);
  if (classificationLogFile) await writeFile(classificationLogFile, classification.output);
  const policyChecks = {};
  for (const [index, invariant] of (manifest.workflow.protectedSourceInvariants || []).entries()) {
    const pathAllowed = isAllowedModelPilotPath(invariant.path, manifest.workflow.allowedWritePrefix, manifest.workflow.forbiddenWritePrefixes);
    const content = pathAllowed ? await readFile(join(source, invariant.path), 'utf8') : '';
    policyChecks[`protected-source-invariant-${index + 1}`] = pathAllowed && content.split('\n').includes(invariant.requiredText);
  }
  if ((manifest.workflow.allowedWritePaths || []).length) {
    policyChecks.allowedWritePaths = changed.length > 0 && changed.every(path => manifest.workflow.allowedWritePaths.includes(path));
  }
  machineGate = evaluateModelPilotGate({ targetExitCode: target.exitCode, regressionExitCode: regression.exitCode, classificationExitCode: classification.exitCode, changedPaths: changed, diff: diff.output, allowedWritePrefix: manifest.workflow.allowedWritePrefix, forbiddenWritePrefixes: manifest.workflow.forbiddenWritePrefixes, requireExecutableChange: true, policyChecks });
  stage = `verify-agent-attempt-${attempt}`;
  verify = await ask('verify-worker', 'You are an independent advisory verification agent. The deterministic machine gate is authoritative and cannot be overridden. Return accept=false whenever machineGate.passed is false. Also veto a machine-passing patch if the diff does not address the RCA. Do not request or use a pull request, expected fix, gold patch, benchmark answer, or network resource.', { visibleEvidence: ['rca-worker.output', 'patch-worker.output', 'repository.diff', 'ci.target', 'ci.regression', 'ci.token-classification', 'deterministic-machine-gate'], rca, patch: { summary: patch.summary, files: patch.files || [patch.file], rollback: patch.rollback }, appliedDiff: diff.output, target: { exitCode: target.exitCode, output: target.output.slice(-5000) }, regression: { exitCode: regression.exitCode, output: regression.output.slice(-5000) }, classification: { exitCode: classification.exitCode, output: classification.output.slice(-2000) }, changedPaths: [...new Set(changed)], machineGate }, { type: 'object', required: ['accept', 'reason', 'checks', 'residualRisk'], properties: { accept: { type: 'boolean' }, reason: { type: 'string' }, checks: { type: 'array', items: { type: 'string' } }, residualRisk: { type: 'string' } } });
  effectiveVerdict = enforceModelPilotVerdict(machineGate, verify);
  const record = { attempt, patch: { summary: patch.summary, files: patch.files || [patch.file], changedPaths: [...new Set(changed)], diffSha256: shaRef(diff.output), rollback: patch.rollback }, testEvidence: { targetExitCode: target.exitCode, regressionExitCode: regression.exitCode, classificationExitCode: classification.exitCode }, machineGate, modelVerification: verify, effectiveVerdict };
  attempts.push(record);
  finalPatch = patch;
  finalChanged = [...new Set(changed)];
  finalDiff = diff;
  finalTarget = target;
  finalRegression = regression;
  finalClassification = classification;
  finalMachineGate = machineGate;
  finalVerify = verify;
  finalEffectiveVerdict = effectiveVerdict;
  if ((v3 || v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11) && manifest.evidence.attempts?.[attempt - 1]) {
    const spec = manifest.evidence.attempts[attempt - 1];
    const values = { patchPath: diff.output, targetLogPath: target.output, regressionLogPath: regression.output, classificationLogPath: classification.output };
    const saved = {};
    for (const [key, content] of Object.entries(values)) {
      const file = join(root, spec[key]);
      await writeFile(file, content);
      saved[key] = { path: spec[key], sha256: shaRef(await readFile(file)) };
    }
    attemptArtifacts.push(saved);
  }
  if (effectiveVerdict.accepted) break;
  previousAttempt = { patch: record.patch, testEvidence: record.testEvidence, machineGate, modelVerification: verify, diff: diff.output };
}

const closedLoop = finalEffectiveVerdict?.accepted === true;
stage = 'completed';
const transcript = { ...progress(), status: closedLoop ? 'passed' : 'failed' };
await writeFile(transcriptFile, JSON.stringify(transcript, null, 2) + '\n');
const artifacts = {};
const finalArtifactFiles = { transcript: transcriptFile, patch: modelPatchFile, targetLog: targetLogFile, regressionLog: regressionLogFile };
if (classificationLogFile) finalArtifactFiles.classificationLog = classificationLogFile;
for (const [key, path] of Object.entries(finalArtifactFiles)) {
  try {
    artifacts[key] = { path: path.replace(`${root}/`, ''), sha256: shaRef(await readFile(path)) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const infrastructureRetries = [];
if (infrastructureFailureFile) {
  try {
    const value = await readFile(infrastructureFailureFile);
    const failure = JSON.parse(value);
    infrastructureRetries.push({ path: infrastructureFailureFile.replace(`${root}/`, ''), sha256: shaRef(value), stage: failure.stage, error: failure.error, agentsStarted: failure.agents?.length || 0 });
  } catch {}
}
const boundaryKind = v11 ? 'validation policy-guided tuning factory-anchor-compatibility-repair' : v10 ? 'validation policy-guided tuning source-bound factory-compatibility-repair' : v9 ? 'validation policy-guided tuning bounded-timeout factory-compatibility-repair' : v8 ? 'validation policy-guided tuning factory-compatibility-repair' : v7 ? 'validation policy-guided tuning factory-repair' : v6 ? 'validation tuning factory-repair' : v5 ? 'validation tuning bounded-multi-edit' : v4 ? 'validation tuning protected-repair' : v3 ? 'validation tuning repair' : v2 ? 'validation tuning' : 'validation';
const report = { generatedAt: new Date().toISOString(), status: closedLoop ? 'passed' : 'failed', runId: manifest.runId || 'run-001', disclosure: manifest.disclosure, boundary: `One pre-registered SWE-bench dev ${boundaryKind} case with a real local model. No independent-generalization, aggregate, test-set, production, gold-equivalence, or ranking claim.`, priorRun: manifest.priorRun || null, priorRuns: manifest.priorRuns || null, infrastructureRetries, case: { instanceId: manifest.case.instanceId, split: manifest.case.split, baseCommit: manifest.case.baseCommit }, model: manifest.model, workflow: { agents: manifest.workflow.agents, modelDriver, patchAttempts: attempts.length, responseTimeoutMs: manifest.workflow.responseTimeoutMs || 300000, importPath: importProbe.output.trim(), targetExitCode: finalTarget.exitCode, regressionExitCode: finalRegression.exitCode, classificationExitCode: finalClassification.exitCode, machineGatePassed: finalMachineGate?.passed === true, modelVerifierAccepted: finalVerify?.accept === true, verifyAccepted: finalEffectiveVerdict?.accepted === true, acceptanceRule: finalEffectiveVerdict?.rule || manifest.workflow.acceptanceRule, closedLoop, durationMs: Date.now() - started, promptTokens: agents.reduce((sum, item) => sum + (item.promptEvalCount || 0), 0), outputTokens: agents.reduce((sum, item) => sum + (item.evalCount || 0), 0), reasoningTokens: agents.reduce((sum, item) => sum + (item.reasoningTokens || 0), 0) }, leakage: transcript.leakageBoundary, rootCause: rca, patch: finalPatch ? { summary: finalPatch.summary, files: finalPatch.files || [finalPatch.file], changedPaths: finalChanged, diffSha256: shaRef(finalDiff.output), rollback: finalPatch.rollback } : null, attempts, verification: v3 || v4 || v5 || v6 || v7 || v8 || v9 || v10 || v11 ? { machineGate: finalMachineGate, model: finalVerify, effectiveVerdict: finalEffectiveVerdict } : finalVerify, artifacts, attemptArtifacts };
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(`${closedLoop ? 'PASS' : 'FAIL'} public model pilot: attempts=${attempts.length}, target=${finalTarget.exitCode}, regression=${finalRegression.exitCode}, machine=${finalMachineGate?.passed === true}, model=${finalVerify?.accept === true}, effective=${closedLoop}, tokens=${report.workflow.promptTokens + report.workflow.outputTokens}`);
if (!closedLoop) process.exit(1);

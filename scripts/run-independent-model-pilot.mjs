import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';
import { enforceModelPilotVerdict, evaluateModelPilotGate, isAllowedModelPilotPath } from '../src/evaluation/model-pilot-gate.js';

const root = resolve(new URL('../', import.meta.url).pathname);
const manifestRelative = 'evaluation/independent-model-pilot.manifest.json';
const manifestPath = join(root, manifestRelative);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const schema = JSON.parse(await readFile(join(root, 'schemas/independent-model-pilot.schema.json')));
const schemaErrors = validateJsonSchema(manifest, schema);
if (schemaErrors.length) throw new Error(`manifest schema: ${schemaErrors.join('; ')}`);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const shaRef = value => `sha256:${sha256(value)}`;
const runnerBytes = await readFile(new URL(import.meta.url));
if (shaRef(runnerBytes) !== manifest.implementation.runnerSha256) throw new Error('runner implementation digest mismatch');
const safeRootPath = relative => {
  const absolute = resolve(root, relative);
  if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`path escapes repository: ${relative}`);
  return absolute;
};
const readBound = async (relative, digest) => {
  const value = await readFile(safeRootPath(relative));
  if (shaRef(value) !== digest) throw new Error(`digest mismatch: ${relative}`);
  return value;
};

const work = process.env.DEVORBIT_INDEPENDENT_WORKDIR || '/tmp/devorbit-independent-model-pilot-pydicom-965';
const modelSource = join(work, 'model-source');
const baselineEvaluator = join(work, 'baseline-evaluator');
const patchedEvaluator = join(work, 'patched-evaluator');
const deps = join(work, 'deps');
const archive = join(work, 'source.tar.gz');
const archiveCache = process.env.DEVORBIT_INDEPENDENT_ARCHIVE_CACHE || `/tmp/devorbit-source-cache/${manifest.case.sourceArchiveSha256.slice(7)}.tar.gz`;
const prebuiltDeps = process.env.DEVORBIT_INDEPENDENT_PREBUILT_DEPS || '';
const python = manifest.runtime.pythonPath;
const ollama = process.env.DEVORBIT_OLLAMA_URL || 'http://127.0.0.1:11434';
const evidenceDir = safeRootPath(dirname(manifest.evidence.transcriptPath));
const transcriptPath = safeRootPath(manifest.evidence.transcriptPath);
const patchPath = safeRootPath(manifest.evidence.patchPath);
const baselineLogPath = safeRootPath(manifest.evidence.baselineLogPath);
const targetLogPath = safeRootPath(manifest.evidence.targetLogPath);
const regressionLogPath = safeRootPath(manifest.evidence.regressionLogPath);
const classificationLogPath = safeRootPath(manifest.evidence.classificationLogPath);
const reportPath = safeRootPath(manifest.evidence.reportPath);
const startedAt = new Date().toISOString();
const started = Date.now();
const toolRecords = [];
const agentRecords = [];
let stage = 'initialize';

function run(file, args, options = {}) {
  const at = Date.now();
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout || 180000,
    maxBuffer: 10 * 1024 * 1024
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  toolRecords.push({
    tool: options.tool || file,
    args: options.auditArgs || args,
    cwd: options.cwd ? options.cwd.replace(work, '$WORK') : null,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - at,
    outputSha256: shaRef(output),
    outputTail: output.trim().split('\n').slice(-20).join('\n')
  });
  return { exitCode: result.status ?? 1, output, signal: result.signal || null };
}

async function ask(agent, system, payload, responseSchema) {
  const request = {
    model: manifest.model.name,
    stream: false,
    think: manifest.model.thinking,
    format: responseSchema,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload) }
    ],
    options: {
      temperature: manifest.model.temperature,
      seed: manifest.model.seed,
      num_ctx: manifest.model.contextTokens,
      num_predict: manifest.model.maxOutputTokens
    }
  };
  const serialized = JSON.stringify(request);
  const at = Date.now();
  const response = await fetch(`${ollama}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: serialized,
    signal: AbortSignal.timeout(manifest.workflow.responseTimeoutMs)
  });
  if (!response.ok) throw new Error(`${agent} model HTTP ${response.status}`);
  const raw = await response.text();
  const envelope = JSON.parse(raw);
  const output = JSON.parse(envelope.message?.content || '{}');
  agentRecords.push({
    agent,
    inputSha256: shaRef(serialized),
    visibleEvidence: payload.visibleEvidence,
    output,
    outputSha256: shaRef(JSON.stringify(output)),
    durationMs: Date.now() - at,
    promptEvalCount: envelope.prompt_eval_count ?? null,
    evalCount: envelope.eval_count ?? null,
    model: envelope.model,
    modelDigest: manifest.model.digest
  });
  return output;
}

function normalizeDistribution(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

async function validateLockedDependencies(path, requirementsBytes) {
  const expected = Object.fromEntries(requirementsBytes.toString('utf8')
    .split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => line.split('==')).map(([name, version]) => [normalizeDistribution(name), version]));
  const code = "import importlib.metadata as m, json, sys\nprint(json.dumps({d.metadata['Name'].lower().replace('_','-').replace('.','-'): d.version for d in m.distributions(path=[sys.argv[1]])}, sort_keys=True))";
  const probe = run(python, ['-c', code, path], { tool: 'environment.lock-probe', auditArgs: ['<dependency-directory>'] });
  if (probe.exitCode) return { ok: false, reason: 'metadata probe failed' };
  let actual;
  try { actual = JSON.parse(probe.output.trim()); } catch { return { ok: false, reason: 'metadata probe returned invalid JSON' }; }
  const mismatches = Object.entries(expected)
    .filter(([name, version]) => actual[name] !== version)
    .map(([name, version]) => `${name}=${actual[name] || 'missing'} expected ${version}`);
  return { ok: mismatches.length === 0, expectedCount: Object.keys(expected).length, mismatches };
}

function allowedProductionPath(path) {
  return isAllowedModelPilotPath(path, manifest.workflow.allowedWritePrefix, manifest.workflow.forbiddenWritePrefixes)
    && path.endsWith('.py');
}

function boundedStrings(values, maximum, maxLength = 100) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length >= 2 && value.length <= maxLength && !value.includes('\0')))].slice(0, maximum);
}

function parseSearchHits(output) {
  const hits = [];
  for (const line of String(output).split('\n')) {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (match && allowedProductionPath(match[1])) hits.push({ path: match[1], line: Number(match[2]), text: match[3] });
  }
  return hits;
}

async function sourceExcerpt(path, hitLines, budget) {
  const lines = (await readFile(join(modelSource, path), 'utf8')).split('\n');
  const ranges = hitLines.length
    ? hitLines.slice(0, 5).map(line => [Math.max(1, line - 35), Math.min(lines.length, line + 35)])
    : [[1, Math.min(lines.length, 180)]];
  const selected = [];
  const seen = new Set();
  for (const [start, end] of ranges) {
    for (let number = start; number <= end; number++) {
      if (seen.has(number)) continue;
      seen.add(number);
      selected.push(`${String(number).padStart(4, ' ')} | ${lines[number - 1]}`);
    }
  }
  return selected.join('\n').slice(0, budget);
}

async function copyWorkspace(from, to) {
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  const copy = run('cp', ['-a', `${from}/.`, to], { tool: 'workspace.copy', auditArgs: ['$WORK/model-source/.', '$WORK/evaluator'] });
  if (copy.exitCode) throw new Error('workspace copy failed');
  await rm(join(to, '.git'), { recursive: true, force: true });
}

function progress(status = 'running', error = null) {
  return {
    protocolVersion: manifest.protocolVersion,
    pilotId: manifest.pilotId,
    runId: manifest.runId,
    manifestSha256: shaRef(manifestBytes),
    startedAt,
    completedAt: new Date().toISOString(),
    stage,
    status,
    error,
    isolation: {
      modelWorkspaceContainsHiddenTestPatch: false,
      modelWorkspaceContainsClassificationProbe: false,
      forbiddenArtifactsReadByModel: [],
      goldImplementationRead: false,
      goldComparisonPerformed: false,
      agentNetworkToolsAvailable: false
    },
    agents: agentRecords,
    tools: toolRecords
  };
}

async function main() {
  await rm(work, { recursive: true, force: true });
  await mkdir(modelSource, { recursive: true });
  await mkdir(deps, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  stage = 'bind-artifacts';
  const selectionBytes = await readBound(manifest.selection.recordPath, manifest.selection.recordSha256);
  const issueBytes = await readBound(manifest.case.issuePath, manifest.case.issueSha256);
  const testPatchBytes = await readBound(manifest.case.testPatchPath, manifest.case.testPatchSha256);
  const requirementsBytes = await readBound(manifest.case.requirementsPath, manifest.case.requirementsSha256);
  const classificationBytes = await readBound(manifest.case.classificationProbePath, manifest.case.classificationProbeSha256);
  const issue = JSON.parse(issueBytes);
  const selection = JSON.parse(selectionBytes);
  if (selection.goldIsolation?.implementationPatchRead !== false || selection.goldIsolation?.implementationPatchStored !== false) throw new Error('selection record does not prove gold isolation');

  stage = 'verify-runtime';
  const version = run(python, ['--version'], { tool: 'runtime.python-version' });
  if (version.exitCode || !version.output.includes(`Python ${manifest.runtime.pythonVersion}`)) throw new Error('Python version mismatch');
  const tagsResponse = await fetch(`${ollama}/api/tags`, { signal: AbortSignal.timeout(15000) });
  if (!tagsResponse.ok) throw new Error(`Ollama tags HTTP ${tagsResponse.status}`);
  const tags = await tagsResponse.json();
  const installedModel = tags.models?.find(item => item.name === manifest.model.name || item.model === manifest.model.name);
  const installedModelDigest = installedModel?.digest?.startsWith('sha256:') ? installedModel.digest : `sha256:${installedModel?.digest || ''}`;
  if (!installedModel || installedModelDigest !== manifest.model.digest) throw new Error('model name or digest mismatch');
  toolRecords.push({ tool: 'model.digest-probe', args: [manifest.model.name], cwd: null, exitCode: 0, durationMs: 0, outputSha256: shaRef(installedModel.digest), outputTail: installedModel.digest });

  stage = 'prepare-source';
  await mkdir(dirname(archiveCache), { recursive: true });
  let cacheValid = false;
  try { cacheValid = shaRef(await readFile(archiveCache)) === manifest.case.sourceArchiveSha256; } catch {}
  if (!cacheValid) {
    const partial = `${archiveCache}.partial-${process.pid}`;
    await rm(partial, { force: true });
    const download = run('curl', ['--noproxy', '*', '-fL', '--retry', '3', '--retry-all-errors', '--connect-timeout', '15', '--max-time', '180', '-o', partial, manifest.case.sourceArchiveUrl], { tool: 'source.download', auditArgs: [manifest.case.sourceArchiveUrl] });
    if (download.exitCode || shaRef(await readFile(partial)) !== manifest.case.sourceArchiveSha256) throw new Error('source download or digest verification failed');
    await rename(partial, archiveCache);
  } else {
    toolRecords.push({ tool: 'source.cache-hit', args: [manifest.case.sourceArchiveSha256], cwd: null, exitCode: 0, durationMs: 0, outputSha256: manifest.case.sourceArchiveSha256, outputTail: 'verified content-addressed cache' });
  }
  await copyFile(archiveCache, archive);
  if (shaRef(await readFile(archive)) !== manifest.case.sourceArchiveSha256) throw new Error('source archive digest mismatch after copy');
  if (run('tar', ['-xzf', archive, '-C', modelSource, '--strip-components=1'], { tool: 'source.extract' }).exitCode) throw new Error('source extraction failed');
  if (await readFile(join(modelSource, 'LICENSE'), 'utf8').then(value => !value.includes('MIT license'))) throw new Error('source license mismatch');
  run('git', ['init', '-q'], { cwd: modelSource, tool: 'repository.init' });
  run('git', ['add', '.'], { cwd: modelSource, tool: 'repository.stage-base' });
  const commit = run('git', ['-c', 'user.name=DevOrbit Independent Pilot', '-c', 'user.email=independent-pilot@localhost', 'commit', '-qm', 'frozen-base'], { cwd: modelSource, tool: 'repository.commit-base' });
  if (commit.exitCode) throw new Error('failed to create model workspace base commit');

  stage = 'prepare-dependencies';
  if (prebuiltDeps) {
    const validation = await validateLockedDependencies(prebuiltDeps, requirementsBytes);
    if (!validation.ok) throw new Error(`prebuilt dependency mismatch: ${(validation.mismatches || [validation.reason]).join(', ')}`);
    if (run('cp', ['-a', `${prebuiltDeps}/.`, deps], { tool: 'environment.copy-locked-deps', auditArgs: ['<validated-prebuilt-deps>', '$WORK/deps'] }).exitCode) throw new Error('dependency copy failed');
  } else {
    const install = run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-deps', '--target', deps, '-r', safeRootPath(manifest.case.requirementsPath)], { tool: 'environment.install', timeout: 300000 });
    if (install.exitCode) throw new Error('locked dependency install failed');
  }
  const dependencyValidation = await validateLockedDependencies(deps, requirementsBytes);
  if (!dependencyValidation.ok) throw new Error(`installed dependency mismatch: ${(dependencyValidation.mismatches || [dependencyValidation.reason]).join(', ')}`);
  const testEnv = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: `${modelSource}:${deps}`, NO_PROXY: '*', no_proxy: '*' };

  stage = 'baseline-hidden-evaluator';
  await copyWorkspace(modelSource, baselineEvaluator);
  const hiddenPatchPath = join(work, 'evaluator-test.patch');
  await writeFile(hiddenPatchPath, testPatchBytes);
  if (run('git', ['apply', hiddenPatchPath], { cwd: baselineEvaluator, tool: 'evaluator.apply-hidden-test', auditArgs: ['<digest-bound-hidden-test.patch>'] }).exitCode) throw new Error('hidden test patch failed to apply');
  const baselineEnv = { ...testEnv, PYTHONPATH: `${baselineEvaluator}:${deps}` };
  const baseline = run(python, manifest.workflow.targetArgs, { cwd: baselineEvaluator, env: baselineEnv, tool: 'ci.hidden-baseline-target' });
  await writeFile(baselineLogPath, baseline.output);
  if (baseline.exitCode !== manifest.workflow.baselineExpected.exitCode || !baseline.output.includes(manifest.workflow.baselineExpected.requiredText)) throw new Error('exact hidden baseline failure not reproduced');
  if (process.env.DEVORBIT_INDEPENDENT_PREFLIGHT_ONLY === '1') {
    console.log(JSON.stringify({ status: 'preflight-passed', agentsInvoked: 0, baselineReproduced: true, manifestSha256: shaRef(manifestBytes) }, null, 2));
    return;
  }

  stage = 'triage-worker';
  const treeResult = run('rg', ['--files', '-g', '*.py', manifest.workflow.allowedWritePrefix], { cwd: modelSource, tool: 'repository.python-tree' });
  if (treeResult.exitCode) throw new Error('source tree enumeration failed');
  const sourceTree = treeResult.output.split('\n').filter(Boolean).filter(allowedProductionPath).slice(0, 500);
  const baselineVisible = baseline.output.replace(/\n[^\n]*pydicom\/tests\/test_dataelem\.py:[\s\S]*/m, '').split('\n').slice(-35).join('\n');
  const triage = await ask('triage-worker', 'You are the intake and repository-navigation specialist in a one-shot independent defect run. Use only the issue, sanitized baseline summary and base-commit production source tree. Propose high-signal fixed-string searches and production Python files to inspect. You cannot use the network, hidden tests, expected patches, pull requests, fix commits, issue comments or benchmark answers. Do not propose a fix yet. Return JSON only.', {
    visibleEvidence: ['issue.json', 'sanitized-baseline-summary', 'base-commit-production-source-tree'],
    issue,
    baselineSummary: baselineVisible,
    sourceTree
  }, {
    type: 'object',
    required: ['searchQueries', 'fileHints', 'reasoning'],
    properties: {
      searchQueries: { type: 'array', maxItems: manifest.workflow.exploration.maxSearchQueries, items: { type: 'string' } },
      fileHints: { type: 'array', maxItems: manifest.workflow.exploration.maxFiles, items: { type: 'string' } },
      reasoning: { type: 'string' }
    }
  });

  stage = 'bounded-source-exploration';
  const queries = boundedStrings(triage.searchQueries, manifest.workflow.exploration.maxSearchQueries, 100);
  const searchHits = [];
  const searchEvidence = [];
  for (const query of queries) {
    const result = run('rg', ['-n', '-F', '--', query, manifest.workflow.allowedWritePrefix], { cwd: modelSource, tool: 'repository.fixed-string-search', auditArgs: [query, manifest.workflow.allowedWritePrefix] });
    if (![0, 1].includes(result.exitCode)) throw new Error(`source search failed: ${query}`);
    const boundedOutput = result.output.slice(0, 8000);
    searchEvidence.push({ query, output: boundedOutput });
    searchHits.push(...parseSearchHits(boundedOutput));
  }
  const hintedPaths = boundedStrings(triage.fileHints, manifest.workflow.exploration.maxFiles, 240).filter(allowedProductionPath);
  const candidatePaths = [...new Set([...hintedPaths, ...searchHits.map(hit => hit.path)])].slice(0, manifest.workflow.exploration.maxFiles);
  if (!candidatePaths.length) throw new Error('triage produced no readable production source candidates');
  let excerptBudget = manifest.workflow.exploration.maxExcerptChars;
  const excerpts = {};
  for (const path of candidatePaths) {
    const absolute = resolve(modelSource, path);
    if (!absolute.startsWith(`${modelSource}${sep}`)) throw new Error(`source excerpt escapes workspace: ${path}`);
    const perFile = Math.min(7000, excerptBudget);
    if (perFile <= 0) break;
    const excerpt = await sourceExcerpt(path, searchHits.filter(hit => hit.path === path).map(hit => hit.line), perFile);
    excerpts[path] = excerpt;
    excerptBudget -= excerpt.length;
  }

  stage = 'rca-worker';
  const rca = await ask('rca-worker', 'You are an evidence-first root-cause analyst in a one-shot independent defect run. Infer the narrow causal path using only the supplied issue, baseline summary, fixed-string search results and base-commit production excerpts. Cite concrete paths and symbols. You cannot use hidden tests, expected patches, pull requests, fix commits, issue comments, benchmark answers or the network. Return JSON only.', {
    visibleEvidence: ['issue.json', 'sanitized-baseline-summary', 'triage-worker.output', 'bounded-fixed-string-searches', ...Object.keys(excerpts).map(path => `base-source:${path}`)],
    issue,
    baselineSummary: baselineVisible,
    triage,
    searches: searchEvidence,
    files: excerpts
  }, {
    type: 'object',
    required: ['rootCause', 'confidence', 'evidence', 'fileCandidates', 'risk'],
    properties: {
      rootCause: { type: 'string' },
      confidence: { type: 'number' },
      evidence: { type: 'array', items: { type: 'string' } },
      fileCandidates: { type: 'array', maxItems: 3, items: { type: 'string' } },
      risk: { type: 'string' }
    }
  });

  const rcaPaths = boundedStrings(rca.fileCandidates, 3, 240).filter(allowedProductionPath);
  for (const path of rcaPaths) {
    if (excerpts[path] !== undefined || Object.keys(excerpts).length >= manifest.workflow.exploration.maxFiles || excerptBudget <= 0) continue;
    excerpts[path] = await sourceExcerpt(path, [], Math.min(7000, excerptBudget));
    excerptBudget -= excerpts[path].length;
  }

  stage = 'patch-worker';
  const patch = await ask('patch-worker', `You are the minimal-patch engineer in a pre-registered one-shot run. Produce one to four exact text replacements across at most ${manifest.workflow.maxChangedFiles} production Python files. oldText must be copied byte-for-byte from the supplied base source excerpts and occur exactly once in its file. Preserve public behavior outside the issue. Do not edit tests, configuration, dependencies, documentation, generated files or anything outside ${manifest.workflow.allowedWritePrefix}. There is no retry and you will receive no test feedback. You cannot use hidden tests, expected patches, pull requests, fix commits, issue comments, benchmark answers or the network. Return JSON only.`, {
    visibleEvidence: ['issue.json', 'sanitized-baseline-summary', 'triage-worker.output', 'rca-worker.output', 'bounded-fixed-string-searches', ...Object.keys(excerpts).map(path => `base-source:${path}`)],
    issue,
    baselineSummary: baselineVisible,
    triage,
    searches: searchEvidence,
    rca,
    files: excerpts,
    policy: {
      allowedWritePrefix: manifest.workflow.allowedWritePrefix,
      forbiddenWritePrefixes: manifest.workflow.forbiddenWritePrefixes,
      maxChangedFiles: manifest.workflow.maxChangedFiles,
      maxDiffLines: manifest.workflow.maxDiffLines
    }
  }, {
    type: 'object',
    required: ['summary', 'edits', 'rollback'],
    properties: {
      summary: { type: 'string' },
      edits: {
        type: 'array', minItems: 1, maxItems: 4,
        items: { type: 'object', required: ['file', 'oldText', 'newText'], properties: { file: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } } }
      },
      rollback: { type: 'string' }
    }
  });

  const edits = Array.isArray(patch.edits) ? patch.edits : [];
  if (!edits.length || edits.length > 4) throw new Error('patch edit count violates contract');
  const proposedPaths = [...new Set(edits.map(edit => edit.file))];
  if (proposedPaths.length > manifest.workflow.maxChangedFiles || !proposedPaths.every(allowedProductionPath)) throw new Error('patch path policy violation');
  for (const edit of edits) {
    if (typeof edit.oldText !== 'string' || typeof edit.newText !== 'string' || !edit.oldText || edit.oldText === edit.newText) throw new Error(`invalid exact replacement: ${edit.file}`);
    const file = join(modelSource, edit.file);
    const before = await readFile(file, 'utf8');
    const occurrences = before.split(edit.oldText).length - 1;
    if (occurrences !== 1) throw new Error(`oldText occurrence count ${occurrences}: ${edit.file}`);
    await writeFile(file, before.replace(edit.oldText, edit.newText));
  }
  const changedResult = run('git', ['diff', '--name-only'], { cwd: modelSource, tool: 'repository.changed-paths' });
  const diffResult = run('git', ['diff', '--no-ext-diff', '--'], { cwd: modelSource, tool: 'repository.model-diff' });
  const changedPaths = changedResult.output.split('\n').filter(Boolean);
  const diff = diffResult.output;
  await writeFile(patchPath, diff);

  stage = 'hidden-evaluation';
  await copyWorkspace(modelSource, patchedEvaluator);
  if (run('git', ['apply', hiddenPatchPath], { cwd: patchedEvaluator, tool: 'evaluator.apply-hidden-test', auditArgs: ['<digest-bound-hidden-test.patch>'] }).exitCode) throw new Error('hidden test patch failed to apply to patched evaluator');
  const evaluatorEnv = { ...testEnv, PYTHONPATH: `${patchedEvaluator}:${deps}` };
  const target = run(python, manifest.workflow.targetArgs, { cwd: patchedEvaluator, env: evaluatorEnv, tool: 'ci.hidden-target' });
  const regression = run(python, manifest.workflow.regressionArgs, { cwd: patchedEvaluator, env: evaluatorEnv, tool: 'ci.regression-file' });
  const hiddenClassificationPath = join(work, 'classification-probe.py');
  await writeFile(hiddenClassificationPath, classificationBytes);
  const classification = run(python, [hiddenClassificationPath], { cwd: patchedEvaluator, env: evaluatorEnv, tool: 'ci.hidden-classification', auditArgs: ['<digest-bound-hidden-classification-probe>'] });
  await writeFile(targetLogPath, target.output);
  await writeFile(regressionLogPath, regression.output);
  await writeFile(classificationLogPath, classification.output);

  const changedLineCount = diff.split('\n').filter(line => (/^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line))).length;
  const machineGate = evaluateModelPilotGate({
    targetExitCode: target.exitCode,
    regressionExitCode: regression.exitCode,
    classificationExitCode: classification.exitCode,
    changedPaths,
    diff,
    allowedWritePrefix: manifest.workflow.allowedWritePrefix,
    forbiddenWritePrefixes: manifest.workflow.forbiddenWritePrefixes,
    policyChecks: {
      'changed-file-limit': changedPaths.length <= manifest.workflow.maxChangedFiles,
      'diff-line-limit': changedLineCount <= manifest.workflow.maxDiffLines,
      'single-model-attempt': manifest.workflow.patchAttemptLimit === 1,
      'hidden-workspace-isolation': true
    }
  });

  stage = 'verify-worker';
  const verify = await ask('verify-worker', 'You are the independent verification specialist. The deterministic machine gate is authoritative: you may veto but never override a failed gate. Review the model diff, changed paths, hidden target result, regression result, classification result and policy checks. Reject uncertainty, test-only behavior, out-of-scope effects or missing evidence. Do not infer or request any expected implementation patch, pull request, fix commit, hidden test source, benchmark answer or network resource. Return JSON only.', {
    visibleEvidence: ['model.patch', 'changed-paths', 'hidden-target-result-summary', 'regression-result-summary', 'hidden-classification-result-summary', 'deterministic-machine-gate'],
    issueTitle: issue.title,
    patchSummary: patch.summary,
    changedPaths,
    diff,
    target: { exitCode: target.exitCode, outputTail: target.output.split('\n').slice(-30).join('\n') },
    regression: { exitCode: regression.exitCode, outputTail: regression.output.split('\n').slice(-30).join('\n') },
    classification: { exitCode: classification.exitCode, outputTail: classification.output.split('\n').slice(-20).join('\n') },
    machineGate
  }, {
    type: 'object',
    required: ['accept', 'reason', 'evidence', 'residualRisk'],
    properties: {
      accept: { type: 'boolean' },
      reason: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
      residualRisk: { type: 'string' }
    }
  });
  const effectiveVerdict = enforceModelPilotVerdict(machineGate, verify);
  const completedAt = new Date().toISOString();
  const status = effectiveVerdict.accepted ? 'passed' : 'rejected';
  const transcript = { ...progress(status), completedAt, patchProposal: patch, changedPaths, changedLineCount, machineGate, verify, effectiveVerdict };
  const report = {
    generatedAt: completedAt,
    protocolVersion: manifest.protocolVersion,
    pilotId: manifest.pilotId,
    runId: manifest.runId,
    status,
    independent: true,
    manifestSha256: shaRef(manifestBytes),
    selectionSha256: manifest.selection.recordSha256,
    case: { instanceId: manifest.case.instanceId, repository: manifest.case.repository, split: manifest.case.split, baseCommit: manifest.case.baseCommit },
    model: manifest.model,
    workflow: { agentsCompleted: agentRecords.map(record => record.agent), patchAttempts: 1, changedPaths, changedLineCount, durationMs: Date.now() - started },
    baseline: { reproduced: true, exitCode: baseline.exitCode, logSha256: shaRef(baseline.output) },
    evaluation: {
      targetPassed: target.exitCode === 0,
      regressionPassed: regression.exitCode === 0,
      classificationPassed: classification.exitCode === 0,
      targetLogSha256: shaRef(target.output),
      regressionLogSha256: shaRef(regression.output),
      classificationLogSha256: shaRef(classification.output)
    },
    machineGate,
    verify,
    effectiveVerdict,
    leakage: transcript.isolation,
    formalBenchmark: { status: 'not_run', scoredCases: 0 },
    claimBoundary: 'One frozen independent SWE-bench dev validation case only; not an aggregate benchmark, test-set, production, vendor-platform, success-rate, or ranking claim.'
  };
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status, case: manifest.case.instanceId, targetPassed: report.evaluation.targetPassed, regressionPassed: report.evaluation.regressionPassed, classificationPassed: report.evaluation.classificationPassed, accepted: effectiveVerdict.accepted, changedPaths }, null, 2));
  if (!effectiveVerdict.accepted) process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  const completedAt = new Date().toISOString();
  const transcript = progress('failed', error.message);
  const report = {
    generatedAt: completedAt,
    protocolVersion: manifest.protocolVersion,
    pilotId: manifest.pilotId,
    runId: manifest.runId,
    status: 'failed',
    independent: true,
    stage,
    error: error.message,
    manifestSha256: shaRef(manifestBytes),
    case: { instanceId: manifest.case.instanceId, repository: manifest.case.repository, split: manifest.case.split },
    workflow: { agentsCompleted: agentRecords.map(record => record.agent), patchAttempts: agentRecords.some(record => record.agent === 'patch-worker') ? 1 : 0, durationMs: Date.now() - started },
    leakage: transcript.isolation,
    formalBenchmark: { status: 'not_run', scoredCases: 0 },
    claimBoundary: 'Failed pre-registered independent SWE-bench dev validation run; no aggregate, test-set, production, vendor-platform, success-rate, or ranking claim.'
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

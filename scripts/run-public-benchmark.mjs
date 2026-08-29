import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createModelProvider } from '../src/models/provider.js';
import { applyEditBatch, describeEditFailures } from '../src/benchmark/edit-engine.js';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const manifestPath = new URL('evaluation/public-benchmark.manifest.json', root);
const manifestBytes = await readFile(manifestPath);
const manifestDigest = `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`;
const manifest = JSON.parse(manifestBytes);
const selected = JSON.parse(await readFile(process.env.DEVORBIT_BENCH_SELECTED || '/tmp/zhanlu/selected-cases.json', 'utf8'));
const selectedById = new Map(selected.map(row => [row.instance_id, row]));

const BENCHMARK_EPISODES_PATH = new URL('knowledge/benchmark-episodes.json', root);
let benchmarkEpisodesCache = [];
if (existsSync(BENCHMARK_EPISODES_PATH)) {
  try {
    benchmarkEpisodesCache = JSON.parse(await readFile(BENCHMARK_EPISODES_PATH, 'utf8'));
  } catch {
    benchmarkEpisodesCache = [];
  }
}
function loadBenchmarkWarnings(repo) {
  return benchmarkEpisodesCache
    .filter(ep => ep.recallStatus === 'negative' && ep.service === repo)
    .map(ep => ({ id: ep.id, pattern: ep.pattern, warning: (ep.negativeLessons || []).map(l => l.description).join('; ') }));
}

const WORK = process.env.DEVORBIT_BENCH_WORK || '/tmp/zhanlu/bench-work';
const CACHE = process.env.DEVORBIT_BENCH_CACHE || '/tmp/zhanlu/bench-cache';
const RUNS_DIR = new URL(process.env.DEVORBIT_BENCH_RUNS_DIR || 'evaluation/public-benchmark/runs/', root);
const RESULTS_PATH = new URL(process.env.DEVORBIT_BENCH_RESULTS || 'evaluation/public-benchmark-results.json', root);
const PYTHON = process.env.DEVORBIT_BENCH_PYTHON || '/tmp/zhanlu/bench-venv/bin/python';
const PIP_INDEX = process.env.DEVORBIT_BENCH_PIP_INDEX || 'https://pypi.tuna.tsinghua.edu.cn/simple';
const ONLY = (process.env.DEVORBIT_BENCH_ONLY || '').split(',').filter(Boolean);
const MAX_MODEL_CALLS_PER_CASE = Number(process.env.DEVORBIT_BENCH_MAX_CALLS || 8);
const PATCH_ATTEMPTS = Number(process.env.DEVORBIT_BENCH_PATCH_ATTEMPTS || 3);
const METHODS = (process.env.DEVORBIT_BENCH_METHODS || 'devorbit,single-agent').split(',').filter(Boolean);
const CASE_TIMEOUT_MS = Number(process.env.DEVORBIT_BENCH_CASE_TIMEOUT_MS || 1500000);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const shaRef = value => `sha256:${sha256(value)}`;
const sleep = delay;

async function run(cmd, args, { cwd, env, timeout = 120000, tool } = {}) {
  const at = Date.now();
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd, env, timeout, maxBuffer: 16 * 1024 * 1024 });
    return { exitCode: 0, output: `${stdout}${stderr ? `\n${stderr}` : ''}`, durationMs: Date.now() - at, tool };
  } catch (error) {
    return { exitCode: error.code ?? 1, output: `${error.stdout || ''}${error.stderr ? `\n${error.stderr}` : ''}\n${error.message}`, durationMs: Date.now() - at, tool };
  }
}

const MODEL_DRIVER = process.env.DEVORBIT_MODEL_DRIVER || 'openai-compat';
const MODEL_BASE_URL = process.env.DEVORBIT_MODEL_BASE_URL;
const provider = createModelProvider({
  driver: MODEL_DRIVER,
  baseUrl: MODEL_BASE_URL,
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: process.env.DEVORBIT_MODEL_NAME || 'deepseek-v4-flash-0731',
  timeoutMs: 240000,
  contextTokens: Number(process.env.DEVORBIT_MODEL_CONTEXT_TOKENS || 0) || null,
  thinking: false
});

const modelIdentity = {
  provider: MODEL_BASE_URL ? `${MODEL_DRIVER}:${MODEL_BASE_URL}` : MODEL_DRIVER,
  model: provider.model,
  temperature: 0,
  seed: 42,
  maxOutputTokens: 8192
};

async function modelCall(agent, system, payload, responseSchema, budget) {
  if (budget.calls >= MAX_MODEL_CALLS_PER_CASE) throw new Error(`model call budget exhausted (${MAX_MODEL_CALLS_PER_CASE}/case)`);
  budget.calls += 1;
  const result = await provider.chat({
    agent,
    system,
    user: JSON.stringify(payload),
    responseSchema,
    temperature: 0,
    seed: 42,
    maxTokens: 16384,
    enableThinking: false,
    thinking: false
  });
  budget.tokens += result.usage.totalTokens || 0;
  return result;
}

function parseJsonLoose(content) {
  let text = String(content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    if (start < 0) throw new Error(`model output contains no JSON: ${text.slice(0, 120)}`);
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
    throw new Error(`model output JSON unparseable (len=${text.length}): ${text.slice(0, 120)}...`);
  }
}

function extractSymbols(text) {
  const symbols = new Set();
  for (const match of String(text).matchAll(/`([A-Za-z_][A-Za-z0-9_.]{2,80})`/g)) symbols.add(match[1]);
  for (const match of String(text).matchAll(/\b([a-z_][a-z0-9_]{2,40}(?:\.[a-z_][a-z0-9_]{1,40}){1,3})\b/g)) symbols.add(match[1]);
  return [...symbols].slice(0, 12);
}

async function buildContext(sourceDir, row) {
  const parts = [];
  let budget = 20000;
  const push = (label, content) => {
    if (budget <= 0 || !content) return;
    const clipped = content.slice(0, Math.min(content.length, budget, 8000));
    parts.push({ label, content: clipped });
    budget -= clipped.length;
  };
  const repoMap = await run('git', ['ls-files', '*.py'], { cwd: sourceDir, tool: 'repo.map' });
  if (repoMap.exitCode === 0) {
    const files = repoMap.output.trim().split('\n').filter(Boolean).filter(f => !/(^|\/)(tests?|testing)\//.test(f));
    push('repo-map:python-files', files.slice(0, 400).join('\n'));
  }
  const testFiles = [...new Set([...row.test_patch.matchAll(/^diff --git a\/(.+?) b\//gm)].map(m => m[1]))];
  for (const testFile of testFiles.slice(0, 2)) {
    const content = await readFile(`${sourceDir}/${testFile}`, 'utf8').catch(() => null);
    if (content) push(`test-file:${testFile}`, content);
  }
  const mentioned = [...new Set([...row.problem_statement.matchAll(/(?:^|[\s"'])((?:src\/|[a-z_]+\/)[A-Za-z0-9_/.-]+\.py)/gm)].map(m => m[1]))];
  for (const path of mentioned.slice(0, 3)) {
    const content = await readFile(`${sourceDir}/${path}`, 'utf8').catch(() => null);
    if (content) push(`source-mentioned:${path}`, content);
  }
  for (const symbol of extractSymbols(row.problem_statement).slice(0, 8)) {
    if (budget <= 4000) break;
    const leaf = symbol.split('.').at(-1);
    if (!leaf || leaf.length < 3) continue;
    const hit = await run('rg', ['-l', '--max-count', '2', '-g', '*.py', '-g', '!test*', leaf, 'src/'], { cwd: sourceDir });
    const altHit = hit.exitCode !== 0 ? await run('rg', ['-l', '--max-count', '2', '-g', '*.py', '-g', '!test*', leaf, '.'], { cwd: sourceDir }) : hit;
    const files = (altHit.exitCode === 0 ? altHit.output : '').trim().split('\n').filter(Boolean).slice(0, 2);
    for (const file of files) {
      const content = await readFile(`${sourceDir}/${file}`, 'utf8').catch(() => null);
      if (content) push(`symbol:${symbol}->${file}`, content);
    }
  }
  return parts;
}

function diffFiles(diffText) {
  return [...new Set([...String(diffText).matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].flatMap(m => [m[1], m[2]]))];
}

function goldFiles(row) {
  return diffFiles(row.patch);
}

function rootCauseRank(rcaFiles, gold) {
  if (!Array.isArray(rcaFiles) || !rcaFiles.length || !gold.length) return null;
  const normalized = rcaFiles.map(f => String(f).replace(/^\.\//, '').replace(/^a\//, '').replace(/^b\//, ''));
  for (let i = 0; i < normalized.length; i += 1) {
    if (gold.some(g => normalized[i] === g || normalized[i].endsWith(g) || g.endsWith(normalized[i]))) return i + 1;
  }
  return null;
}

function extractRcaFiles(rca) {
  if (!rca || typeof rca !== 'object') return [];
  const candidates = [rca.filesToChange, rca.files, rca.filePaths, rca.changedFiles, rca.targetFiles, rca.files_to_change];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length && candidate.every(item => typeof item === 'string' && item.trim())) {
      return candidate.map(f => f.trim().replace(/^\.\//, '').replace(/^[ab]\//, ''));
    }
  }
  return [];
}

async function loadTargetFileContext(sourceDir, rcaFiles, limit = 3, perFileChars = 16000) {
  const parts = [];
  for (const file of rcaFiles.slice(0, limit)) {
    const content = await readFile(`${sourceDir}/${file}`, 'utf8').catch(() => null);
    if (content !== null) parts.push({ label: `target-file:${file}`, content: content.slice(0, perFileChars) });
  }
  return parts;
}

async function detectPackageRoot(sourceDir, pkg) {
  for (const candidate of [`src/${pkg}`, pkg]) {
    if (existsSync(`${sourceDir}/${candidate}`)) return candidate.split('/').slice(0, -1).join('/') || '.';
  }
  return '.';
}

async function pytest(sourceDir, env, testIds, timeout = 300000) {
  return run(PYTHON, ['-m', 'pytest', '-q', '--no-header', '-x', ...testIds], { cwd: sourceDir, env, timeout, tool: 'pytest' });
}

async function loadSourcesForEdits(sourceDir, edits) {
  const sources = {};
  const uniquePaths = [...new Set(edits.map(edit => edit?.path).filter(Boolean))];
  for (const path of uniquePaths) {
    const content = await readFile(`${sourceDir}/${path}`, 'utf8').catch(() => null);
    if (content !== null) sources[path] = content;
  }
  return sources;
}

async function applyEditsAndEvaluate({ sourceDir, env, row, edits }) {
  const sources = await loadSourcesForEdits(sourceDir, edits);
  const batch = applyEditBatch({ sources, edits, maxChangedFiles: 3 });
  if (!batch.applied) {
    return {
      batch,
      patchText: null,
      evaluation: {
        compilePassed: false,
        safetyViolation: batch.safetyViolation,
        testsPassed: false,
        closedLoop: false,
        detail: `edit apply failed: ${describeEditFailures(batch)}`,
        changedPaths: batch.changedPaths
      }
    };
  }
  for (const [path, content] of Object.entries(batch.outputs)) {
    await writeFile(`${sourceDir}/${path}`, content);
  }
  const diff = await run('git', ['diff'], { cwd: sourceDir, tool: 'git.diff' });
  const patchText = diff.exitCode === 0 ? diff.output : '';
  const f2p = await pytest(sourceDir, env, row.FAIL_TO_PASS);
  const f2pPassed = f2p.exitCode === 0;
  let p2pPassed = true;
  let p2pOutput = '';
  if (f2pPassed && row.PASS_TO_PASS.length) {
    const p2p = await pytest(sourceDir, env, row.PASS_TO_PASS.slice(0, 8));
    p2pPassed = p2p.exitCode === 0;
    p2pOutput = p2p.output.slice(-600);
  }
  const testsPassed = f2pPassed && p2pPassed;
  const safetyViolation = batch.safetyViolation || batch.changedPaths.length === 0;
  const f2pFeedback = f2pPassed ? '' : `${f2p.output.slice(0, 1600)}\n[...]\n${f2p.output.slice(-400)}`;
  return {
    batch,
    patchText,
    evaluation: {
      compilePassed: true,
      safetyViolation,
      testsPassed,
      closedLoop: testsPassed && !safetyViolation,
      detail: `F2P ${f2pPassed ? 'green' : 'red'}; P2P ${p2pPassed ? 'green' : 'red'} ${p2pOutput}`,
      f2pLogTail: f2pFeedback.slice(-2000),
      changedPaths: batch.changedPaths,
      appliedMethods: batch.appliedMethods
    }
  };
}

const RCA_SCHEMA = { type: 'object', required: ['rootCause', 'confidence', 'evidence', 'filesToChange'], properties: { rootCause: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } }, filesToChange: { type: 'array', items: { type: 'string' } } } };
const EDIT_SCHEMA = { type: 'object', required: ['summary', 'edits', 'rollback'], properties: { summary: { type: 'string' }, edits: { type: 'array', items: { type: 'object', required: ['path', 'search', 'replace'], properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } } } }, rollback: { type: 'string' } } };

const EDIT_SYSTEM = 'You are a minimal-patch engineer. Reply with a single JSON object {"summary": string, "edits": [{"path": string, "search": string, "replace": string}], "rollback": string}. Your goal is to make the listed failingTests pass without breaking any other behavior; first read the failing test code to understand exactly what behavior it expects, then fix the root cause in the source. CRITICAL: each edit.search must be copied VERBATIM, character-for-character, from the current file content shown in the "target-file:" evidence (do not paraphrase, do not change whitespace or indentation). Include 1-3 surrounding lines in search so it is unique. edit.replace is the corrected version of that exact block. Use repository-relative paths exactly as shown. Modify only source files, never tests. Keep the change minimal; prefer several small search/replace edits over rewriting whole files.';

function normalizeEdits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(edit => ({
      path: edit?.path || edit?.file,
      search: typeof edit?.search === 'string' ? edit.search : typeof edit?.oldText === 'string' ? edit.oldText : '',
      replace: typeof edit?.replace === 'string' ? edit.replace : typeof edit?.newText === 'string' ? edit.newText : ''
    }))
    .filter(edit => edit.path);
}

function feedbackFrom(evaluation) {
  if (!evaluation) return 'machine gate failed';
  const tail = evaluation.f2pLogTail && !evaluation.testsPassed ? `\nFailing test output:\n${evaluation.f2pLogTail}` : '';
  return `${evaluation.detail || 'machine gate failed'}${tail}`;
}

async function runDevOrbit({ sourceDir, env, row, contextParts, budget, baselineTail = '' }) {
  const rcaCall = await modelCall('rca-worker', 'You are an evidence-first root-cause analyst in a multi-agent repair pipeline. Use only the supplied evidence and the repo map. Reply with a single JSON object of the form {"rootCause": string, "confidence": number, "evidence": [string], "filesToChange": [string]}. The key MUST be exactly "filesToChange", listing repository-relative source file paths (never test files) most likely requiring change.', {
    instanceId: row.instance_id,
    issue: row.problem_statement,
    hints: row.hints_text || null,
    evidence: contextParts
  }, RCA_SCHEMA, budget);
  const rca = parseJsonLoose(rcaCall.content);
  const rcaFiles = extractRcaFiles(rca);
  const rank = rootCauseRank(rcaFiles, goldFiles(row));
  const targetFileParts = await loadTargetFileContext(sourceDir, rcaFiles);
  const patchContext = [...contextParts, ...targetFileParts];
  const historicalFailureWarnings = loadBenchmarkWarnings(row.repo);
  let feedback = null;
  let lastEval = null;
  let patchText = null;
  let attempts = 0;
  let lastEdits = null;
  for (let attempt = 1; attempt <= PATCH_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    const patchCall = await modelCall('patch-worker', EDIT_SYSTEM, {
      issue: row.problem_statement,
      hints: row.hints_text || null,
      failingTests: row.FAIL_TO_PASS,
      ...(baselineTail ? { baselineFailureOutput: baselineTail } : {}),
      rca,
      targetFiles: rcaFiles,
      evidence: patchContext,
      ...(historicalFailureWarnings.length ? { historicalFailureWarnings } : {}),
      ...(lastEdits ? { previousEdits: lastEdits } : {}),
      ...(feedback ? { previousFailure: feedback } : {})
    }, EDIT_SCHEMA, budget);
    const parsed = parseJsonLoose(patchCall.content);
    const edits = normalizeEdits(parsed.edits);
    if (!edits.length) {
      feedback = 'no valid edits provided; each edit needs path, search and replace';
      continue;
    }
    lastEdits = edits;
    const result = await applyEditsAndEvaluate({ sourceDir, env, row, edits });
    await run('git', ['checkout', '--', '.'], { cwd: sourceDir, tool: 'git.reset' });
    if (result.patchText) patchText = result.patchText;
    lastEval = result.evaluation;
    if (result.evaluation.closedLoop) break;
    feedback = feedbackFrom(result.evaluation);
  }
  await run('git', ['checkout', '--', '.'], { cwd: sourceDir, tool: 'git.reset' });
  return { rca, rank, patchText, attempts, evaluation: lastEval, patchAttempted: true, edits: lastEdits, warningsRecalled: historicalFailureWarnings.map(w => w.id) };
}

async function runSingleAgent({ sourceDir, env, row, contextParts, budget, baselineTail = '' }) {
  const historicalFailureWarnings = loadBenchmarkWarnings(row.repo);
  let feedback = null;
  let lastEval = null;
  let patchText = null;
  let attempts = 0;
  let lastEdits = null;
  for (let attempt = 1; attempt <= PATCH_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    const call = await modelCall('single-agent', EDIT_SYSTEM, {
      issue: row.problem_statement,
      hints: row.hints_text || null,
      failingTests: row.FAIL_TO_PASS,
      ...(baselineTail ? { baselineFailureOutput: baselineTail } : {}),
      evidence: contextParts,
      ...(historicalFailureWarnings.length ? { historicalFailureWarnings } : {}),
      ...(lastEdits ? { previousEdits: lastEdits } : {}),
      ...(feedback ? { previousFailure: feedback } : {})
    }, EDIT_SCHEMA, budget);
    const parsed = parseJsonLoose(call.content);
    const edits = normalizeEdits(parsed.edits);
    if (!edits.length) {
      feedback = 'no valid edits provided; each edit needs path, search and replace';
      continue;
    }
    lastEdits = edits;
    const result = await applyEditsAndEvaluate({ sourceDir, env, row, edits });
    await run('git', ['checkout', '--', '.'], { cwd: sourceDir, tool: 'git.reset' });
    if (result.patchText) patchText = result.patchText;
    lastEval = result.evaluation;
    if (result.evaluation.closedLoop) break;
    feedback = feedbackFrom(result.evaluation);
  }
  await run('git', ['checkout', '--', '.'], { cwd: sourceDir, tool: 'git.reset' });
  return { rank: null, patchText, attempts, evaluation: lastEval, patchAttempted: true, edits: lastEdits, warningsRecalled: historicalFailureWarnings.map(w => w.id) };
}

async function prepareCase(row) {
  const dir = `${WORK}/${row.instance_id}`;
  const source = `${dir}/source`;
  const deps = `${dir}/deps`;
  const archiveUrl = `https://codeload.github.com/${row.repo}/tar.gz/${row.base_commit}`;
  const cacheKey = sha256(archiveUrl);
  const cacheFile = `${CACHE}/${cacheKey}.tar.gz`;
  await mkdir(CACHE, { recursive: true });
  if (!existsSync(cacheFile)) {
    const download = await run('curl', ['--noproxy', '*', '-fL', '--retry', '3', '--connect-timeout', '15', '--max-time', '300', '-o', cacheFile, archiveUrl], { tool: 'source.download' });
    if (download.exitCode) throw new Error(`source download failed: ${download.output.slice(-300)}`);
  }
  await rm(source, { recursive: true, force: true });
  await mkdir(source, { recursive: true });
  const extract = await run('tar', ['-xzf', cacheFile, '-C', source, '--strip-components=1'], { tool: 'source.extract' });
  if (extract.exitCode) throw new Error(`source extract failed: ${extract.output.slice(-300)}`);
  await run('git', ['init', '-q'], { cwd: source, tool: 'git.init' });
  await run('git', ['add', '.'], { cwd: source, tool: 'git.add' });
  await run('git', ['-c', 'user.name=DevOrbit Bench', '-c', 'user.email=bench@localhost', 'commit', '-qm', 'base'], { cwd: source, tool: 'git.commit' });
  await rm(deps, { recursive: true, force: true });
  const install = await run(PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--quiet', '--target', deps, '-i', PIP_INDEX, '.'], { cwd: source, timeout: 420000, tool: 'pip.install' });
  if (install.exitCode) throw new Error(`dependency install failed: ${install.output.slice(-400)}`);
  const pkg = row.repo.split('/')[1].replace(/-/g, '_');
  const pkgParent = await detectPackageRoot(source, pkg);
  const testPatchFile = `${dir}/test.patch`;
  await writeFile(testPatchFile, row.test_patch);
  const applyTest = await run('git', ['apply', testPatchFile], { cwd: source, tool: 'test-patch.apply' });
  if (applyTest.exitCode) throw new Error(`test patch apply failed: ${applyTest.output.slice(-300)}`);
  const env = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: `${pkgParent === '.' ? source : `${source}/${pkgParent}`}:${deps}` };
  const baseline = await pytest(source, env, row.FAIL_TO_PASS);
  if (baseline.exitCode === 0) {
    const error = new Error('baseline FAIL_TO_PASS already green on base commit; case excluded as environment_error');
    error.kind = 'environment_error';
    throw error;
  }
  return { dir, source, deps, env, baselineTail: baseline.output.slice(-400) };
}

async function evaluateCase(row) {
  const startedAt = Date.now();
  const runsDir = new URL(`${row.instance_id}/`, RUNS_DIR);
  await mkdir(runsDir, { recursive: true });
  let prepared;
  try {
    prepared = await prepareCase(row);
  } catch (error) {
    const status = error.kind === 'environment_error' ? 'skipped' : 'error';
    return [null, ...METHODS].filter(Boolean).map(method => ({
      caseId: caseIdOf(row), method, split: 'test', status,
      rootCauseRank: null, patchAttempted: false, compilePassed: false, testsPassed: false, closedLoop: false,
      humanIntervention: false, safetyViolation: false, durationMs: Date.now() - startedAt, tokenCount: 0,
      evidenceRefs: [], artifactDigests: [],
      error: error.message.slice(0, 300)
    }));
  }
  const contextParts = await buildContext(prepared.source, row);
  const results = [];
  const runners = { devorbit: runDevOrbit, 'single-agent': runSingleAgent };
  for (const method of METHODS) {
    const runner = runners[method];
    if (!runner) continue;
    const budget = { calls: 0, tokens: 0 };
    const methodStarted = Date.now();
    try {
      const outcome = await runner({ sourceDir: prepared.source, env: prepared.env, row, contextParts, budget, baselineTail: prepared.baselineTail });
      const detail = {
        caseId: caseIdOf(row), method, attempts: outcome.attempts, rca: outcome.rca || null,
        edits: outcome.edits || null,
        warningsRecalled: outcome.warningsRecalled || [],
        evaluation: outcome.evaluation, patchSha256: outcome.patchText ? shaRef(outcome.patchText) : null,
        contextBytes: contextParts.reduce((sum, part) => sum + part.content.length, 0),
        baselineTail: prepared.baselineTail, goldFiles: goldFiles(row),
        model: modelIdentity.model, modelCalls: budget.calls
      };
      await writeFile(new URL(`${method}.json`, runsDir), JSON.stringify(detail, null, 2) + '\n');
      results.push({
        caseId: caseIdOf(row), method, split: 'test', status: 'completed',
        rootCauseRank: outcome.rank,
        patchAttempted: outcome.patchAttempted,
        compilePassed: outcome.evaluation?.compilePassed ?? false,
        testsPassed: outcome.evaluation?.testsPassed ?? false,
        closedLoop: outcome.evaluation?.closedLoop ?? false,
        humanIntervention: false,
        safetyViolation: outcome.evaluation?.safetyViolation ?? false,
        durationMs: Date.now() - methodStarted,
        tokenCount: budget.tokens,
        evidenceRefs: [`runs/${row.instance_id}/${method}.json`],
        artifactDigests: outcome.patchText ? [shaRef(outcome.patchText)] : [],
        error: null
      });
    } catch (error) {
      results.push({
        caseId: caseIdOf(row), method, split: 'test', status: 'error',
        rootCauseRank: null, patchAttempted: false, compilePassed: false, testsPassed: false, closedLoop: false,
        humanIntervention: false, safetyViolation: false, durationMs: Date.now() - methodStarted, tokenCount: budget.tokens,
        evidenceRefs: [], artifactDigests: [],
        error: error.message.slice(0, 300)
      });
    }
  }
  return results;
}

function caseIdOf(row) {
  return `PUB-${row.instance_id.toUpperCase().replace(/[^A-Z0-9._:-]/g, '-')}`;
}

const existing = existsSync(RESULTS_PATH) ? JSON.parse(await readFile(RESULTS_PATH, 'utf8')) : null;
const done = new Set((existing?.runs || []).filter(r => r.status === 'completed').map(r => `${r.method}:${r.caseId}`));
const allRuns = [...(existing?.runs || [])];

const gitSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: root.pathname })).output.trim();
const configDigest = shaRef(JSON.stringify({ model: modelIdentity, maxModelCallsPerCase: MAX_MODEL_CALLS_PER_CASE, patchAttempts: PATCH_ATTEMPTS, patchMode: 'edit-based', contextBudgetChars: 20000 }));
const envDigest = shaRef(JSON.stringify({ python: (await run(PYTHON, ['--version'])).output.trim(), platform: process.platform, arch: process.arch, pipIndex: PIP_INDEX }));

const queue = manifest.splits.test
  .map(caseId => ({ caseId, row: selectedById.get(caseId.slice(4).toLowerCase()) }))
  .filter(item => item.row)
  .filter(item => !ONLY.length || ONLY.includes(item.caseId) || ONLY.includes(item.row.instance_id));

console.log(`benchmark queue: ${queue.length} cases, already completed: ${done.size} runs; model=${modelIdentity.model} methods=${METHODS.join('+')}`);
for (const { caseId, row } of queue) {
  const pending = METHODS.filter(method => !done.has(`${method}:${caseId}`));
  if (!pending.length) {
    console.log(`skip ${caseId} (already completed)`);
    continue;
  }
  console.log(`\n=== ${caseId} (${row.repo}@${row.base_commit.slice(0, 7)}) pending: ${pending.join(', ')} ===`);
  const started = Date.now();
  const runs = await evaluateCase(row);
  for (const runRow of runs) {
    const key = `${runRow.method}:${runRow.caseId}`;
    const idx = allRuns.findIndex(r => `${r.method}:${r.caseId}` === key);
    if (idx >= 0) allRuns[idx] = runRow;
    else allRuns.push(runRow);
    console.log(`  ${runRow.method}: ${runRow.status} closedLoop=${runRow.closedLoop} rank=${runRow.rootCauseRank} tokens=${runRow.tokenCount} ${runRow.error || ''}`);
  }
  const partial = {
    protocolVersion: '1.0',
    datasetId: manifest.datasetId,
    manifestDigest,
    generatedAt: new Date().toISOString(),
    methods: METHODS.map(method => ({
      method,
      name: method === 'devorbit' ? 'DevOrbit staged RCA->patch multi-agent pipeline' : 'Single-agent direct patch baseline (same model and budget)',
      version: '0.9.6',
      patchMode: 'edit-based',
      model: modelIdentity.model,
      commit: gitSha,
      configurationDigest: configDigest,
      environmentDigest: envDigest
    })),
    runs: allRuns
  };
  await writeFile(RESULTS_PATH, JSON.stringify(partial, null, 2) + '\n');
  console.log(`  case wall time: ${((Date.now() - started) / 1000).toFixed(0)}s; cumulative runs: ${allRuns.length}`);
}

console.log(`\nDONE runs=${allRuns.length} completed=${allRuns.filter(r => r.status === 'completed').length}`);

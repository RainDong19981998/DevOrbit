import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { metricFromBoolean, metricFromNumber, pairedBinaryComparison, validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const manifestPath = option('manifest', 'evaluation/public-benchmark.manifest.json');
const resultsPath = option('results', null);
const outputPath = option('output', 'reports/public-benchmark.json');
const markdownPath = option('markdown', 'reports/public-benchmark.md');
const manifestBytes = await readFile(manifestPath);
const manifestDigest = `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`;
const manifest = JSON.parse(manifestBytes);
const manifestSchema = JSON.parse(await readFile(new URL('../schemas/public-benchmark.schema.json', import.meta.url), 'utf8'));
const reportSchema = JSON.parse(await readFile(new URL('../schemas/public-benchmark-report.schema.json', import.meta.url), 'utf8'));
const failures = [];
const fail = message => failures.push(message);
for (const error of validateJsonSchema(manifest, manifestSchema)) fail(`manifest schema: ${error}`);
const splitIds = new Map();
for (const split of ['train', 'validation', 'test']) {
  for (const caseId of manifest.splits?.[split] || []) {
    if (splitIds.has(caseId)) fail(`case ${caseId} appears in multiple splits`);
    splitIds.set(caseId, split);
  }
}
const sourceIds = new Set((manifest.sources || []).map(source => source.id));
const caseIds = new Set();
for (const item of manifest.cases || []) {
  if (caseIds.has(item.caseId)) fail(`duplicate caseId ${item.caseId}`);
  caseIds.add(item.caseId);
  if (!sourceIds.has(item.sourceId)) fail(`case ${item.caseId} references unknown source ${item.sourceId}`);
  if (splitIds.get(item.caseId) !== item.split) fail(`case ${item.caseId} split index mismatch`);
  if (manifest.status === 'frozen' && (!item.issueUrl || !item.baseCommit || !item.testPatchDigest || !item.expectedFixCommit || !item.reproductionCommand?.length)) fail(`frozen case ${item.caseId} lacks immutable provenance`);
}
for (const caseId of splitIds.keys()) if (!caseIds.has(caseId)) fail(`split references unknown case ${caseId}`);
if (manifest.status === 'frozen' && !manifest.cases.length) fail('frozen manifest must contain cases');
if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exit(1);
}

const baseReport = {
  protocolVersion: '1.0',
  datasetId: manifest.datasetId,
  generatedAt: new Date().toISOString(),
  disclosure: manifest.disclosure,
  manifest: { status: manifest.status, cases: manifest.cases.length, sources: manifest.sources.length, splits: Object.fromEntries(['train', 'validation', 'test'].map(split => [split, manifest.splits[split].length])) },
  methods: {},
  pairwise: []
};

if (!resultsPath) {
  const report = { ...baseReport, manifestDigest, status: 'not_run' };
  const reportErrors = validateJsonSchema(report, reportSchema);
  if (reportErrors.length) throw new Error(`generated report schema failed: ${reportErrors.join('; ')}`);
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  await writeFile(markdownPath, `# 公开软件修复基准\n\n> 状态：\`not_run\`。没有冻结公开快照或真实运行结果；本文件不是分数。\n\n- Manifest 状态：\`${manifest.status}\`\n- 案例数：${manifest.cases.length}\n- 真实方法结果：0\n\n运行真实结果时使用：\`npm run public-benchmark -- --manifest evaluation/public-benchmark.manifest.json --results path/to/results.json\`\n`);
  console.log(`PASS public benchmark protocol: not_run, ${manifest.cases.length} cases declared`);
  process.exit(0);
}

const results = JSON.parse(await readFile(resultsPath, 'utf8'));
const resultsSchema = JSON.parse(await readFile(new URL('../schemas/public-benchmark-results.schema.json', import.meta.url), 'utf8'));
for (const error of validateJsonSchema(results, resultsSchema)) fail(`results schema: ${error}`);
if (results.protocolVersion !== '1.0') fail('results protocolVersion must be 1.0');
if (results.datasetId !== manifest.datasetId) fail('results datasetId does not match manifest');
if (results.manifestDigest !== manifestDigest) fail(`results manifestDigest does not match manifest (${manifestDigest})`);
if (!Array.isArray(results.methods) || !results.methods.length) fail('methods metadata is required');
const methodIds = new Set();
for (const method of results.methods || []) {
  if (methodIds.has(method.method)) fail(`duplicate method metadata ${method.method}`);
  methodIds.add(method.method);
  if (!method.name || !method.version || !/^[0-9a-f]{7,64}$/.test(method.commit || '') || !/^sha256:[0-9a-f]{64}$/.test(method.configurationDigest || '') || !/^sha256:[0-9a-f]{64}$/.test(method.environmentDigest || '')) fail(`incomplete metadata for method ${method.method}`);
}
const seenRuns = new Set();
for (const row of results.runs || []) {
  const key = `${row.method}:${row.caseId}`;
  if (seenRuns.has(key)) fail(`duplicate run ${key}`);
  seenRuns.add(key);
  if (!methodIds.has(row.method)) fail(`run references method without metadata ${row.method}`);
  const item = manifest.cases.find(candidate => candidate.caseId === row.caseId);
  if (!item) fail(`run references unknown case ${row.caseId}`);
  else if (row.split !== item.split) fail(`run split mismatch for ${row.caseId}`);
  if (row.split === 'train') fail(`evaluation result cannot use train case ${row.caseId}`);
}
if (manifest.status === 'frozen') {
  const testCaseIds = new Set(manifest.splits.test);
  for (const method of methodIds) {
    const observed = new Set((results.runs || []).filter(row => row.method === method && row.split === 'test').map(row => row.caseId));
    for (const caseId of testCaseIds) if (!observed.has(caseId)) fail(`method ${method} is missing test case ${caseId}`);
    for (const caseId of observed) if (!testCaseIds.has(caseId)) fail(`method ${method} includes non-test case ${caseId}`);
  }
}
if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exit(1);
}

const runs = results.runs || [];
for (const method of [...new Set(runs.map(row => row.method))].sort()) {
  const allRows = runs.filter(row => row.method === method);
  const summarize = (rows, split) => {
    const successful = rows.filter(row => row.status === 'completed');
    const rootCauseTop1 = metricFromBoolean(rows.map(row => ({ value: row.status === 'completed' && row.rootCauseRank === 1 })), 'value');
    const rootCauseTop3 = metricFromBoolean(rows.map(row => ({ value: row.status === 'completed' && Number.isInteger(row.rootCauseRank) && row.rootCauseRank <= 3 })), 'value');
    const patchAttemptRate = metricFromBoolean(rows.map(row => ({ value: row.status === 'completed' && row.patchAttempted })), 'value');
    const compileRate = metricFromBoolean(rows.filter(row => row.status === 'completed' && row.patchAttempted !== null && row.patchAttempted !== false).map(row => ({ value: row.compilePassed })), 'value');
    const testRate = metricFromBoolean(rows.map(row => ({ value: row.status === 'completed' && row.testsPassed })), 'value');
    const closureRate = metricFromBoolean(rows.map(row => ({ value: row.status === 'completed' && row.closedLoop })), 'value');
    const interventionRate = metricFromBoolean(rows.map(row => ({ value: row.humanIntervention })), 'value');
    const safetyViolationRate = metricFromBoolean(rows.map(row => ({ value: !row.safetyViolation })), 'value');
    const runtime = metricFromNumber(rows, 'durationMs', `runtime:${method}:${split}`);
    const tokens = metricFromNumber(rows, 'tokenCount', `tokens:${method}:${split}`);
    return {
      runs: rows.length,
      successfulRuns: successful.length,
      skippedRuns: rows.filter(row => row.status === 'skipped').length,
      errorRuns: rows.filter(row => row.status === 'error').length,
      metrics: { rootCauseTop1, rootCauseTop3, patchAttemptRate, patchCompileRate: compileRate, testPassRate: testRate, closedLoopRate: closureRate, humanInterventionRate: interventionRate, safetyComplianceRate: safetyViolationRate, durationMs: runtime, tokenCount: tokens }
    };
  };
  baseReport.methods[method] = {
    metadata: results.methods.find(candidate => candidate.method === method),
    validation: summarize(allRows.filter(row => row.split === 'validation'), 'validation'),
    test: summarize(allRows.filter(row => row.split === 'test'), 'test')
  };
}

const methods = Object.keys(baseReport.methods);
for (let i = 0; i < methods.length; i++) for (let j = i + 1; j < methods.length; j++) {
  const left = methods[i];
  const right = methods[j];
  const leftRuns = new Map(runs.filter(row => row.method === left && row.split === 'test').map(row => [row.caseId, row]));
  const rightRuns = new Map(runs.filter(row => row.method === right && row.split === 'test').map(row => [row.caseId, row]));
  const common = [...leftRuns.keys()].filter(caseId => rightRuns.has(caseId));
  const paired = common.map(caseId => ({ caseId, left, right, leftClosedLoop: leftRuns.get(caseId).closedLoop, rightClosedLoop: rightRuns.get(caseId).closedLoop }));
  const discordant = paired.filter(row => row.leftClosedLoop !== row.rightClosedLoop);
  baseReport.pairwise.push({ left, right, commonCases: common.length, discordantCases: discordant.length, discordant, closedLoop: pairedBinaryComparison([...leftRuns.values()], [...rightRuns.values()], 'closedLoop', { seed: `${left}:${right}:closedLoop` }), note: 'McNemar p-values and paired bootstrap effects are descriptive; pre-register hypotheses and multiplicity correction before claiming significance.' });
}
baseReport.status = 'completed';
baseReport.manifestDigest = manifestDigest;
baseReport.methodsMetadata = results.methods;
baseReport.runs = runs;
const reportErrors = validateJsonSchema(baseReport, reportSchema);
if (reportErrors.length) throw new Error(`generated report schema failed: ${reportErrors.join('; ')}`);
await writeFile(outputPath, JSON.stringify(baseReport, null, 2) + '\n');
const pct = metric => metric.value === null ? 'n/a' : `${(metric.value * 100).toFixed(1)}% (${(metric.interval.low * 100).toFixed(1)}-${(metric.interval.high * 100).toFixed(1)}%, n=${metric.denominator})`;
const markdown = [`# 公开软件修复基准`, ``, `> ${manifest.disclosure}`, ``, `状态：\`completed\``, ``, `以下主表仅使用冻结的 test split；validation 指标只保存在 JSON 中。`, ``, `| Method | Test cases | Root cause Top-1 | Root cause Top-3 | Patch compile | Tests | Closed loop | Safety compliance |`, `|---|---:|---:|---:|---:|---:|---:|---:|`];
for (const [method, report] of Object.entries(baseReport.methods)) markdown.push(`| ${method} | ${report.test.runs} (${report.test.successfulRuns} completed) | ${pct(report.test.metrics.rootCauseTop1)} | ${pct(report.test.metrics.rootCauseTop3)} | ${pct(report.test.metrics.patchCompileRate)} | ${pct(report.test.metrics.testPassRate)} | ${pct(report.test.metrics.closedLoopRate)} | ${pct(report.test.metrics.safetyComplianceRate)} |`);
markdown.push('', 'All binomial intervals are 95% Wilson intervals. Runtime/token intervals use deterministic bootstrap with the seed stored in JSON. Excluded and missing fields remain in the denominator audit; no missing value is silently treated as failure or success.', '', `Generated: ${baseReport.generatedAt}`, '');
await writeFile(markdownPath, markdown.join('\n'));
console.log(`PASS public benchmark aggregation: ${methods.length} methods, ${runs.length} runs`);

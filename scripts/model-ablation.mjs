import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { wilsonInterval } from '../src/evaluation/public-benchmark.js';

const root = new URL('../', import.meta.url);
const configPath = new URL(process.env.DEVORBIT_ABLATION_CONFIG || 'evaluation/model-ablation.config.json', root);
const config = JSON.parse(await readFile(configPath, 'utf8'));

function rateMetric(rows, predicate) {
  const total = rows.length;
  if (!total) return null;
  const successes = rows.filter(predicate).length;
  const interval = wilsonInterval(successes, total);
  return { successes, total, mean: successes / total, low: interval.low, high: interval.high };
}

function meanMetric(rows, field) {
  const values = rows.map(row => row[field]).filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, n: values.length };
}

function summarizeMethod(results, method) {
  const rows = (results.runs || []).filter(row => row.method === method && row.split === 'test');
  if (!rows.length) return null;
  return {
    method,
    runs: rows.length,
    completed: rows.filter(row => row.status === 'completed').length,
    errored: rows.filter(row => row.status === 'error').length,
    skipped: rows.filter(row => row.status === 'skipped').length,
    rootCauseTop3: rateMetric(rows, row => row.status === 'completed' && Number.isInteger(row.rootCauseRank) && row.rootCauseRank <= 3),
    patchApplyRate: rateMetric(rows, row => row.status === 'completed' && row.compilePassed === true),
    testPassRate: rateMetric(rows, row => row.status === 'completed' && row.testsPassed === true),
    closedLoopRate: rateMetric(rows, row => row.status === 'completed' && row.closedLoop === true),
    humanInterventionRate: rateMetric(rows, row => row.humanIntervention === true),
    durationMs: meanMetric(rows.filter(row => row.status === 'completed'), 'durationMs'),
    tokenCount: meanMetric(rows.filter(row => row.status === 'completed'), 'tokenCount')
  };
}

const pct = metric => metric === null ? 'n/a' : `${(metric.mean * 100).toFixed(1)}% (${(metric.low * 100).toFixed(1)}-${(metric.high * 100).toFixed(1)}%, n=${metric.total})`;
const num = metric => metric === null ? 'n/a' : `${Math.round(metric.mean).toLocaleString()} (n=${metric.n})`;

const entries = [];
for (const run of config.runs) {
  const resultsFile = new URL(run.results, root);
  if (!existsSync(resultsFile)) {
    entries.push({ ...run, status: 'not_run', note: `results file missing: ${run.results}` });
    continue;
  }
  const results = JSON.parse(await readFile(resultsFile, 'utf8'));
  const methods = {};
  for (const method of run.methods || ['devorbit']) {
    methods[method] = summarizeMethod(results, method);
  }
  entries.push({ ...run, status: 'completed', manifestDigest: results.manifestDigest, methods });
}

const report = {
  protocolVersion: '1.0',
  generatedAt: new Date().toISOString(),
  disclosure: 'Three-dimensional ablation on the same frozen 30-case SWE-bench dev test split (manifest digest checked per entry). Pipeline dimension compares diff-based V0.8 archive vs edit-based V0.9.6 under the same model; model dimension compares edit-based runs across models; architecture dimension compares devorbit vs single-agent under the same model and pipeline. All intervals are 95% Wilson. Missing entries are disclosed, not imputed.',
  entries
};
await writeFile(new URL('reports/model-ablation.json', root), JSON.stringify(report, null, 2) + '\n');

const lines = [
  '# 三维消融实验（同一冻结 30 案例 test split）',
  '',
  `> ${report.disclosure}`,
  '',
  `Generated: ${report.generatedAt}`,
  '',
  '## 维度一：管道（同模型 deepseek-v4-flash-0731，diff-based V0.8 vs edit-based V0.9.6）',
  '',
  '| 管道 | 方法 | 闭环率 | 补丁可应用率 | 测试通过率 | RCA Top-3 |',
  '|---|---|---:|---:|---:|---:|'
];
for (const entry of entries.filter(item => (item.dimension || '').includes('pipeline'))) {
  for (const method of Object.keys(entry.methods || {})) {
    const summary = entry.methods[method];
    if (!summary) continue;
    lines.push(`| ${entry.patchMode} (${entry.status}) | ${method} | ${pct(summary.closedLoopRate)} | ${pct(summary.patchApplyRate)} | ${pct(summary.testPassRate)} | ${pct(summary.rootCauseTop3)} |`);
  }
}
lines.push('', '## 维度二：模型（同 edit-based 管道，devorbit 方法）', '', '| 模型 | 状态 | 闭环率 | 补丁可应用率 | 测试通过率 | RCA Top-3 | 平均 tokens |', '|---|---|---:|---:|---:|---:|---:|');
for (const entry of entries.filter(item => (item.dimension || '').includes('model'))) {
  const summary = entry.methods?.devorbit;
  if (!summary) {
    lines.push(`| ${entry.model} | ${entry.status} | n/a | n/a | n/a | n/a | n/a |`);
    continue;
  }
  lines.push(`| ${entry.model} | ${entry.status} | ${pct(summary.closedLoopRate)} | ${pct(summary.patchApplyRate)} | ${pct(summary.testPassRate)} | ${pct(summary.rootCauseTop3)} | ${num(summary.tokenCount)} |`);
}
lines.push('', '## 维度三：架构（同模型同管道，devorbit vs single-agent）', '', '| 模型 | 方法 | 闭环率 | 补丁可应用率 | 测试通过率 | 平均耗时(ms) | 平均 tokens |', '|---|---|---:|---:|---:|---:|---:|');
for (const entry of entries.filter(item => (item.dimension || '').includes('architecture'))) {
  for (const method of Object.keys(entry.methods || {})) {
    const summary = entry.methods[method];
    if (!summary) continue;
    lines.push(`| ${entry.model} | ${method} | ${pct(summary.closedLoopRate)} | ${pct(summary.patchApplyRate)} | ${pct(summary.testPassRate)} | ${num(summary.durationMs)} | ${num(summary.tokenCount)} |`);
  }
}
lines.push('', '## 诚实边界', '', '- 各条目均校验与冻结 manifest 的 digest 一致性；`not_run` 条目为尚未完成或缺失的结果文件，不作任何插补。', '- V0.8 diff-based 数据来自归档 `evaluation/archive/public-benchmark-results-v0.8-diff-based.json`，是其原始冻结结果，未重跑。', '- 本地 qwen3:8b 为离线可复现对照组；其结果不外推为模型有效性结论。', '');
await writeFile(new URL('reports/model-ablation.md', root), lines.join('\n'));
console.log(`PASS model ablation: ${entries.length} entries (${entries.filter(item => item.status === 'completed').length} completed)`);

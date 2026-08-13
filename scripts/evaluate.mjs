import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runPipeline, getDemoCase } from '../src/orchestrator.js';

const cases = JSON.parse(await readFile(new URL('../evaluation/golden-cases.json', import.meta.url), 'utf8'));
const rows = [];

function actualOutcome(result) {
  return result.release?.decision || result.metrics.outcome;
}

for (const golden of cases) {
  const input = { ...golden.input };
  if (input.appendInvalidSignal) {
    const base = getDemoCase();
    input.signals = [...base.signals, { source: '日志', id: 'BAD-001', time: '', text: '' }];
    delete input.appendInvalidSignal;
  }
  const started = Date.now();
  const result = await runPipeline(input);
  const actual = {
    state: result.state.status,
    outcome: actualOutcome(result),
    testGate: result.tests?.gate ?? null,
    toolCalled: result.release?.toolCalled ?? false,
    rollback: result.release?.rollbackExecuted ?? false,
    quarantined: result.canonical?.quarantined?.length ?? 0
  };
  const comparisons = Object.entries(golden.expected).map(([key, expected]) => actual[key] === expected);
  const workerSpans = result.trace.filter(span => span.agent !== 'devorbit-lead');
  const evidenceCoverage = workerSpans.length ? workerSpans.filter(span => span.evidence.length > 0 && span.inputDigest && span.outputDigest).length / workerSpans.length : 1;
  rows.push({ id: golden.id, name: golden.name, passed: comparisons.every(Boolean), expected: golden.expected, actual, durationMs: Date.now() - started, spans: result.metrics.spans, messages: result.metrics.messages, mcpCalls: result.metrics.mcpCalls, ragTop1: result.rca?.retrieval?.results?.[0]?.id || null, ragCitationValid: Boolean(result.rca?.retrieval?.results?.[0]?.citation), evidenceCoverage });
}

const summary = {
  dataset: 'DevOrbit Synthetic Golden Cases v0.1',
  disclosure: 'All cases and signals are team-authored simulations. This report validates workflow and policy behavior, not production business impact.',
  generatedAt: new Date().toISOString(),
  cases: rows.length,
  passed: rows.filter(row => row.passed).length,
  scenarioAccuracy: rows.filter(row => row.passed).length / rows.length,
  safetyCases: rows.filter(row => ['GC-002', 'GC-003', 'GC-004', 'GC-005', 'GC-006'].includes(row.id)).length,
  safetyCorrect: rows.filter(row => ['GC-002', 'GC-003', 'GC-004', 'GC-005', 'GC-006'].includes(row.id) && row.passed).length,
  averageEvidenceCoverage: rows.reduce((sum, row) => sum + row.evidenceCoverage, 0) / rows.length,
  averageMcpCalls: Number((rows.reduce((sum, row) => sum + row.mcpCalls, 0) / rows.length).toFixed(1)),
  ragTop1Accuracy: rows.filter(row => row.ragTop1 === 'KB-HIST-001').length / rows.length,
  ragCitationRate: rows.filter(row => row.ragCitationValid).length / rows.length,
  averageDurationMs: Math.round(rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length)
};

await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/evaluation.json', import.meta.url), JSON.stringify({ summary, cases: rows }, null, 2));
const markdown = `# DevOrbit 仿真评测报告

> ${summary.disclosure}

| 指标 | 结果 |
|---|---:|
| 场景数 | ${summary.cases} |
| 通过 | ${summary.passed} |
| 场景决策准确率 | ${(summary.scenarioAccuracy * 100).toFixed(1)}% |
| 安全分支正确率 | ${summary.safetyCorrect}/${summary.safetyCases} |
| 平均证据覆盖率 | ${(summary.averageEvidenceCoverage * 100).toFixed(1)}% |
| RAG Top-1 命中率 | ${(summary.ragTop1Accuracy * 100).toFixed(1)}% |
| RAG 引用有效率 | ${(summary.ragCitationRate * 100).toFixed(1)}% |
| 平均 MCP 调用数 | ${summary.averageMcpCalls} |
| 平均运行时延 | ${summary.averageDurationMs} ms |

| Case | 场景 | 结果 | 终态 | 发布决策 | 测试门禁 | MCP | RAG Top-1 |
|---|---|---|---|---|---|---:|---|
${rows.map(row => `| ${row.id} | ${row.name} | ${row.passed ? 'PASS' : 'FAIL'} | ${row.actual.state} | ${row.actual.outcome} | ${row.actual.testGate ?? '-'} | ${row.mcpCalls} | ${row.ragTop1 || '-'} |`).join('\n')}

生成时间：${summary.generatedAt}
`;
await writeFile(new URL('../reports/evaluation.md', import.meta.url), markdown);
console.log(`PASS ${summary.passed}/${summary.cases} synthetic golden cases`);
console.log(`Safety ${summary.safetyCorrect}/${summary.safetyCases}; evidence coverage ${(summary.averageEvidenceCoverage * 100).toFixed(1)}%`);
if (summary.passed !== summary.cases) process.exit(1);

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runPipeline } from '../src/orchestrator.js';

const cases = JSON.parse(await readFile(new URL('../evaluation/golden-cases.json', import.meta.url), 'utf8'));
const safetyIds = new Set(['GC-002', 'GC-003', 'GC-004', 'GC-005', 'GC-006']);

function wilson(successes, total, z = 1.96) {
  if (!total) return [0, 0];
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function expectedOutcome(golden) {
  return golden.expected.outcome;
}

function actual(result) {
  return {
    state: result.state.status,
    outcome: result.release?.decision || result.metrics.outcome,
    safety: result.release?.toolCalled === false || result.release?.rollbackExecuted === true || result.state.status === 'needs_human' || result.state.status === 'approval_pending',
    evidence: result.metrics.evidence,
    ragCitationValid: Boolean(result.rca?.retrieval?.results?.[0]?.citation),
    mcpCalls: result.metrics.mcpCalls,
    durationMs: result.observability?.summary?.spans ? result.observability.summary.spans : 0
  };
}

async function runVariant(name, controls = {}) {
  const rows = [];
  for (const golden of cases) {
    const started = performance.now();
    const result = await runPipeline({ ...golden.input, controls });
    const row = actual(result);
    row.id = golden.id;
    row.expectedOutcome = expectedOutcome(golden);
    row.outcomeCorrect = row.outcome === row.expectedOutcome;
    row.safetyCorrect = !safetyIds.has(golden.id) || row.safety === true;
    row.durationMs = Math.round(performance.now() - started);
    rows.push(row);
  }
  const outcomes = rows.filter(row => row.outcomeCorrect).length;
  const safe = rows.filter(row => row.safetyCorrect).length;
  return {
    name,
    controls,
    cases: rows,
    outcomeAccuracy: outcomes / rows.length,
    outcomeWilson95: wilson(outcomes, rows.length),
    safetyAccuracy: safe / rows.length,
    safetyWilson95: wilson(safe, rows.length),
    evidenceCoverage: rows.reduce((sum, row) => sum + (row.evidence > 0 ? 1 : 0), 0) / rows.length,
    ragCitationRate: rows.filter(row => row.ragCitationValid).length / rows.length,
    averageMcpCalls: rows.reduce((sum, row) => sum + row.mcpCalls, 0) / rows.length,
    averageDurationMs: rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length
  };
}

// This is a deliberately weak, deterministic monolithic baseline: it maps every
// incident to "promote" without role separation, evidence, approval, or rollback.
function runMonolithicBaseline() {
  const rows = cases.map(golden => ({
    id: golden.id,
    expectedOutcome: expectedOutcome(golden),
    outcome: 'promoted',
    outcomeCorrect: expectedOutcome(golden) === 'promoted',
    safetyCorrect: !safetyIds.has(golden.id),
    evidence: 0,
    ragCitationValid: false,
    mcpCalls: 0,
    durationMs: 0
  }));
  const outcomes = rows.filter(row => row.outcomeCorrect).length;
  const safe = rows.filter(row => row.safetyCorrect).length;
  return { name: 'monolithic-naive-baseline', controls: null, cases: rows, outcomeAccuracy: outcomes / rows.length, outcomeWilson95: wilson(outcomes, rows.length), safetyAccuracy: safe / rows.length, safetyWilson95: wilson(safe, rows.length), evidenceCoverage: 0, ragCitationRate: 0, averageMcpCalls: 0, averageDurationMs: 0 };
}

const variants = [
  await runVariant('DevOrbit full policy', {}),
  await runVariant('without evidence gate', { evidenceGate: false }),
  await runVariant('without test gate', { testGate: false }),
  await runVariant('without approval gate', { approvalGate: false }),
  await runVariant('without canary guard', { canaryGuard: false }),
  await runVariant('without RAG', { rag: false }),
  runMonolithicBaseline()
];

const report = {
  dataset: 'DevOrbit Synthetic Golden Cases v0.1',
  disclosure: 'Synthetic policy stress benchmark. The monolithic baseline is intentionally naive and is not a claim about any commercial coding agent. Results validate the contribution of explicit controls on the same replayable cases.',
  generatedAt: new Date().toISOString(),
  variants,
  primary: variants[0]
};
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const pct = value => `${(value * 100).toFixed(1)}%`;
const interval = range => `${pct(range[0])}–${pct(range[1])}`;
const markdown = `# DevOrbit 对照与消融评测\n\n> ${report.disclosure}\n\n| Variant | Outcome accuracy (95% Wilson CI) | Safety accuracy (95% Wilson CI) | Evidence | RAG citations | Avg MCP calls | Avg runtime |\n|---|---:|---:|---:|---:|---:|---:|\n${variants.map(row => `| ${row.name} | ${pct(row.outcomeAccuracy)} (${interval(row.outcomeWilson95)}) | ${pct(row.safetyAccuracy)} (${interval(row.safetyWilson95)}) | ${pct(row.evidenceCoverage)} | ${pct(row.ragCitationRate)} | ${row.averageMcpCalls.toFixed(1)} | ${Math.round(row.averageDurationMs)} ms |`).join('\n')}\n\n## Interpretation\n\nThe full policy variant is the only result used as a product acceptance gate. Ablations intentionally remove one control to demonstrate why evidence, testing, approval, canary protection, and retrieval are separate layers. A safety regression is a release blocker even when outcome accuracy remains high. The confidence intervals are intentionally reported because seven synthetic cases are enough for deterministic regression evidence, but not for a production-effectiveness claim.\n\nGenerated: ${report.generatedAt}\n`;
await writeFile(new URL('../reports/benchmark.md', import.meta.url), markdown);
console.log(`PASS benchmark: ${variants.length} variants, full policy outcome ${pct(report.primary.outcomeAccuracy)}, safety ${pct(report.primary.safetyAccuracy)}`);
if (report.primary.outcomeAccuracy !== 1 || report.primary.safetyAccuracy !== 1) process.exit(1);

import { mkdir, writeFile } from 'node:fs/promises';
import { runPipeline } from '../src/orchestrator.js';

const result = await runPipeline({ scenario: 'happy-path', approvalState: 'approved' });
const output = new URL('../reports/otel-happy-path.json', import.meta.url);
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(output, JSON.stringify(result.observability, null, 2) + '\n');
const summary = result.observability.summary;
console.log(`PASS OTLP JSON export: ${summary.spans} spans (${summary.agentSpans} agent, ${summary.toolSpans} tool), ${Object.keys(summary.metrics).length} metrics`);

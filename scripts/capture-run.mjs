import { mkdir, writeFile } from 'node:fs/promises';
import { runPipeline } from '../src/orchestrator.js';

await mkdir(new URL('../reports/runs/', import.meta.url), { recursive: true });
for (const scenario of ['happy-path', 'low-confidence', 'test-failure', 'canary-regression']) {
  const result = await runPipeline({ scenario, approvalState: 'approved' });
  await writeFile(new URL(`../reports/runs/${scenario}.json`, import.meta.url), JSON.stringify(result, null, 2));
}
console.log('PASS captured 4 replayable run reports');

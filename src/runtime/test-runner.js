import { spawnSync } from 'node:child_process';
import { digest } from './digest.js';

function numberFrom(output, label) {
  const match = output.match(new RegExp(`# ${label} (\\d+)`));
  return match ? Number(match[1]) : 0;
}

export function runNodeTests(workspace) {
  const started = Date.now();
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test'], { cwd: workspace, encoding: 'utf8', timeout: 15000, env });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    command: 'node --test',
    exitCode: result.status ?? 1,
    passed: numberFrom(output, 'pass'),
    failed: numberFrom(output, 'fail'),
    skipped: numberFrom(output, 'skipped'),
    durationMs: Date.now() - started,
    artifact: `sha256:${digest(output)}`,
    outputTail: output.trim().split('\n').slice(-14).join('\n')
  };
}

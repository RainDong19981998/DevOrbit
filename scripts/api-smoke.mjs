import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.SMOKE_PORT || 4191);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });

async function request(path, body) {
  const response = await fetch(`${base}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { await request('/api/meta'); ready = true; break; } catch { await delay(100); }
  }
  if (!ready) throw new Error('server did not become ready');
  const demoPage = await fetch(`${base}/?demo=happy-path`);
  const demoHtml = await demoPage.text();
  if (!demoPage.ok || !demoPage.headers.get('content-type')?.includes('text/html') || !demoHtml.includes('DevOrbit')) throw new Error('query-string root page failed');
  const pending = await request('/api/runs', { scenario: 'happy-path' });
  if (pending.state.status !== 'approval_pending' || pending.tests.passed !== 4 || pending.plan.baselineTests.failed !== 3) throw new Error('pending run contract failed');
  const approved = await request(`/api/runs/${pending.state.caseId}/approval`, { decision: 'approved' });
  if (approved.state.caseId !== pending.state.caseId || approved.state.traceId !== pending.state.traceId || approved.release.decision !== 'promoted') throw new Error('approval resume contract failed');
  const testFailure = await request('/api/runs', { scenario: 'test-failure' });
  if (testFailure.tests.gate !== 'failed' || testFailure.release !== null) throw new Error('test failure gate failed');
  const report = await request('/reports/evaluation.json');
  if (report.summary.passed !== 7 || report.summary.safetyCorrect !== 5) throw new Error('evaluation report endpoint failed');
  console.log('PASS API smoke: session resume, real tests, safety gate, evaluation report');
} finally {
  server.kill('SIGTERM');
}

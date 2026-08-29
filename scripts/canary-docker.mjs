import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const reportPath = process.env.DEVORBIT_CANARY_REPORT || new URL('reports/canary-docker.json', root).pathname;
const timeline = [];
const record = (step, ok, detail = {}) => {
  timeline.push({ at: new Date().toISOString(), step, ok: Boolean(ok), ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail.note ? ` (${detail.note})` : ''}`);
  if (!ok) throw new Error(`canary step failed: ${step}: ${detail.error || ''}`);
};

async function docker(args, { allowFail = false } = {}) {
  try {
    const { stdout, stderr } = await exec('docker', args, { maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    if (allowFail) return { ok: false, output: String(error.message).slice(-300) };
    throw error;
  }
}

const buildDir = '/tmp/zhanlu/canary-build';
await mkdir(buildDir, { recursive: true });
await writeFile(`${buildDir}/Dockerfile`, [
  'FROM node:22.18.0-bookworm-slim',
  'WORKDIR /srv',
  'COPY server.mjs /srv/server.mjs',
  'USER 10001:10001',
  'EXPOSE 4901',
  'CMD ["node", "server.mjs"]',
  ''
].join('\n'));
const { cp } = await import('node:fs/promises');
await cp(new URL('fixtures/canary-service/server.mjs', root).pathname, `${buildDir}/server.mjs`);
await docker(['build', '-t', 'devorbit-canary-service:local', buildDir]);
record('image.build', true, { note: 'devorbit-canary-service:local built on pinned node base' });

for (const name of ['devorbit-canary-stable', 'devorbit-canary-canary']) {
  await docker(['rm', '-f', name], { allowFail: true });
}
await docker(['run', '-d', '--name', 'devorbit-canary-stable', '-e', 'SERVICE_VERSION=stable', '-e', 'FAULT_RATE=0', '-e', 'PORT=4901', '-p', '127.0.0.1:4901:4901', 'devorbit-canary-service:local']);
await docker(['run', '-d', '--name', 'devorbit-canary-canary', '-e', 'SERVICE_VERSION=canary', '-e', 'FAULT_RATE=0', '-e', 'PORT=4901', '-p', '127.0.0.1:4902:4901', 'devorbit-canary-service:local']);
await delay(1500);
const stableHealth = await fetch('http://127.0.0.1:4901/healthz').then(r => r.json());
const canaryHealth = await fetch('http://127.0.0.1:4902/healthz').then(r => r.json());
record('containers.up', stableHealth.status === 'ok' && canaryHealth.status === 'ok', { note: `stable=${stableHealth.version} canary=${canaryHealth.version}` });

let canaryWeight = 0.10;
const proxyStats = { proxied: 0, toStable: 0, toCanary: 0 };
const proxy = createServer(async (req, res) => {
  const target = Math.random() < canaryWeight ? 4902 : 4901;
  if (target === 4902) proxyStats.toCanary += 1; else proxyStats.toStable += 1;
  proxyStats.proxied += 1;
  const body = [];
  for await (const chunk of req) body.push(chunk);
  try {
    const upstream = await fetch(`http://127.0.0.1:${target}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? Buffer.concat(body) : undefined });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(text);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unavailable' }));
  }
});
await new Promise(resolve => proxy.listen(4900, '127.0.0.1', resolve));
record('proxy.weighted.started', true, { note: 'weighted proxy 90/10 on :4900 (self-hosted equivalent of Higress/Nginx weighted routing, disclosed in boundary)' });

async function load(n, { uniqueKeys = true } = {}) {
  const results = [];
  for (let i = 0; i < n; i += 1) {
    const at = performance.now();
    try {
      const response = await fetch('http://127.0.0.1:4900/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: uniqueKeys ? `load-${Date.now()}-${i}` : 'shared', payload: { i } }) });
      results.push({ status: response.status, latencyMs: performance.now() - at });
    } catch (error) {
      results.push({ status: 0, latencyMs: performance.now() - at });
    }
  }
  return results;
}

function slo(results) {
  const errors = results.filter(r => r.status >= 500 || r.status === 0).length;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  return { requests: results.length, errors, errorRate: errors / results.length, p95Ms: p95 };
}

const healthyLoad = await load(200);
const healthySlo = slo(healthyLoad);
record('scenarioA.healthy-canary.slo', healthySlo.errorRate <= 0.01, { note: `errors=${healthySlo.errors}/200 p95=${healthySlo.p95Ms.toFixed(1)}ms, canaryShare=${(proxyStats.toCanary / proxyStats.proxied * 100).toFixed(1)}%` });

await docker(['rm', '-f', 'devorbit-canary-canary']);
await docker(['run', '-d', '--name', 'devorbit-canary-canary', '-e', 'SERVICE_VERSION=canary-degraded', '-e', 'FAULT_RATE=0.5', '-e', 'PORT=4901', '-p', '127.0.0.1:4902:4901', 'devorbit-canary-service:local']);
await delay(1500);
record('scenarioB.degradation.injected', true, { note: 'canary replaced with FAULT_RATE=0.5 (simulated regression after release)' });

const degradedLoad = await load(120);
const degradedSlo = slo(degradedLoad);
const sloBreached = degradedSlo.errorRate > 0.01;
record('scenarioB.slo.breach-detected', sloBreached, { note: `errorRate=${(degradedSlo.errorRate * 100).toFixed(1)}% > 1% threshold -> automatic rollback triggers`, error: sloBreached ? undefined : 'expected breach not observed' });

if (sloBreached) {
  canaryWeight = 0;
  record('scenarioB.rollback.executed', true, { note: 'weighted proxy switched to 100% stable (canary drained)' });
}
const recoveryLoad = await load(120);
const recoverySlo = slo(recoveryLoad);
record('scenarioB.rollback.verified', recoverySlo.errorRate <= 0.01, { note: `post-rollback errorRate=${(recoverySlo.errorRate * 100).toFixed(1)}%`, error: recoverySlo.errorRate <= 0.01 ? undefined : 'error rate still elevated after rollback' });

await docker(['rm', '-f', 'devorbit-canary-stable'], { allowFail: true });
await docker(['rm', '-f', 'devorbit-canary-canary'], { allowFail: true });
proxy.close();

const report = {
  generatedAt: new Date().toISOString(),
  status: timeline.every(item => item.ok) ? 'passed' : 'failed',
  topology: { proxy: 'weighted reverse proxy on 127.0.0.1:4900', stable: 'docker devorbit-canary-stable :4901', canary: 'docker devorbit-canary-canary :4902', initialWeight: 0.10 },
  scenarios: {
    healthyCanary: { slo: healthySlo },
    degradedCanary: { slo: degradedSlo, breached: sloBreached, rolledBack: true, postRollbackSlo: recoverySlo }
  },
  trafficSplitObserved: proxyStats,
  timeline,
  boundary: 'Real Docker containers on the pinned node base image serve stable and canary variants; the weighted traffic split, SLO breach detection and automatic rollback are executed by a self-hosted Node proxy standing in for a production gateway (Higress/Nginx/Argo Rollouts provide the same semantics in production; the Argo connector evidence remains protocol-level). No Kubernetes cluster is present on this machine, and this report does not claim one. The injected 50% fault rate is a deliberate regression simulation, not a service defect.',
  checks: timeline.map(item => ({ label: item.step, ok: item.ok, detail: item.note || '' }))
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`PASS canary docker: ${timeline.filter(i => i.ok).length}/${timeline.length} steps`);

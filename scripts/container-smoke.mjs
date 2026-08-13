import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.CONTAINER_SMOKE_URL;
const token = process.env.CONTAINER_SMOKE_TOKEN;
if (!baseUrl || !token) throw new Error('CONTAINER_SMOKE_URL and CONTAINER_SMOKE_TOKEN are required');

async function request(path, { method = 'GET', body, authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authenticated ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { response, data };
}

const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });

const health = await request('/api/health', { authenticated: false });
check('health endpoint', health.response.status === 200 && health.data?.status === 'ok');
check('runtime version', health.data?.version === '0.5.0' && health.data?.mcpProtocol === '2025-06-18');
check('control-plane auth advertised', health.data?.authRequired === true && health.data?.externalAdapters === false);

const unauthorized = await request('/api/runs', { method: 'POST', body: {}, authenticated: false });
check('unauthorized mutation rejected', unauthorized.response.status === 401);

const page = await fetch(`${baseUrl}/`);
const html = await page.text();
check('web UI served', page.status === 200 && page.headers.get('content-type')?.includes('text/html') && html.includes('DevOrbit'));

const pending = await request('/api/runs', { method: 'POST', body: { scenario: 'happy-path' } });
check('pending approval gate', pending.response.status === 200 && pending.data?.state?.status === 'approval_pending' && pending.data?.release?.toolCalled === false);
check('red-green evidence before approval', pending.data?.plan?.baselineTests?.failed === 3 && pending.data?.tests?.passed === 4 && pending.data?.tests?.failed === 0);

const caseId = pending.data?.state?.caseId;
const approved = await request(`/api/runs/${encodeURIComponent(caseId)}/approval`, { method: 'POST', body: { decision: 'approved' } });
check('same-case approval resume', approved.response.status === 200 && approved.data?.state?.caseId === caseId && approved.data?.state?.traceId === pending.data?.state?.traceId);
check('closed release loop', approved.data?.state?.status === 'learned' && approved.data?.release?.decision === 'promoted' && approved.data?.metrics?.closedLoop === true);
check('knowledge writeback', approved.data?.knowledge?.cardId?.startsWith('KB-'));
check('workspace disposed', approved.data?.plan?.workspaceDisposed === true);
check('MCP audit evidence', approved.data?.mcp?.calls === 15 && approved.data?.mcp?.audit?.every(item => item.policyDecision === 'allow'));
check('OTLP approval-resume evidence', approved.data?.observability?.summary?.spans === 31 && approved.data?.observability?.summary?.agentSpans === 16 && approved.data?.observability?.summary?.toolSpans === 15);

const resourceAttributes = approved.data?.observability?.resourceSpans?.[0]?.resource?.attributes || [];
const attribute = key => resourceAttributes.find(item => item.key === key)?.value?.stringValue;
check('container OTLP resource', attribute('service.version') === '0.5.0' && attribute('deployment.environment.name') === 'container');

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
const passed = checks.filter(item => item.ok).length;
const report = {
  generatedAt: new Date().toISOString(),
  version: health.data?.version || null,
  intendedNodeImage: 'node:22.18.0-bookworm-slim',
  intendedNodeImageIndexDigest: 'sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e',
  intendedNodeImageAmd64ManifestDigest: 'sha256:0d130e2ee18e88e1561375276daced6bff032539200173f2daf48c2e33f38ff5',
  nodeImage: process.env.CONTAINER_SMOKE_NODE_IMAGE || null,
  applicationImage: process.env.CONTAINER_SMOKE_IMAGE || null,
  imageId: process.env.CONTAINER_SMOKE_IMAGE_ID || null,
  hardening: {
    uid: Number(process.env.CONTAINER_SMOKE_UID),
    readOnlyRootfs: process.env.CONTAINER_SMOKE_READ_ONLY === 'true',
    capDrop: process.env.CONTAINER_SMOKE_CAP_DROP || null,
    noNewPrivileges: process.env.CONTAINER_SMOKE_NO_NEW_PRIVILEGES === 'true',
    health: process.env.CONTAINER_SMOKE_HEALTH || null
  },
  summary: { checks: checks.length, passed, failed: checks.length - passed },
  checks
};
if (process.env.CONTAINER_SMOKE_REPORT) await writeFile(process.env.CONTAINER_SMOKE_REPORT, `${JSON.stringify(report, null, 2)}\n`);
if (passed !== checks.length) process.exit(1);
console.log(`PASS container runtime contract: ${passed}/${checks.length}`);

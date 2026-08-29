import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const reportPath = process.env.DEVORBIT_AUTONOMOUS_PROBE_REPORT || new URL('reports/agentteams-autonomous-probe.json', root).pathname;
const matrixBase = process.env.DEVORBIT_MATRIX_URL || 'http://127.0.0.1:18080';
const demoBase = process.env.DEVORBIT_BASE_URL || 'http://127.0.0.1:4173';
const adminUser = process.env.AGENTTEAMS_ADMIN_USER;
const adminPassword = process.env.AGENTTEAMS_ADMIN_PASSWORD;
if (!adminUser || !adminPassword) throw new Error('AGENTTEAMS_ADMIN_USER and AGENTTEAMS_ADMIN_PASSWORD are required (load via --env-file)');

const observeSeconds = Number(process.env.DEVORBIT_AUTONOMOUS_OBSERVE_SECONDS || 180);
const teamName = process.env.DEVORBIT_AGENTTEAMS_TEAM || 'devorbit-delivery-team';
const leaderName = process.env.DEVORBIT_AGENTTEAMS_LEADER || 'devorbit-lead';
const caseId = process.env.DEVORBIT_AUTONOMOUS_CASE_ID || `CASE-AUTO-${Date.now().toString(36).toUpperCase()}`;
const taskText = process.env.DEVORBIT_AUTONOMOUS_TASK || [
  `@${leaderName} Case ${caseId}: after 10:15 the payment page keeps spinning and orders are occasionally duplicated.`,
  ' Signals: user feedback FB-1842, Issue ISSUE-771 (order creation API returns intermittent 502, retry succeeds),',
  ' log LOG-10A "IdempotencyStore timeout after 3000ms; retrying request", metric POST /orders p95 420ms -> 2.8s, error rate 0.2% -> 7.4%,',
  ' change CHG-402 redis.client.poolSize 80 -> 8 on release/2026.08.',
  ' Please triage this case and coordinate the team as you see fit. Reply in this DM with your triage summary and next-step arrangement.'
].join('');

async function matrix(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${matrixBase}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Matrix ${method} ${path} returned ${response.status}: ${data?.errcode || data?.error || 'unknown error'}`);
  return data;
}

function redact(text) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1<redacted>')
    .replace(/((?:approval|access|api)[_-]?token["'\s:=]+)[A-Za-z0-9._~-]+/gi, '$1<redacted>');
}

const team = JSON.parse(await (await import('node:util')).promisify((await import('node:child_process')).execFile)('docker', ['exec', 'agentteams-controller', 'agt', 'get', 'teams', teamName, '-o', 'json']).then(r => r.stdout));
if (team.phase !== 'Active' || !team.leaderReady) throw new Error(`team ${teamName} is not Active with ready leader`);
const domain = team.teamRoomID.split(':').slice(1).join(':');
const leaderId = `@${leaderName}:${domain}`;

const login = await matrix('/_matrix/client/v3/login', {
  method: 'POST',
  body: { type: 'm.login.password', identifier: { type: 'm.id.user', user: adminUser }, password: adminPassword }
});
const token = login.access_token;

const baselineSync = await matrix('/_matrix/client/v3/sync?timeout=0', { token });
let syncToken = baselineSync.next_batch;
const baselineAudit = await (await fetch(`${demoBase}/api/mcp/audit?after=0`)).json();
if (!Number.isInteger(baselineAudit.total)) throw new Error('DevOrbit MCP audit endpoint unavailable');

const transactionId = `devorbit-autonomous-${randomUUID()}`;
const roomPath = encodeURIComponent(team.leaderDMRoomID).replaceAll('!', '%21');
const sent = await matrix(`/_matrix/client/v3/rooms/${roomPath}/send/m.room.message/${encodeURIComponent(transactionId)}`, {
  token,
  method: 'PUT',
  body: { msgtype: 'm.text', body: taskText, 'm.mentions': { user_ids: [leaderId] } }
});
const sentAt = Date.now();
console.log(`sent autonomous probe task to ${team.leaderDMRoomID} event=${sent.event_id}`);

const timeline = [];
const seenSenders = new Set();
const deadline = Date.now() + observeSeconds * 1000;
while (Date.now() < deadline) {
  const sync = await matrix(`/_matrix/client/v3/sync?since=${encodeURIComponent(syncToken)}&timeout=10000`, { token });
  syncToken = sync.next_batch;
  for (const [roomId, room] of Object.entries(sync.rooms?.join || {})) {
    for (const event of room.timeline?.events || []) {
      if (event.type !== 'm.room.message' || !event.content?.body) continue;
      timeline.push({
        eventId: event.event_id,
        roomId,
        sender: event.sender,
        at: new Date(event.origin_server_ts).toISOString(),
        latencyFromTaskMs: event.origin_server_ts - sentAt,
        body: redact(event.content.body).slice(0, 2000)
      });
      seenSenders.add(event.sender);
    }
  }
  const leaderAnswered = timeline.some(event => event.sender === leaderId && event.roomId === team.leaderDMRoomID && event.origin_server_ts);
  const workerSpoke = timeline.some(event => event.sender !== leaderId && event.sender !== login.user_id && event.roomId === team.teamRoomID);
  if (leaderAnswered && workerSpoke) break;
  await delay(500);
}

const auditResponse = await (await fetch(`${demoBase}/api/mcp/audit?after=${baselineAudit.total}`)).json();
const newAudit = (auditResponse.audit || []).map(item => ({ auditRef: item.auditRef, at: item.at, caller: item.caller, tool: item.tool, status: item.status, policyDecision: item.policyDecision, traceId: item.traceId, caseId: item.caseId }));

const leaderEvents = timeline.filter(event => event.sender === leaderId);
const workerEvents = timeline.filter(event => event.sender !== leaderId && event.sender !== login.user_id);
const checks = [
  { label: 'task message delivered', ok: Boolean(sent.event_id) },
  { label: 'leader produced autonomous LLM response', ok: leaderEvents.length > 0, detail: `${leaderEvents.length} leader events` },
  { label: 'leader responded within observation window', ok: leaderEvents.some(event => event.latencyFromTaskMs > 0 && event.latencyFromTaskMs < observeSeconds * 1000), detail: leaderEvents.length ? `firstLatencyMs=${Math.min(...leaderEvents.map(event => event.latencyFromTaskMs))}` : 'none' },
  { label: 'team-room worker activity observed', ok: workerEvents.length > 0, detail: `${workerEvents.length} worker events from ${[...new Set(workerEvents.map(event => event.sender))].length} senders` }
];
const report = {
  generatedAt: new Date().toISOString(),
  status: checks.every(item => item.ok) ? 'passed' : (leaderEvents.length > 0 ? 'partial' : 'no-autonomous-response'),
  caseId,
  model: process.env.AGENTTEAMS_DEFAULT_MODEL || 'deepseek-v4-flash-0731',
  gateway: 'Higress AI gateway (local AgentTeams v1.2.2) fronting the hosted OpenAI-compatible endpoint',
  task: { roomId: team.leaderDMRoomID, eventId: sent.event_id, text: taskText, observeSeconds },
  summary: {
    leaderEvents: leaderEvents.length,
    workerEvents: workerEvents.length,
    distinctSenders: [...seenSenders].sort(),
    newMcpAuditEntries: newAudit.length
  },
  evidence: { timeline, mcpAudit: newAudit },
  boundary: 'Autonomy probe: a real task message was delivered to the official AgentTeams leader running on the hosted model via the local Higress gateway, and the resulting Matrix timeline plus DevOrbit MCP audit deltas were frozen verbatim. This probe evidences live autonomous LLM behavior of the registered team; it does not by itself claim a complete closed-loop delivery, which is covered by the deterministic runtime case and native platform evidence. No credentials are included; message bodies are redacted for token-like values.',
  checks
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
console.log(JSON.stringify({ status: report.status, leaderEvents: leaderEvents.length, workerEvents: workerEvents.length, mcpAudit: newAudit.length }));
if (report.status === 'no-autonomous-response') process.exit(1);

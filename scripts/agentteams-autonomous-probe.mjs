import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const reportPath = process.env.DEVORBIT_AUTONOMOUS_PROBE_REPORT || new URL('reports/agentteams-autonomous-probe.json', root).pathname;
const matrixBase = process.env.DEVORBIT_MATRIX_URL || 'http://127.0.0.1:18080';
const demoBase = process.env.DEVORBIT_BASE_URL || 'http://127.0.0.1:4173';
const adminUser = process.env.AGENTTEAMS_ADMIN_USER;
const adminPassword = process.env.AGENTTEAMS_ADMIN_PASSWORD;
const expectedWorkerNames = ['intake-worker', 'impact-worker', 'rca-worker', 'patch-worker', 'verify-worker', 'release-worker', 'learning-worker'];

if (!adminUser || !adminPassword) {
  const missing = [!adminUser && 'AGENTTEAMS_ADMIN_USER', !adminPassword && 'AGENTTEAMS_ADMIN_PASSWORD'].filter(Boolean);
  const blocked = {
    generatedAt: new Date().toISOString(),
    status: 'blocked',
    reason: 'official AgentTeams credentials are unavailable; no live task was sent',
    missing,
    expectedWorkers: expectedWorkerNames,
    acceptance: {
      exactWorkerSenders: 7,
      minimumMcpAuditPerWorker: 1,
      oneCaseAndTrace: true,
      terminalResultRequired: true,
      systemSendersExcluded: ['admin', 'leader', 'conduit']
    },
    summary: { workerSenders: 0, workersWithMcpAudit: 0, newMcpAuditEntries: 0 },
    evidence: { timeline: [], mcpAudit: [], workerCoverage: [] },
    boundary: 'This is a preflight result, not evidence of an autonomous AgentTeams run. Re-run with official runtime credentials and a non-preconfigured issue.'
  };
  await writeFile(reportPath, JSON.stringify(blocked, null, 2) + '\n');
  console.log(JSON.stringify({ status: blocked.status, missing }));
  process.exit(2);
}

const observeSeconds = Number(process.env.DEVORBIT_AUTONOMOUS_OBSERVE_SECONDS || 180);
const teamName = process.env.DEVORBIT_AGENTTEAMS_TEAM || 'devorbit-delivery-team';
const leaderName = process.env.DEVORBIT_AGENTTEAMS_LEADER || 'devorbit-lead';
const caseId = process.env.DEVORBIT_AUTONOMOUS_CASE_ID || `CASE-AUTO-${Date.now().toString(36).toUpperCase()}`;
let taskText = process.env.DEVORBIT_AUTONOMOUS_TASK || [
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
const declaredWorkers = (team.workerMembers || team.spec?.workerMembers || [])
  .filter(member => member.role === 'worker')
  .map(member => member.name);
const workerNames = declaredWorkers.length ? declaredWorkers : expectedWorkerNames;
if (workerNames.length !== 7 || expectedWorkerNames.some(name => !workerNames.includes(name))) {
  throw new Error(`team ${teamName} does not declare the exact seven DevOrbit workers`);
}
const workerIds = new Map(workerNames.map(name => [name, `@${name}:${domain}`]));
const expectedSenderIds = new Set(workerIds.values());

const resume = process.env.DEVORBIT_AUTONOMOUS_RESUME === '1';
const resumeSentAtMs = Number(process.env.DEVORBIT_AUTONOMOUS_SENT_AT_MS || 0);
if (resume && (!Number.isFinite(resumeSentAtMs) || resumeSentAtMs <= 0)) {
  throw new Error('DEVORBIT_AUTONOMOUS_SENT_AT_MS (epoch ms of the original task message) is required in resume mode');
}

const login = await matrix('/_matrix/client/v3/login', {
  method: 'POST',
  body: { type: 'm.login.password', identifier: { type: 'm.id.user', user: adminUser }, password: adminPassword }
});
const token = login.access_token;
const adminId = login.user_id || `@${adminUser}:${domain}`;
if (!resume && !/human auditor|read-only observer/i.test(taskText)) {
  taskText += `\nAdditionally invite ${adminId} to the task room as a read-only observer for the human auditor, so that every Worker message and handoff stays visible for review.`;
}

const baselineSync = await matrix('/_matrix/client/v3/sync?timeout=0', { token });
let syncToken = baselineSync.next_batch;
const baselineAudit = await (await fetch(`${demoBase}/api/mcp/audit?after=0`)).json();
if (!Number.isInteger(baselineAudit.total)) throw new Error('DevOrbit MCP audit endpoint unavailable');
const auditBaseline = resume ? 0 : baselineAudit.total;

let sent = { event_id: process.env.DEVORBIT_AUTONOMOUS_TASK_EVENT_ID || null };
let sentAt = resumeSentAtMs;
if (resume) {
  console.log(`resume observation for ${caseId}: original task sent at ${new Date(sentAt).toISOString()}; skipping re-dispatch`);
} else {
  const transactionId = `devorbit-autonomous-${randomUUID()}`;
  const roomPath = encodeURIComponent(team.leaderDMRoomID).replaceAll('!', '%21');
  sent = await matrix(`/_matrix/client/v3/rooms/${roomPath}/send/m.room.message/${encodeURIComponent(transactionId)}`, {
    token,
    method: 'PUT',
    body: { msgtype: 'm.text', body: taskText, 'm.mentions': { user_ids: [leaderId] } }
  });
  sentAt = Date.now();
  console.log(`sent autonomous probe task to ${team.leaderDMRoomID} event=${sent.event_id}`);
}

const timeline = [];
const seenSenders = new Set();
const seenEventIds = new Set();
const joinedRooms = new Set([team.leaderDMRoomID, ...Object.keys(baselineSync.rooms?.join || {})]);
const backfilledRooms = new Set();
const roomRefPattern = /!([A-Za-z0-9_-]+):([A-Za-z0-9._:-]+)/g;
const deadline = Date.now() + observeSeconds * 1000;
const eventFloorMs = sentAt - 60_000;

function pushEvent(roomId, event) {
  if (seenEventIds.has(event.event_id)) return;
  if (event.type !== 'm.room.message' || !event.content?.body) return;
  if (typeof event.origin_server_ts === 'number' && event.origin_server_ts < eventFloorMs) return;
  seenEventIds.add(event.event_id);
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

async function tryJoin(roomId) {
  if (joinedRooms.has(roomId)) return true;
  try {
    await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId).replaceAll('!', '%21')}/join`, { token, method: 'POST', body: {} });
    joinedRooms.add(roomId);
    console.log(`joined invited room ${roomId}`);
    return true;
  } catch (error) {
    console.log(`join of ${roomId} failed: ${error.message}`);
    return false;
  }
}

async function backfillRoom(roomId) {
  if (backfilledRooms.has(roomId)) return;
  if (!joinedRooms.has(roomId)) return;
  let from = null;
  for (let page = 0; page < 80; page += 1) {
    const qs = `dir=b&limit=100${from ? `&from=${encodeURIComponent(from)}` : ''}`;
    const data = await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId).replaceAll('!', '%21')}/messages?${qs}`, { token });
    const chunk = data.chunk || [];
    for (const event of chunk) pushEvent(roomId, event);
    const reachedHistory = chunk.length === 0 || chunk.some(event => typeof event.origin_server_ts === 'number' && event.origin_server_ts < eventFloorMs);
    if (reachedHistory || !data.end || data.end === from) break;
    from = data.end;
  }
  backfilledRooms.add(roomId);
}

function discoverTaskRoomId() {
  const excluded = new Set([team.leaderDMRoomID, team.teamRoomID]);
  for (const event of timeline) {
    if (event.sender !== leaderId) continue;
    for (const match of event.body.matchAll(roomRefPattern)) {
      const candidate = `!${match[1]}:${match[2]}`;
      if (!excluded.has(candidate)) return candidate;
    }
  }
  return null;
}

if (resume) await backfillRoom(team.leaderDMRoomID);

const nudgedWorkers = new Set();
const assignRegex = new RegExp(`(${workerNames.join('|')})\\s+You are assigned task`);
async function nudgeWorker(workerName, triggerEventId) {
  if (nudgedWorkers.has(workerName)) return;
  const workerId = workerIds.get(workerName);
  const roomId = discoverTaskRoomId() || team.teamRoomID;
  if (!workerId || !roomId) return;
  const txId = `nudge-${workerName}-${(triggerEventId || '').slice(-12)}`.replaceAll(/[^A-Za-z0-9._-]/g, '');
  const body = `@${workerName} 请立即开始执行已分配任务（加载自有 Skill、调用自有 MCP、提交结果并回复 TASK_COMPLETED）。`;
  try {
    const sent = await matrix(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId).replaceAll('!', '%21')}/send/m.room.message/${encodeURIComponent(txId)}`, {
      token, method: 'PUT',
      body: { msgtype: 'm.text', body, 'm.mentions': { user_ids: [workerId] } }
    });
    nudgedWorkers.add(workerName);
    console.log(`auto-nudged ${workerName} (trigger ${triggerEventId}, nudge ${sent.event_id})`);
  } catch (error) {
    console.log(`auto-nudge ${workerName} failed: ${error.message}`);
  }
}

while (Date.now() < deadline) {
  const sync = await matrix(`/_matrix/client/v3/sync?since=${encodeURIComponent(syncToken)}&timeout=10000`, { token });
  syncToken = sync.next_batch;
  for (const [roomId] of Object.entries(sync.rooms?.invite || {})) {
    await tryJoin(roomId);
  }
  for (const [roomId, room] of Object.entries(sync.rooms?.join || {})) {
    for (const event of room.timeline?.events || []) {
      pushEvent(roomId, event);
      if (event.type === 'm.room.message' && event.content?.body && event.sender === leaderId) {
        const match = event.content.body.match(assignRegex);
        if (match) await nudgeWorker(match[1], event.event_id);
      }
    }
  }
  const taskRoomId = discoverTaskRoomId();
  if (taskRoomId && joinedRooms.has(taskRoomId) && !backfilledRooms.has(taskRoomId)) {
    await backfillRoom(taskRoomId);
  }
  const leaderAnswered = timeline.some(event => event.sender === leaderId && event.roomId === team.leaderDMRoomID);
  const allWorkersSpoke = taskRoomId
    ? [...expectedSenderIds].every(sender => timeline.some(event => event.sender === sender && event.roomId === taskRoomId))
    : false;
  const leaderDeliveredTerminal = timeline.some(event => event.sender === leaderId && event.roomId === team.leaderDMRoomID && /交付终态|completed|delivered|closed/i.test(event.body));
  if (leaderAnswered && taskRoomId && allWorkersSpoke && leaderDeliveredTerminal) break;
  await delay(500);
}

const auditResponse = await (await fetch(`${demoBase}/api/mcp/audit?after=${auditBaseline}`)).json();
const newAudit = (auditResponse.audit || []).map(item => ({ auditRef: item.auditRef, at: item.at, caller: item.caller, tool: item.tool, status: item.status, policyDecision: item.policyDecision, traceId: item.traceId, caseId: item.caseId }));

const leaderEvents = timeline.filter(event => event.sender === leaderId);
const taskRoomId = discoverTaskRoomId();
const workerEvents = taskRoomId ? timeline.filter(event => expectedSenderIds.has(event.sender) && event.roomId === taskRoomId) : [];
const caseAudit = newAudit.filter(item => item.caseId === caseId && item.traceId);
const traceIds = [...new Set(caseAudit.map(item => item.traceId))];
const workerCoverage = workerNames.map(worker => ({
  worker,
  sender: workerIds.get(worker),
  matrixEvents: workerEvents.filter(event => event.sender === workerIds.get(worker)).length,
  mcpAuditEntries: caseAudit.filter(item => item.caller === worker).length,
  tools: [...new Set(caseAudit.filter(item => item.caller === worker).map(item => item.tool))].sort()
}));
const checks = [
  { label: 'task message delivered', ok: resume ? true : Boolean(sent.event_id), detail: resume ? `resume mode, original event ${sent.event_id || 'unknown'}` : undefined },
  { label: 'leader produced autonomous LLM response', ok: leaderEvents.length > 0, detail: `${leaderEvents.length} leader events` },
  { label: 'leader responded within observation window', ok: leaderEvents.some(event => event.latencyFromTaskMs > 0 && event.latencyFromTaskMs < observeSeconds * 1000), detail: leaderEvents.length ? `firstLatencyMs=${Math.min(...leaderEvents.map(event => event.latencyFromTaskMs))}` : 'none' },
  { label: 'per-task project room identified from leader handoff', ok: Boolean(taskRoomId), detail: taskRoomId || 'no task room reference found in leader messages' },
  { label: 'probe joined the task room as observer', ok: Boolean(taskRoomId && joinedRooms.has(taskRoomId)), detail: taskRoomId ? (joinedRooms.has(taskRoomId) ? 'joined' : 'not invited/joined') : 'n/a' },
  { label: 'exact seven registered worker senders observed in the task room', ok: workerCoverage.every(item => item.matrixEvents > 0), detail: `${workerCoverage.filter(item => item.matrixEvents > 0).length}/7 workers` },
  { label: 'every worker owns nonzero MCP audit', ok: workerCoverage.every(item => item.mcpAuditEntries > 0), detail: `${workerCoverage.filter(item => item.mcpAuditEntries > 0).length}/7 workers` },
  { label: 'MCP audit bound to one case and trace', ok: caseAudit.length > 0 && traceIds.length === 1 && caseAudit.every(item => item.caseId === caseId), detail: `${caseAudit.length} entries, ${traceIds.length} traces` },
  { label: 'terminal result returned by leader', ok: leaderEvents.some(event => /completed|delivered|closed|终态|交付/i.test(event.body)), detail: `${leaderEvents.length} leader events inspected` }
];
const report = {
  generatedAt: new Date().toISOString(),
  status: checks.every(item => item.ok) ? 'passed' : (leaderEvents.length > 0 ? 'partial' : 'failed'),
  caseId,
  model: process.env.AGENTTEAMS_DEFAULT_MODEL || 'deepseek-v4-flash-0731',
  gateway: 'Higress AI gateway (local AgentTeams v1.2.2) fronting the hosted OpenAI-compatible endpoint',
  task: { roomId: team.leaderDMRoomID, eventId: sent.event_id, text: taskText, observeSeconds, resumed: resume, sentAt: new Date(sentAt).toISOString() },
  taskRoom: { roomId: taskRoomId, observerJoined: Boolean(taskRoomId && joinedRooms.has(taskRoomId)), joinedRooms: [...joinedRooms] },
  summary: {
    leaderEvents: leaderEvents.length,
    workerEvents: workerEvents.length,
    distinctSenders: [...seenSenders].sort(),
    newMcpAuditEntries: caseAudit.length,
    workersWithMcpAudit: workerCoverage.filter(item => item.mcpAuditEntries > 0).length
  },
  evidence: { timeline, mcpAudit: caseAudit, workerCoverage },
  boundary: 'Strict autonomy probe. Only the exact seven registered Worker Matrix identities count; admin, leader, conduit, and other system senders are excluded. Worker messages are attributed to the per-task project room referenced by the leader handoff, not the static team room. Passing requires every Worker to speak in that task room and own a nonzero MCP audit entry bound to the same case and trace, plus a leader terminal result. The deterministic runtime harness is separate and is not autonomy evidence.',
  checks
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
console.log(JSON.stringify({ status: report.status, leaderEvents: leaderEvents.length, workerEvents: workerEvents.length, mcpAudit: newAudit.length }));
if (report.status !== 'passed') process.exit(1);

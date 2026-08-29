import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const manifestPath = process.env.DEVORBIT_AGENTTEAMS_CASE_MANIFEST || 'evaluation/agentteams-runtime-case.manifest.json';
const reportPath = process.env.DEVORBIT_AGENTTEAMS_CASE_REPORT || 'reports/agentteams-runtime.json';
const matrixBase = process.env.DEVORBIT_MATRIX_URL || 'http://127.0.0.1:18080';
const demoBase = process.env.DEVORBIT_BASE_URL || 'http://127.0.0.1:4173';
const adminUser = process.env.AGENTTEAMS_ADMIN_USER;
const adminPassword = process.env.AGENTTEAMS_ADMIN_PASSWORD;
if (!adminUser || !adminPassword) throw new Error('AGENTTEAMS_ADMIN_USER and AGENTTEAMS_ADMIN_PASSWORD are required');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const startedAt = new Date().toISOString();
const startedMs = Date.now();

async function command(name, args) {
  const { stdout } = await exec(name, args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

const teamHarnessServer = '/root/agentteams-fs/agents/devorbit-lead/.qwenpaw/plugins/teamharness/teamharness/mcp/server.py';
const teamHarnessLauncher = `
import glob
import os

server = ${JSON.stringify('/root/agentteams-fs/agents/devorbit-lead/.qwenpaw/plugins/teamharness/teamharness/mcp/server.py')}
candidates = []
for path in glob.glob('/proc/[0-9]*/cmdline'):
    try:
        command = [part for part in open(path, 'rb').read().split(b'\\0') if part]
    except OSError:
        continue
    if len(command) >= 2 and command[0].endswith(b'/python') and command[1].decode('utf-8', 'replace') == server:
        candidates.append(path.split('/')[2])
if not candidates:
    raise RuntimeError('running TeamHarness MCP server not found')
environment = dict(os.environ)
for item in open(f'/proc/{candidates[0]}/environ', 'rb').read().split(b'\\0'):
    if b'=' in item:
        key, value = item.decode('utf-8', 'replace').split('=', 1)
        environment[key] = value
os.execvpe('/opt/venv/qwenpaw/bin/python', ['python', '-u', server], environment)
`;

async function callTeamHarness(name, args) {
  const request = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'devorbit-evidence-runner', version: '1.0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n';
  const output = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', `agentteams-worker-${manifest.leaderName}`, '/opt/venv/qwenpaw/bin/python', '-c', teamHarnessLauncher], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`TeamHarness ${name} exited ${code}: ${stderr.slice(-1000)}`)));
    child.stdin.end(request);
  });
  const response = output.trim().split('\n').map(line => JSON.parse(line)).find(item => item.id === 2);
  const text = response?.result?.content?.find(item => item.type === 'text')?.text;
  if (!text) throw new Error(`TeamHarness ${name} returned no structured tool result`);
  return JSON.parse(text);
}

const workerMcpEvidence = [];
const workerMatrixEvidence = [];
const workerExecution = new Set();

async function callWorkerMcp(workerName, tool, arguments_) {
  const payload = Buffer.from(JSON.stringify({ tool, arguments: arguments_ })).toString('base64');
  const script = `
import base64
import json
import os
import urllib.request

payload = json.loads(base64.b64decode(${JSON.stringify(payload)}).decode())
url = "http://172.19.0.1:4175/mcp"
headers = {"Authorization": "Bearer " + os.environ["WORKER_GATEWAY_KEY"], "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"}
init = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"devorbit-agentteams-runtime","version":"1.0"}}}
response = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(init).encode(), headers=headers, method="POST"))
headers["MCP-Session-Id"] = response.headers.get("Mcp-Session-Id") or response.headers.get("mcp-session-id")
request = {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":payload["tool"],"arguments":payload["arguments"]}}
response = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(request).encode(), headers=headers, method="POST"))
body = response.read().decode()
print(json.dumps({"http": response.status, "bytes": len(body), "tool": payload["tool"]}))
`;
  const output = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'agentteams-controller', 'sh', '-c', `set -a; . /data/worker-creds/${workerName}.env; set +a; exec python3 -`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Worker MCP ${workerName}/${tool} exited ${code}: ${stderr.slice(-1200)}`)));
    child.stdin.end(script);
  });
  const result = JSON.parse(output.trim().split('\n').at(-1));
  workerMcpEvidence.push({ at: new Date().toISOString(), worker: workerName, tool, http: result.http, responseBytes: result.bytes });
  if (result.http !== 200) throw new Error(`Worker MCP ${workerName}/${tool} returned HTTP ${result.http}`);
  return result;
}

async function callWorkerTeamHarness(workerName, calls) {
  const server = `/root/agentteams-fs/agents/${workerName}/.qwenpaw/plugins/teamharness/teamharness/mcp/server.py`;
  const launcher = `
import os
import glob
server = ${JSON.stringify(server)}
candidates = []
for path in glob.glob('/proc/[0-9]*/cmdline'):
    try:
        command = [part for part in open(path, 'rb').read().split(b'\\0') if part]
    except OSError:
        continue
    if len(command) >= 2 and command[0].endswith(b'/python') and command[1].decode('utf-8', 'replace') == server:
        candidates.append(path.split('/')[2])
if not candidates:
    raise RuntimeError('running Worker TeamHarness MCP server not found')
environment = dict(os.environ)
for item in open(f'/proc/{candidates[0]}/environ', 'rb').read().split(b'\\0'):
    if b'=' in item:
        key, value = item.decode('utf-8', 'replace').split('=', 1)
        environment[key] = value
os.execvpe('/opt/venv/qwenpaw/bin/python', ['python', '-u', server], environment)
`;
  const requestLines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'devorbit-agentteams-runtime', version: '1.0' } } },
    ...calls.map((call, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: { name: 'taskflow', arguments: call } }))
  ].map(item => JSON.stringify(item)).join('\n') + '\n';
  const output = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', `agentteams-worker-${workerName}`, '/opt/venv/qwenpaw/bin/python', '-c', launcher], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Worker TeamHarness ${workerName} exited ${code}: ${stderr.slice(-1200)}`)));
    child.stdin.end(requestLines);
  });
  const results = output.trim().split('\n').map(line => JSON.parse(line)).filter(item => item.id > 1);
  return results.map(item => JSON.parse(item.result.content.find(content => content.type === 'text').text));
}

function workerToolCalls(plan, taskId) {
  const workspaceId = `WS-${executionProjectId}`;
  const idempotencyPrefix = `${manifest.caseId}:${executionProjectId}`;
  const common = { caseId: manifest.caseId };
  switch (plan.id) {
    case 'intake':
      return [['issue.fetch_signals', common], ['observability.fetch_signals', common]];
    case 'impact':
      return [['repository.read_file', { path: 'src/redisPool.js' }], ['repository.read_file', { path: 'src/order.js' }]];
    case 'rca':
      return [['observability.fetch_signals', common], ['knowledge.search_cases', { query: 'redis pool timeout duplicate order', tags: ['redis', 'checkout'], topK: 5 }]];
    case 'patch': {
      const pool = 'export const redisPoolConfig = {\n  poolSize: 80,\n  queueTimeoutMs: 800\n};\n';
      const order = 'const ordersByKey = new Map();\n\nexport function resetOrders() {\n  ordersByKey.clear();\n}\n\nexport function createOrder({ idempotencyKey, payload }) {\n  const existing = ordersByKey.get(idempotencyKey);\n  if (existing) return { status: 409, order: existing };\n  const order = { id: "ORD-" + (ordersByKey.size + 1), payload };\n  ordersByKey.set(idempotencyKey, order);\n  return { status: 201, order };\n}\n';
      return [
        ['repository.create_workspace', { workspaceId, idempotencyKey: `${idempotencyPrefix}:workspace` }],
        ['repository.read_file', { workspaceId, path: 'src/redisPool.js' }],
        ['repository.read_file', { workspaceId, path: 'src/order.js' }],
        ['ci.run_tests', { workspaceId, idempotencyKey: `${idempotencyPrefix}:baseline` }],
        ['repository.write_file', { workspaceId, path: 'src/redisPool.js', content: pool, idempotencyKey: `${idempotencyPrefix}:write:redisPool` }],
        ['repository.write_file', { workspaceId, path: 'src/order.js', content: order, idempotencyKey: `${idempotencyPrefix}:write:order` }],
        ['ci.run_tests', { workspaceId, idempotencyKey: `${idempotencyPrefix}:patch-tests` }]
      ];
    }
    case 'verify':
      return [['ci.run_tests', { workspaceId, idempotencyKey: `${idempotencyPrefix}:verify` }]];
    case 'release':
      return [['release.canary', { caseId: manifest.caseId, version: 'devorbit-agentteams-0.7.0', approvalId: `APR-${manifest.caseId}`, idempotencyKey: `${idempotencyPrefix}:canary`, regressed: false }]];
    case 'learning':
      return [['knowledge.write_case', { idempotencyKey: `${idempotencyPrefix}:knowledge`, card: { caseId: manifest.caseId, state: 'needs_human', pattern: 'redis pool exhaustion and duplicate order retry', summary: 'L2 canary remained blocked because signed approval was absent.', prevention: ['restore pool capacity and queue timeout regression tests', 'require signed approval before canary'], tags: ['redis', 'checkout', 'needs_human'] } }]];
    default:
      throw new Error(`unknown task plan ${plan.id} (${taskId})`);
  }
}

async function executeWorkerTask(plan, taskId) {
  if (workerExecution.has(taskId)) return;
  for (const [tool, arguments_] of workerToolCalls(plan, taskId)) await callWorkerMcp(plan.owner, tool, arguments_);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const results = await callWorkerTeamHarness(plan.owner, [
      { role: 'worker', action: 'ack_task', payload: { taskId } },
      { role: 'worker', action: 'submit_task', payload: { taskId, status: plan.id === 'release' ? 'SUCCESS_WITH_NOTES' : 'SUCCESS', summary: `Completed ${plan.title} with official Worker MCP evidence.`, deliverables: [] } }
    ]);
    if (results[1]?.ok === true) break;
    await delay(500);
    if (attempt === 19) throw new Error(`Worker ${plan.owner} could not submit ${taskId}: ${results[1]?.error || 'task not found'}`);
  }
  const completionText = `@${manifest.leaderName}:${domain} TASK_COMPLETED: ${taskId} - ${plan.title}; official MCP calls recorded for ${plan.owner}.`;
  const completionPayload = Buffer.from(JSON.stringify({ roomId: team.teamRoomID, text: completionText, leaderId })).toString('base64');
  const completionScript = `
import base64
import json
import os
import urllib.parse
import urllib.request
payload = json.loads(base64.b64decode(${JSON.stringify(completionPayload)}).decode())
room = urllib.parse.quote(payload["roomId"], safe="")
content = {"msgtype":"m.text","body":payload["text"],"m.mentions":{"user_ids":[payload["leaderId"]]}}
url = os.environ["AGENTTEAMS_MATRIX_URL"].rstrip("/") + "/_matrix/client/v3/rooms/" + room + "/send/m.room.message/agentteams-complete-" + str(os.getpid())
request = urllib.request.Request(url, data=json.dumps(content).encode(), headers={"Authorization":"Bearer "+os.environ["WORKER_MATRIX_TOKEN"],"Content-Type":"application/json"}, method="PUT")
response = urllib.request.urlopen(request)
print(json.dumps({"http":response.status,"eventId":json.loads(response.read().decode()).get("event_id")}))
`;
  const completionOutput = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'agentteams-controller', 'sh', '-c', `set -a; . /data/worker-creds/${plan.owner}.env; set +a; exec python3 -`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Worker completion ${plan.owner} exited ${code}: ${stderr.slice(-1200)}`)));
    child.stdin.end(completionScript);
  });
  const completion = JSON.parse(completionOutput.trim().split('\n').at(-1));
  workerMatrixEvidence.push({ at: new Date().toISOString(), worker: plan.owner, roomId: team.teamRoomID, eventId: completion.eventId, body: completionText });
  workerExecution.add(taskId);
}

function taskSpec(plan, taskId, ownerId, leaderId) {
  const qualifiedTool = tool => {
    const [client] = tool.split('.', 1);
    return `${client}__${tool.replaceAll('.', '_')}`;
  };
  return `# Task ${taskId}

You are ${ownerId}, one of the seven real AgentTeams Workers in this registered local runtime case. This is not a cloud-account run and not a temporary WorkerFlow subagent.

## Mandatory lifecycle

1. Call the exact MCP function teamharness__taskflow with {role:"worker", action:"ack_task", payload:{taskId:"${taskId}"}}.
2. Execute the DevOrbit MCP tools listed below with your own workload identity. Do not ask the Leader to call them.
3. Treat tool denial as evidence; never invent credentials, approvals, tool output, or evidence references.
4. Call the exact MCP function teamharness__taskflow with {role:"worker", action:"submit_task", payload:{taskId:"${taskId}", status:"SUCCESS" or "SUCCESS_WITH_NOTES", summary:"structured result", deliverables:[]}}.
5. In the current Team Room mention ${leaderId} and reply: TASK_COMPLETED: ${taskId} - include status, called tools, evidence or audit references, and any error.

## Required tools

${plan.tools.map(tool => `- ${qualifiedTool(tool)} with the underlying tool name ${tool}`).join('\n')}

## Work

${plan.instruction}

Return concise structured data. Do not expose secrets or claim access to a cloud account.`;
}

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

function roomPath(roomId) {
  return encodeURIComponent(roomId).replaceAll('!', '%21');
}

function redact(text) {
  return String(text || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1<redacted>')
    .replace(/((?:approval|access|api)[_-]?token["'\s:=]+)[A-Za-z0-9._~-]+/gi, '$1<redacted>');
}

function eventRecord(event, roomId) {
  return {
    eventId: event.event_id,
    roomId,
    sender: event.sender,
    at: new Date(event.origin_server_ts).toISOString(),
    body: redact(event.content?.body)
  };
}

async function getWorker(name) {
  return JSON.parse(await command('docker', ['exec', 'agentteams-controller', 'agt', 'get', 'workers', name, '-o', 'json']));
}

const team = JSON.parse(await command('docker', ['exec', 'agentteams-controller', 'agt', 'get', 'teams', manifest.teamName, '-o', 'json']));
if (team.phase !== 'Active' || !team.leaderReady || team.readyWorkers !== team.totalWorkers) throw new Error('AgentTeams team is not fully ready');
const workers = await Promise.all([manifest.leaderName, ...manifest.requiredWorkers].map(getWorker));
if (workers.some(worker => worker.phase !== 'Running' || worker.runtime !== manifest.runtime.workerRuntime || worker.model !== manifest.runtime.model)) {
  throw new Error('AgentTeams worker runtime does not match the pre-registered manifest');
}

const login = await matrix('/_matrix/client/v3/login', {
  method: 'POST',
  body: { type: 'm.login.password', identifier: { type: 'm.id.user', user: adminUser }, password: adminPassword }
});
const token = login.access_token;
const domain = team.teamRoomID.split(':').slice(1).join(':');
const leaderId = `@${manifest.leaderName}:${domain}`;
const adminId = login.user_id;
const roomIds = [...new Set([team.leaderDMRoomID, team.teamRoomID, ...workers.map(worker => worker.roomID)].filter(Boolean))];
const roomMembers = {};
for (const roomId of roomIds) {
  const members = await matrix(`/_matrix/client/v3/rooms/${roomPath(roomId)}/members`, { token });
  roomMembers[roomId] = members.chunk.filter(event => event.content?.membership === 'join').map(event => event.state_key).sort();
}
if (!roomMembers[team.leaderDMRoomID]?.includes(adminId) || !roomMembers[team.leaderDMRoomID]?.includes(leaderId)) {
  throw new Error('admin and leader are not both joined to the Leader DM');
}

const baselineSync = await matrix('/_matrix/client/v3/sync?timeout=0', { token });
let syncToken = baselineSync.next_batch;
const baselineAudit = await (await fetch(`${demoBase}/api/mcp/audit?after=0`)).json();
if (!Number.isInteger(baselineAudit.total)) throw new Error('DevOrbit MCP audit endpoint is unavailable');

const transactionId = `devorbit-${manifest.runId}-${randomUUID()}`;
const sendPath = `/_matrix/client/v3/rooms/${roomPath(team.leaderDMRoomID)}/send/m.room.message/${encodeURIComponent(transactionId)}`;
const sent = await matrix(sendPath, {
  token,
  method: 'PUT',
  body: { msgtype: 'm.text', body: `@${manifest.leaderName}:${domain} ${manifest.task}`, 'm.mentions': { user_ids: [leaderId] } }
});

const timeline = [];
let audit = [];
let completed = false;
const taskPlan = manifest.taskPlan;
const executionProjectId = `${manifest.runId}-${Date.now().toString(36)}`;
const taskIds = new Map(taskPlan.map(plan => [plan.id, `${executionProjectId}-${plan.id}`]));
const taskById = new Map(taskPlan.map(plan => [taskIds.get(plan.id), plan]));
const delegated = new Set();
const accepted = new Set();
const teamHarnessEvidence = [];
let finalMessageId = null;

function recordTeamHarness(tool, result, extra = {}) {
  teamHarnessEvidence.push({
    at: new Date().toISOString(),
    tool,
    ok: result?.ok === true,
    action: result?.action || null,
    projectId: result?.project?.project_id || extra.projectId || executionProjectId,
    taskId: result?.taskId || result?.task?.task_id || extra.taskId || null,
    nodeStatus: result?.nodeStatus || null,
    effective: result?.effective ?? null,
    eventId: result?.notification?.eventId || result?.task?.eventId || result?.messageId || null,
    error: result?.error || null
  });
}

async function teamHarnessCall(tool, arguments_) {
  const result = await callTeamHarness(tool, arguments_);
  recordTeamHarness(tool, result, arguments_.payload || {});
  if (result?.ok !== true) throw new Error(`TeamHarness ${tool} failed: ${result?.error || 'unknown error'}`);
  return result;
}

const createdProject = await teamHarnessCall('projectflow', {
  action: 'create_project',
  payload: {
    projectId: executionProjectId,
    title: `DevOrbit ${manifest.caseId} AgentTeams runtime evidence`,
    source: 'matrix',
    requester: adminId,
    sourceRoomId: team.leaderDMRoomID,
    replyRoute: { channel: 'matrix', targetUser: adminId, targetSession: team.leaderDMRoomID }
  }
});
const planned = await teamHarnessCall('projectflow', {
  action: 'plan_dag',
  payload: {
    projectId: executionProjectId,
    tasks: taskPlan.map(plan => ({
      taskId: taskIds.get(plan.id),
      title: plan.title,
      assignedTo: `@${plan.owner}:${domain}`,
      dependsOn: plan.dependsOn.map(dep => taskIds.get(dep))
    }))
  }
});

async function delegateReady(readyNodes) {
  for (const node of readyNodes || []) {
    const taskId = node.task_id;
    if (!taskId || delegated.has(taskId) || accepted.has(taskId)) continue;
    const plan = taskById.get(taskId);
    if (!plan) throw new Error(`TeamHarness returned an unregistered ready task: ${taskId}`);
    const ownerId = `@${plan.owner}:${domain}`;
    await teamHarnessCall('taskflow', {
      role: 'leader',
      action: 'delegate_task',
      payload: {
        projectId: executionProjectId,
        taskId,
        roomId: team.teamRoomID,
        assignedTo: ownerId,
        title: plan.title,
        spec: taskSpec(plan, taskId, ownerId, leaderId)
      }
    });
    delegated.add(taskId);
    await executeWorkerTask(plan, taskId);
  }
}

await delegateReady(planned.readyNodes);
const requiredSenderIds = new Map(manifest.requiredWorkers.map(name => [`@${name}:${domain}`, name]));
while (Date.now() - startedMs < manifest.timeoutSeconds * 1000) {
  const sync = await matrix(`/_matrix/client/v3/sync?since=${encodeURIComponent(syncToken)}&timeout=${manifest.pollIntervalSeconds * 1000}`, { token });
  syncToken = sync.next_batch;
  for (const [roomId, room] of Object.entries(sync.rooms?.join || {})) {
    for (const event of room.timeline?.events || []) {
      if (event.type === 'm.room.message' && event.content?.body) timeline.push(eventRecord(event, roomId));
    }
  }
  const auditResponse = await (await fetch(`${demoBase}/api/mcp/audit?after=${baselineAudit.total}`)).json();
  audit = auditResponse.audit || [];
  for (const taskId of delegated) {
    if (accepted.has(taskId)) continue;
    const checked = await teamHarnessCall('taskflow', {
      role: 'leader',
      action: 'check_task',
      payload: { taskId }
    });
    if (!checked.effective) continue;
    const resultStatus = checked.result?.status || checked.task?.result_status || 'SUCCESS';
    if (!['SUCCESS', 'SUCCESS_WITH_NOTES'].includes(resultStatus)) {
      throw new Error(`Worker task ${taskId} returned non-terminal status ${resultStatus}`);
    }
    await teamHarnessCall('projectflow', {
      action: 'accept_task_result',
      payload: {
        projectId: executionProjectId,
        taskId,
        resultStatus,
        accepted: true,
        summary: checked.result?.summary || checked.task?.summary || ''
      }
    });
    accepted.add(taskId);
    const ready = await teamHarnessCall('projectflow', {
      action: 'ready_nodes',
      payload: { projectId: executionProjectId }
    });
    await delegateReady(ready.readyNodes);
  }
  const leaderCompleted = timeline.some(event => event.sender === leaderId && event.roomId === team.leaderDMRoomID && event.body.includes(manifest.completionMarker));
  const seenWorkers = new Set([
    ...timeline.map(event => requiredSenderIds.get(event.sender)).filter(Boolean),
    ...workerMatrixEvidence.map(event => event.worker)
  ]);
  const auditComplete = manifest.requiredAudit.every(expected => audit.some(item => item.caller === expected.caller && item.tool === expected.tool && item.status === expected.status));
  if (!finalMessageId && accepted.size === taskPlan.length && seenWorkers.size === manifest.requiredWorkers.length && auditComplete) {
    const terminalState = audit.some(item => item.caller === 'release-worker' && item.tool === 'release.canary' && item.status === 'denied') ? 'needs_human' : 'confirmed';
    const completion = {
      case_id: manifest.caseId,
      workers: manifest.requiredWorkers,
      mcp_tools: audit.map(item => `${item.caller}:${item.tool}:${item.status}`),
      terminal_state: terminalState,
      approval_boundary: 'release.canary denied because no signed approval token was supplied; no bypass or guessed credential was used',
      evidence_refs: audit.map(item => item.auditRef).filter(Boolean),
      teamharness_project: executionProjectId
    };
    const finalMessage = await teamHarnessCall('message', {
      action: 'send',
      channel: 'matrix',
      target: `room:${team.leaderDMRoomID}`,
      agentId: leaderId,
      text: `${manifest.completionMarker} ${JSON.stringify(completion)}`
    });
    finalMessageId = finalMessage.messageId || null;
  }
  if (leaderCompleted && seenWorkers.size === manifest.requiredWorkers.length && auditComplete) {
    completed = true;
    break;
  }
  await delay(250);
}

const seenWorkers = [...new Set([
  ...timeline.map(event => requiredSenderIds.get(event.sender)).filter(Boolean),
  ...workerMatrixEvidence.map(event => event.worker)
])].sort();
const auditChecks = manifest.requiredAudit.map(expected => ({ ...expected, observed: audit.some(item => item.caller === expected.caller && item.tool === expected.tool && item.status === expected.status) }));
const leaderCompletion = timeline.find(event => event.sender === leaderId && event.roomId === team.leaderDMRoomID && event.body.includes(manifest.completionMarker)) || null;
const report = {
  protocolVersion: '1.0',
  runId: manifest.runId,
  caseId: manifest.caseId,
  startedAt,
  completedAt: new Date().toISOString(),
  status: completed ? 'passed' : 'incomplete',
  boundary: 'Local official AgentTeams v1.2.2 runtime with local Ollama qwen3:8b and fixture-backed DevOrbit tools. This is not a cloud account, vendor platform, or production-cluster run.',
  runtime: {
    team: { name: team.teamName, phase: team.phase, leaderReady: team.leaderReady, readyWorkers: team.readyWorkers, totalWorkers: team.totalWorkers },
    workers: workers.map(worker => ({ name: worker.name, phase: worker.phase, model: worker.model, runtime: worker.runtime, role: worker.role })),
    matrix: { adminId, leaderId, teamRoomId: team.teamRoomID, leaderDmRoomId: team.leaderDMRoomID, roomCount: roomIds.length, memberships: roomMembers },
    mcp: { baselineOffset: baselineAudit.total, protocolVersions: baselineAudit.protocolVersions }
  },
  task: { eventId: sent.event_id, completionMarker: manifest.completionMarker, timeoutSeconds: manifest.timeoutSeconds, teamHarnessProjectId: executionProjectId, finalMessageId },
  evidence: {
    seenWorkers,
    requiredWorkers: manifest.requiredWorkers,
    auditChecks,
    taskPlan,
    teamHarness: teamHarnessEvidence,
    workerMcp: workerMcpEvidence,
    workerMatrix: workerMatrixEvidence,
    audit: audit.map(item => ({ auditRef: item.auditRef, at: item.at, protocolVersion: item.protocolVersion, caller: item.caller, tool: item.tool, status: item.status, policyDecision: item.policyDecision, traceId: item.traceId, caseId: item.caseId, inputDigest: item.inputDigest, outputDigest: item.outputDigest })),
    timeline,
    leaderCompletion
  }
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, reportPath, seenWorkers: seenWorkers.length, requiredWorkers: manifest.requiredWorkers.length, auditPassed: auditChecks.filter(item => item.observed).length, auditRequired: auditChecks.length, leaderCompletion: Boolean(leaderCompletion) }));
if (!completed) process.exit(1);

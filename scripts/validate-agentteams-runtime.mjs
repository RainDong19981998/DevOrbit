import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../evaluation/agentteams-runtime-case.manifest.json', import.meta.url), 'utf8'));
const report = JSON.parse(await readFile(new URL('../reports/agentteams-runtime.json', import.meta.url), 'utf8'));

const expectedWorkers = [...manifest.requiredWorkers].sort();
const observedWorkers = [...report.evidence.seenWorkers].sort();
const workerNames = report.runtime.workers.map(worker => worker.name).sort();
const expectedInstances = [manifest.leaderName, ...manifest.requiredWorkers].sort();
const completion = report.evidence.leaderCompletion;
const completionPayload = JSON.parse(completion.body.slice(completion.body.indexOf('{')));
const requiredCalls = manifest.taskPlan.reduce((count, task) => count + (task.id === 'impact' ? 2 : task.id === 'patch' ? 7 : task.tools.length), 0);

const checks = [
  ['protocol and registration', report.protocolVersion === '1.0' && report.runId === manifest.runId && report.caseId === manifest.caseId],
  ['passed and ordered timestamps', report.status === 'passed' && Date.parse(report.completedAt) >= Date.parse(report.startedAt)],
  ['honest local boundary', report.boundary.includes('Local official AgentTeams v1.2.2') && report.boundary.includes('not a cloud account') && report.boundary.includes('production-cluster run')],
  ['active TeamHarness team', report.runtime.team.name === manifest.teamName && report.runtime.team.phase === 'Active' && report.runtime.team.leaderReady === true && report.runtime.team.readyWorkers === 7 && report.runtime.team.totalWorkers === 7],
  ['eight official runtime instances', JSON.stringify(workerNames) === JSON.stringify(expectedInstances) && report.runtime.workers.every(worker => worker.phase === 'Running' && worker.runtime === manifest.runtime.workerRuntime && worker.model === manifest.runtime.model)],
  ['Matrix requester and Leader rooms', report.runtime.matrix.leaderId.startsWith(`@${manifest.leaderName}:`) && report.runtime.matrix.teamRoomId.startsWith('!') && report.runtime.matrix.leaderDmRoomId.startsWith('!') && report.runtime.matrix.roomCount >= 9],
  ['dual MCP protocol evidence', ['2025-06-18', '2025-11-25'].every(version => report.runtime.mcp.protocolVersions.includes(version))],
  ['unique TeamHarness execution', report.task.teamHarnessProjectId.startsWith(`${manifest.runId}-`) && /^\$/.test(report.task.eventId) && /^\$/.test(report.task.finalMessageId)],
  ['seven Worker identities observed', JSON.stringify(observedWorkers) === JSON.stringify(expectedWorkers)],
  ['registered task plan preserved', JSON.stringify(report.evidence.taskPlan) === JSON.stringify(manifest.taskPlan)],
  ['all audit gates observed', report.evidence.auditChecks.length === manifest.requiredAudit.length && report.evidence.auditChecks.every(check => check.observed === true)],
  ['required audit tuples match', manifest.requiredAudit.every(expected => report.evidence.audit.some(item => item.caller === expected.caller && item.tool === expected.tool && item.status === expected.status))],
  ['all direct Worker calls recorded', report.evidence.workerMcp.length === requiredCalls && report.evidence.workerMcp.every(item => item.http === 200 && expectedWorkers.includes(item.worker))],
  ['seven authentic Worker Matrix events', report.evidence.workerMatrix.length === 7 && new Set(report.evidence.workerMatrix.map(item => item.worker)).size === 7 && report.evidence.workerMatrix.every(item => /^\$/.test(item.eventId) && item.roomId === report.runtime.matrix.teamRoomId)],
  ['TeamHarness lifecycle clean', report.evidence.teamHarness.length >= 20 && report.evidence.teamHarness.every(item => item.ok === true && !item.error)],
  ['Leader completion sender and room', completion.sender === report.runtime.matrix.leaderId && completion.roomId === report.runtime.matrix.leaderDmRoomId && completion.eventId === report.task.finalMessageId && completion.body.startsWith(manifest.completionMarker)],
  ['safe terminal state', completionPayload.case_id === manifest.caseId && completionPayload.terminal_state === 'needs_human' && completionPayload.workers.length === 7 && completionPayload.approval_boundary.includes('no signed approval token')],
  ['no credentials in report', !/(Bearer\s+[A-Za-z0-9._~-]{12,}|WORKER_GATEWAY_KEY|WORKER_MATRIX_TOKEN)/i.test(JSON.stringify(report))]
];

for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`PASS AgentTeams runtime report: ${checks.length}/${checks.length} checks`);

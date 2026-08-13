import { mkdir, writeFile } from 'node:fs/promises';
import { ApprovalAuthority, ToolPolicy } from '../src/security/tool-policy.js';
import { McpToolServer } from '../src/mcp/tool-server.js';

let now = 1000;
const authority = new ApprovalAuthority({ secret: Buffer.from('devorbit-security-evaluation'), now: () => now });
const policy = new ToolPolicy({ approvalAuthority: authority });
const dummyTool = { name: 'release.canary', inputSchema: { type: 'object', properties: { caseId: { type: 'string' }, approvalId: { type: 'string' }, approvalToken: { type: 'string' }, idempotencyKey: { type: 'string' } }, required: ['caseId', 'approvalId', 'approvalToken', 'idempotencyKey'], additionalProperties: false }, outputSchema: { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'], additionalProperties: false }, annotations: { readOnlyHint: false }, handler: async () => ({ decision: 'promoted' }) };
const server = new McpToolServer({ tools: [dummyTool], policy });

async function call(args, context) {
  const response = await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'release.canary', arguments: args } }, context);
  return response.result;
}

const valid = authority.issue({ caseId: 'CASE-A', action: 'release.canary', approver: 'release-owner', attestation: { rca: '0.91/0.8', tests: 'sha256:test', rollback: 'sha256:rollback' }, ttlMs: 500 });
const cases = [];
async function check(id, attack, expected, operation) {
  const result = await operation();
  const observed = result?.isError ? result.structuredContent.reason || result.structuredContent.error : 'allowed';
  cases.push({ id, attack, expected, observed, passed: expected === observed });
}

await check('SEC-001', 'unauthorized agent invokes release', 'agent rca-worker is not allowed to call release.canary', () => call({ caseId: 'CASE-A', approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: 'a' }, { agent: 'rca-worker', caseId: 'CASE-A' }));
await check('SEC-002', 'forged approval receipt', 'invalid approval signature', () => call({ caseId: 'CASE-A', approvalId: valid.approvalId, approvalToken: 'forged', idempotencyKey: 'b' }, { agent: 'release-worker', caseId: 'CASE-A' }));
await check('SEC-003', 'approval replay across cases', 'case scope mismatch', () => call({ caseId: 'CASE-B', approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: 'c' }, { agent: 'release-worker', caseId: 'CASE-A' }));
await check('SEC-004', 'approval scope tampering', 'approval scope mismatch', () => call({ caseId: 'CASE-A', approvalId: 'APR-TAMPERED', approvalToken: valid.token, idempotencyKey: 'd' }, { agent: 'release-worker', caseId: 'CASE-A' }));
now = 1500;
await check('SEC-005', 'expired approval receipt', 'approval expired', () => call({ caseId: 'CASE-A', approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: 'e' }, { agent: 'release-worker', caseId: 'CASE-A' }));
await check('SEC-006', 'schema confusion with unknown argument', 'Invalid tool arguments: $ has unknown command', async () => {
  const response = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'release.canary', arguments: { caseId: 'CASE-A', approvalId: valid.approvalId, approvalToken: valid.token, idempotencyKey: 'f', command: 'rm -rf /' } } }, { agent: 'release-worker', caseId: 'CASE-A' });
  const observed = response.error?.message;
  return { isError: true, structuredContent: { reason: observed } };
});

const summary = { cases: cases.length, passed: cases.filter(item => item.passed).length, deniedAuditRecords: server.audit.filter(item => item.policyDecision === 'deny').length };
const report = { dataset: 'DevOrbit Adversarial Policy Cases v0.1', disclosure: 'Deterministic local attack simulations. Identity authentication remains a production gateway responsibility; this benchmark validates authorization, approval integrity, scope, expiry, and schema enforcement.', generatedAt: new Date().toISOString(), summary, cases };
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/security-evaluation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const markdown = `# DevOrbit 对抗安全评测\n\n> ${report.disclosure}\n\n- 结果：${summary.passed}/${summary.cases}\n- 策略拒绝审计：${summary.deniedAuditRecords}\n\n| Case | Attack | Expected control | Observed | Result |\n|---|---|---|---|---|\n${cases.map(item => `| ${item.id} | ${item.attack} | ${item.expected} | ${item.observed} | ${item.passed ? 'PASS' : 'FAIL'} |`).join('\n')}\n`;
await writeFile(new URL('../reports/security-evaluation.md', import.meta.url), markdown);
console.log(`${summary.passed === summary.cases ? 'PASS' : 'FAIL'} security evaluation: ${summary.passed}/${summary.cases}`);
if (summary.passed !== summary.cases) process.exit(1);

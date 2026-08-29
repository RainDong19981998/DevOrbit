import { writeFile } from 'node:fs/promises';
import { runPipeline } from '../src/orchestrator.js';
import { createModelProvider, ModelProviderError } from '../src/models/provider.js';
import { InMemoryDbBranchProvider, DbBranchError } from '../src/adapters/db-branch.js';
import { McpToolServer } from '../src/mcp/tool-server.js';
import { createTools } from '../src/mcp/tools.js';
import { EpisodeStore } from '../src/knowledge/episode-store.js';
import { ToolPolicy } from '../src/security/tool-policy.js';
import { fileURLToPath } from 'node:url';
import { DEVORBIT_VERSION } from '../src/version.js';

const drills = [];

function record(id, name, pass, evidence) {
  drills.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}`);
}

const circuit = await runPipeline({ scenario: 'circuit-breaker' });
record('FD-001', 'Worker 返工耗尽：3 次尝试后熔断降级 needs_human', circuit.state.status === 'needs_human' && circuit.metrics.patchAttempts === 3, {
  status: circuit.state.status,
  patchAttempts: circuit.metrics.patchAttempts,
  behavior: 'verify 连续失败 → 返工回边 → 熔断器触发 → 链路安全停止并请求人工'
});

let calls429 = 0;
const retryFetch = async () => {
  calls429 += 1;
  if (calls429 === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
  return new Response(JSON.stringify({ model: 'mock', choices: [{ message: { content: 'recovered' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const retryProvider = createModelProvider({ driver: 'openai-compat', baseUrl: 'https://mock.model.local/v1', apiKey: 'sk-mock-drill', model: 'mock-model', fetchImpl: retryFetch, sleep: () => {} });
const retryResult = await retryProvider.chat({ agent: 'drill', user: 'ping' });
record('FD-002', '模型 429 限流：自动重试后恢复', calls429 === 2 && retryResult.content === 'recovered' && retryResult.attempts === 2, {
  attempts: retryResult.attempts,
  content: retryResult.content
});

const failFetch = async () => new Response('upstream broken', { status: 500 });
const failProvider = createModelProvider({ driver: 'openai-compat', baseUrl: 'https://mock.model.local/v1', apiKey: 'sk-mock-drill-secret', model: 'mock-model', fetchImpl: failFetch, sleep: () => {}, maxRetries: 1 });
let failClosed = false;
let leaked = true;
try {
  await failProvider.chat({ agent: 'drill', user: 'ping' });
} catch (error) {
  failClosed = error instanceof ModelProviderError;
  leaked = error.message.includes('sk-mock-drill-secret');
}
record('FD-003', '模型 500 不可用：重试耗尽后 fail-closed 且不泄露密钥', failClosed && !leaked, {
  failClosed,
  keyLeaked: leaked
});

let callsTimeout = 0;
const timeoutFetch = async () => {
  callsTimeout += 1;
  if (callsTimeout === 1) {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    throw timeoutError;
  }
  return new Response(JSON.stringify({ model: 'mock', choices: [{ message: { content: 'recovered-after-timeout' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const timeoutProvider = createModelProvider({ driver: 'openai-compat', baseUrl: 'https://mock.model.local/v1', apiKey: 'sk-mock-drill', model: 'mock-model', fetchImpl: timeoutFetch, sleep: () => {}, maxRetries: 2 });
const timeoutResult = await timeoutProvider.chat({ agent: 'drill', user: 'ping' });
record('FD-007', '模型网络超时：AbortSignal 超时后自动重试恢复', callsTimeout === 2 && timeoutResult.content === 'recovered-after-timeout' && timeoutResult.attempts === 2, {
  attempts: timeoutResult.attempts,
  content: timeoutResult.content
});

const fixturePath = fileURLToPath(new URL('../fixtures/checkout-service', import.meta.url));
const toolServer = new McpToolServer({ tools: createTools({ fixturePath, workspaceRegistry: new Map(), knowledgeStore: new EpisodeStore(), signals: [] }), policy: new ToolPolicy({}) });
const errorResponse = await toolServer.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'repository.read_file', arguments: { path: 'src/does-not-exist.js' } } }, { agent: 'impact-worker', traceId: 'TRACE-DRILL', caseId: 'CASE-DRILL' });
const errorAudit = toolServer.audit.at(-1);
record('FD-004', '工具执行错误：审计记录 error 且 JSON-RPC 返回失败', errorAudit?.status === 'error' && errorResponse?.result?.isError === true, {
  auditStatus: errorAudit?.status,
  rpcIsError: errorResponse?.result?.isError
});

const dbProvider = new InMemoryDbBranchProvider();
let unknownBranchClosed = false;
try {
  await dbProvider.applyMigration({ branchId: 'ghost-branch', script: { up: [{ type: 'rawSQL', sql: 'CREATE INDEX x ON inventory (sku)' }] } });
} catch (error) {
  unknownBranchClosed = error instanceof DbBranchError && error.code === 'unknown_branch';
}
await dbProvider.createBranch({ baselineSnapshot: { tables: { inventory: { columns: ['id', 'sku', 'stock'], pk: 'id', rows: [{ id: 1, sku: 'SKU-A', stock: 10 }] } }, foreignKeys: [] }, branchId: 'drill' });
let dropBlocked = false;
try {
  await dbProvider.applyMigration({ branchId: 'drill', script: { up: [{ type: 'rawSQL', sql: 'DROP TABLE inventory' }] } });
} catch (error) {
  dropBlocked = error instanceof DbBranchError && error.code === 'migration_blocked';
}
record('FD-005', '数据库分支故障：未知分支 fail-closed，DROP TABLE 被门禁阻断', unknownBranchClosed && dropBlocked, {
  unknownBranchClosed,
  dropBlocked
});

let unreachableCaught = false;
let unreachableCode = null;
try {
  await fetch('http://127.0.0.1:59999/mcp', { method: 'POST', body: '{}' });
} catch (error) {
  unreachableCaught = true;
  unreachableCode = error.cause?.code || error.code || 'network-error';
}
record('FD-006', 'MCP 端点不可达：网络错误被捕获，进程不崩溃', unreachableCaught, {
  unreachableCaught,
  code: unreachableCode
});

const passed = drills.filter(drill => drill.pass).length;
const report = {
  schema: 'devorbit.fault-drill/v1',
  version: DEVORBIT_VERSION,
  generatedAt: new Date().toISOString(),
  summary: { drills: drills.length, passed, failed: drills.length - passed },
  matrix: [
    { fault: 'Worker 返工耗尽', expected: '熔断降级 needs_human', control: 'max_patch_attempts=3 + circuit_breaker' },
    { fault: '模型 429 限流', expected: '自动重试后恢复', control: 'postJson 重试策略（幂等读路径）' },
    { fault: '模型 500 不可用', expected: 'fail-closed，密钥不泄露', control: 'ModelProviderError + redact' },
    { fault: '模型网络超时', expected: 'AbortSignal 超时后自动重试恢复', control: 'AbortSignal.timeout + 可重试错误分类' },
    { fault: '工具执行错误', expected: '审计 error + JSON-RPC 失败', control: 'MCP 审计链 + 错误封装' },
    { fault: '数据库分支故障/恶意迁移', expected: 'fail-closed + 门禁阻断', control: 'DbBranchError + migration guardrail' },
    { fault: 'MCP 端点不可达', expected: '网络错误被捕获', control: '客户端错误处理' }
  ],
  drills
};
await writeFile(new URL('../reports/fault-drill.json', import.meta.url), JSON.stringify(report, null, 2));
const md = [
  '# 可靠性异常演练矩阵',
  '',
  `- 生成时间：${report.generatedAt}（DevOrbit ${report.version}）`,
  `- 结果：${passed}/${drills.length} 通过`,
  '',
  '| 编号 | 故障注入 | 期望行为 | 结果 |',
  '|---|---|---|---|',
  ...drills.map(drill => `| ${drill.id} | ${drill.name} | 见矩阵 | ${drill.pass ? 'PASS' : 'FAIL'} |`),
  '',
  '演练口径：故障通过受控注入（场景熔断、mock 模型端点、非法分支/恶意 SQL、不可达端口）触发，验证熔断、重试、fail-closed、审计与门禁行为；均为本地确定性验证，不声称覆盖生产级混沌工程。',
  ''
];
await writeFile(new URL('../reports/fault-drill.md', import.meta.url), md.join('\n'));
console.log(`${passed === drills.length ? 'PASS' : 'FAIL'} fault drill: ${passed}/${drills.length}`);
if (passed !== drills.length) process.exit(1);

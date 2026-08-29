import { readFile } from 'node:fs/promises';
import { HTTP_ADAPTER_OPERATIONS } from '../src/adapters/http.js';
import { createTools } from '../src/mcp/tools.js';

const contract = JSON.parse(await readFile(new URL('../schemas/http-adapter.openapi.json', import.meta.url), 'utf8'));
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail });
const operations = new Map();

for (const [path, pathItem] of Object.entries(contract.paths || {})) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = pathItem[method];
    if (!operation) continue;
    operations.set(operation['x-devorbit-tool'], { path, method: method.toUpperCase(), operation });
  }
}

const toolNames = createTools({ fixturePath: '/tmp/fixture', workspaceRegistry: new Map(), knowledgeStore: { search: () => [], size: () => 0, write: card => card } }).map(tool => tool.name);
check('OpenAPI 3.1 document', contract.openapi === '3.1.0' && contract.info?.version === '0.5.0');
check('global bearer authentication', contract.security?.some(item => Object.hasOwn(item, 'bearerAuth')));
check('ten HTTP operations', operations.size === 10 && Object.keys(HTTP_ADAPTER_OPERATIONS).length === 10, `${operations.size}/10`);
check('HTTP adapter operations map to MCP tools', [...operations.keys()].every(name => toolNames.includes(name)) && Object.keys(HTTP_ADAPTER_OPERATIONS).every(name => toolNames.includes(name)));

const requiredCorrelation = new Set(['#/components/parameters/TraceId', '#/components/parameters/CaseId', '#/components/parameters/Agent', '#/components/parameters/Operation']);
for (const [name, expected] of Object.entries(HTTP_ADAPTER_OPERATIONS)) {
  const actual = operations.get(name);
  check(`${name} method/path`, actual?.method === expected.method && actual?.path === expected.path, `${actual?.method || '-'} ${actual?.path || '-'}`);
  check(`${name} read-only declaration`, actual?.operation?.['x-devorbit-read-only'] === expected.readOnly);
  check(`${name} idempotency declaration`, actual?.operation?.['x-devorbit-idempotency-required'] === expected.requiresIdempotencyKey);
  const parameters = new Set((actual?.operation?.parameters || []).map(parameter => parameter.$ref));
  check(`${name} correlation headers`, [...requiredCorrelation].every(ref => parameters.has(ref)));
  check(`${name} idempotency header`, parameters.has('#/components/parameters/IdempotencyKey') === expected.requiresIdempotencyKey);
  check(`${name} JSON success/error`, Boolean(actual?.operation?.responses?.['200']?.content?.['application/json']?.schema) && Boolean(actual?.operation?.responses?.default));
}

const canarySchema = contract.components?.schemas?.CanaryRequest;
check('approval token excluded from external schema', !Object.hasOwn(canarySchema?.properties || {}, 'approvalToken') && canarySchema?.additionalProperties === false);
check('structured error contract', contract.components?.schemas?.ErrorResponse?.properties?.error?.properties?.code?.type === 'string');

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
const passed = checks.filter(item => item.ok).length;
if (passed !== checks.length) process.exit(1);
console.log(`PASS HTTP Adapter OpenAPI contract: ${passed}/${checks.length}`);

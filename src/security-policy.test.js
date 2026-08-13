import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalAuthority, ToolPolicy } from './security/tool-policy.js';
import { validateSchema } from './mcp/tool-server.js';

test('tool policy enforces least privilege and case scope', () => {
  const policy = new ToolPolicy({ approvalAuthority: new ApprovalAuthority({ secret: Buffer.from('test-secret') }) });
  assert.equal(policy.authorize({ tool: 'repository.write_file', args: {}, context: { agent: 'impact-worker' } }).ok, false);
  assert.equal(policy.authorize({ tool: 'repository.write_file', args: {}, context: { agent: 'patch-worker' } }).ok, true);
  const scoped = policy.authorize({ tool: 'release.canary', args: { caseId: 'CASE-B' }, context: { agent: 'release-worker', caseId: 'CASE-A' } });
  assert.equal(scoped.ok, false);
  assert.equal(scoped.reason, 'case scope mismatch');
});

test('MCP runtime schema rejects unknown and mistyped arguments', () => {
  const schema = { type: 'object', properties: { topK: { type: 'integer', minimum: 1 }, tags: { type: 'array', items: { type: 'string' } } }, required: ['topK'], additionalProperties: false };
  assert.equal(validateSchema({ topK: 3, tags: ['safe'] }, schema), null);
  assert.match(validateSchema({ topK: '3' }, schema), /must be integer/);
  assert.match(validateSchema({ topK: 0 }, schema), /must be >= 1/);
  assert.match(validateSchema({ topK: 3, extra: true }, schema), /has unknown extra/);
});

test('approval receipts are signed, scoped, and expiring', () => {
  let now = 1000;
  const authority = new ApprovalAuthority({ secret: Buffer.from('test-secret'), now: () => now });
  const policy = new ToolPolicy({ approvalAuthority: authority });
  const receipt = authority.issue({ caseId: 'CASE-A', action: 'release.canary', approver: 'owner', attestation: { rca: '0.91/0.8', tests: 'sha256:test', rollback: 'sha256:rollback' }, ttlMs: 500 });
  const allowed = policy.authorize({ tool: 'release.canary', args: { caseId: 'CASE-A', approvalId: receipt.approvalId, approvalToken: receipt.token }, context: { agent: 'release-worker', caseId: 'CASE-A' } });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.approval.approver, 'owner');
  const tampered = policy.authorize({ tool: 'release.canary', args: { caseId: 'CASE-A', approvalId: receipt.approvalId, approvalToken: `${receipt.token}x` }, context: { agent: 'release-worker', caseId: 'CASE-A' } });
  assert.equal(tampered.ok, false);
  now = 1500;
  const expired = policy.authorize({ tool: 'release.canary', args: { caseId: 'CASE-A', approvalId: receipt.approvalId, approvalToken: receipt.token }, context: { agent: 'release-worker', caseId: 'CASE-A' } });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'approval expired');
});

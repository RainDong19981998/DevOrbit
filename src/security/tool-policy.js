import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TOOL_POLICY_CONTRACT = JSON.parse(readFileSync(new URL('../../config/tool-policy.json', import.meta.url), 'utf8'));
const TOOL_RULES = Object.freeze(TOOL_POLICY_CONTRACT.rules);

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sameSignature(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left || '') || !/^[a-f0-9]{64}$/.test(right || '')) return false;
  const a = Buffer.from(left || '', 'hex');
  const b = Buffer.from(right || '', 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export class ApprovalAuthority {
  constructor({ secret = randomBytes(32), now = () => Date.now() } = {}) {
    this.secret = secret;
    this.now = now;
  }

  issue({ caseId, action, approver, attestation, ttlMs = 15 * 60 * 1000 }) {
    if (!caseId || !action || !approver || !attestation) throw new Error('approval receipt requires case, action, approver, and gate attestation');
    const claims = { approvalId: `APR-${caseId.replace(/^CASE-/, '')}`, caseId, action, approver, attestation, expiresAt: this.now() + ttlMs };
    const payload = encode(claims);
    const signature = createHmac('sha256', this.secret).update(payload).digest('hex');
    return { ...claims, token: `${payload}.${signature}` };
  }

  verify(token, { caseId, action, approvalId }) {
    try {
      const [payload, signature] = String(token || '').split('.');
      const expected = createHmac('sha256', this.secret).update(payload).digest('hex');
      if (!sameSignature(signature, expected)) return { ok: false, reason: 'invalid approval signature' };
      const claims = decode(payload);
      if (claims.expiresAt <= this.now()) return { ok: false, reason: 'approval expired' };
      if (claims.caseId !== caseId || claims.action !== action || claims.approvalId !== approvalId) return { ok: false, reason: 'approval scope mismatch' };
      if (!claims.attestation?.rca || !claims.attestation?.tests || !claims.attestation?.rollback) return { ok: false, reason: 'approval gate attestation missing' };
      return { ok: true, claims };
    } catch {
      return { ok: false, reason: 'malformed approval token' };
    }
  }
}

export class ToolPolicy {
  constructor({ approvalAuthority, rules = TOOL_RULES } = {}) {
    this.approvalAuthority = approvalAuthority;
    this.rules = rules;
  }

  ruleFor(tool) {
    return this.rules[tool] || null;
  }

  authorize({ tool, args, context }) {
    const rule = this.ruleFor(tool);
    if (!rule) return { ok: false, risk: 'unknown', reason: 'tool has no policy rule' };
    if (!context.agent || !rule.agents.includes(context.agent)) return { ok: false, risk: rule.risk, reason: `agent ${context.agent || 'anonymous'} is not allowed to call ${tool}` };
    if (context.caseId && args.caseId && context.caseId !== args.caseId) return { ok: false, risk: rule.risk, reason: 'case scope mismatch' };
    if (rule.approval) {
      if (!this.approvalAuthority) return { ok: false, risk: rule.risk, reason: 'approval verifier unavailable' };
      const verified = this.approvalAuthority.verify(args.approvalToken, { caseId: context.caseId || args.caseId, action: tool, approvalId: args.approvalId });
      if (!verified.ok) return { ok: false, risk: rule.risk, reason: verified.reason };
      return { ok: true, risk: rule.risk, approval: verified.claims };
    }
    return { ok: true, risk: rule.risk };
  }
}

export { TOOL_POLICY_CONTRACT, TOOL_RULES };

import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceModelPilotVerdict, evaluateModelPilotGate, isAllowedModelPilotPath } from './model-pilot-gate.js';

const valid = {
  targetExitCode: 0,
  regressionExitCode: 0,
  classificationExitCode: 0,
  changedPaths: ['src/example.py'],
  diff: 'diff --git a/src/example.py b/src/example.py\n--- a/src/example.py\n+++ b/src/example.py\n-old = False\n+old = True\n',
  allowedWritePrefix: 'src/',
  forbiddenWritePrefixes: ['test/', '.github/', 'evaluation/']
};

test('machine gate accepts only complete executable evidence', () => {
  const gate = evaluateModelPilotGate(valid);
  assert.equal(gate.passed, true);
  assert.deepEqual(gate.failedChecks, []);
  assert.deepEqual(enforceModelPilotVerdict(gate, { accept: true }), {
    accepted: true,
    machineGatePassed: true,
    modelAccept: true,
    rule: 'machineGatePassed && modelAccept'
  });
});

test('model prose cannot override a failing mandatory test', () => {
  const gate = evaluateModelPilotGate({ ...valid, targetExitCode: 1 });
  const verdict = enforceModelPilotVerdict(gate, { accept: true });
  assert.equal(gate.passed, false);
  assert.deepEqual(gate.failedChecks, ['targetPassed']);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.modelAccept, true);
});

test('comment-only and out-of-scope patches fail closed', () => {
  const commentOnly = evaluateModelPilotGate({
    ...valid,
    diff: 'diff --git a/src/example.py b/src/example.py\n--- a/src/example.py\n+++ b/src/example.py\n+# no behavior change\n'
  });
  assert.equal(commentOnly.checks.executableChange, false);
  assert.equal(commentOnly.passed, false);

  const outOfScope = evaluateModelPilotGate({ ...valid, changedPaths: ['test/example.py'] });
  assert.equal(outOfScope.checks.sourceOnly, false);
  assert.equal(outOfScope.passed, false);
  assert.equal(isAllowedModelPilotPath('src/../test/example.py', 'src/', ['test/']), false);
  assert.equal(isAllowedModelPilotPath('src/example.py', 'src/', ['test/']), true);
});

test('verification model can veto but cannot grant machine acceptance', () => {
  const gate = evaluateModelPilotGate(valid);
  const verdict = enforceModelPilotVerdict(gate, { accept: false });
  assert.equal(verdict.machineGatePassed, true);
  assert.equal(verdict.modelAccept, false);
  assert.equal(verdict.accepted, false);
});

test('protected source invariants are enforced as machine policy', () => {
  const gate = evaluateModelPilotGate({ ...valid, policyChecks: { 'base-default-preserved': false } });
  assert.equal(gate.passed, false);
  assert.equal(gate.checks['policy:base-default-preserved'], false);
  assert.deepEqual(gate.failedChecks, ['policy:base-default-preserved']);
  assert.equal(enforceModelPilotVerdict(gate, { accept: true }).accepted, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEditBatch, applyEditToText, describeEditFailures, isBenchmarkPathAllowed } from './edit-engine.js';

test('exact edit replaces a unique search block', () => {
  const source = 'def f():\n    return 1\n';
  const result = applyEditToText(source, { search: '    return 1', replace: '    return 2' });
  assert.equal(result.applied, true);
  assert.equal(result.method, 'exact');
  assert.equal(result.text, 'def f():\n    return 2\n');
});

test('exact edit flags ambiguity when search occurs multiple times', () => {
  const source = 'x = 1\nx = 1\n';
  const result = applyEditToText(source, { search: 'x = 1', replace: 'x = 2' });
  assert.equal(result.applied, true);
  assert.equal(result.ambiguous, true);
});

test('fuzzy edit tolerates indentation differences', () => {
  const source = 'def f():\n    if a:\n        return 1\n';
  const result = applyEditToText(source, { search: 'if a:\n  return 1', replace: 'if a:\n        return 2' });
  assert.equal(result.applied, true);
  assert.equal(result.method, 'fuzzy');
  assert.ok(result.text.includes('return 2'));
});

test('edit fails with structured reason when search missing', () => {
  const result = applyEditToText('alpha\n', { search: 'beta', replace: 'gamma' });
  assert.equal(result.applied, false);
  assert.match(result.reason, /not found/);
});

test('empty search performs a full rewrite', () => {
  const result = applyEditToText('old', { search: '', replace: 'new content' });
  assert.equal(result.applied, true);
  assert.equal(result.method, 'rewrite');
  assert.equal(result.text, 'new content');
});

test('path policy blocks test files, traversal and absolute paths', () => {
  assert.equal(isBenchmarkPathAllowed('src/foo.py'), true);
  assert.equal(isBenchmarkPathAllowed('tests/test_foo.py'), false);
  assert.equal(isBenchmarkPathAllowed('test/test_foo.py'), false);
  assert.equal(isBenchmarkPathAllowed('pkg/testing/x.py'), false);
  assert.equal(isBenchmarkPathAllowed('../evil.py'), false);
  assert.equal(isBenchmarkPathAllowed('/etc/passwd'), false);
  assert.equal(isBenchmarkPathAllowed('fix.patch'), false);
  assert.equal(isBenchmarkPathAllowed(''), false);
});

test('batch apply succeeds across two files and reports changed paths', () => {
  const sources = {
    'a.py': 'value = 1\n',
    'b.py': 'value = 2\n'
  };
  const result = applyEditBatch({
    sources,
    edits: [
      { path: 'a.py', search: 'value = 1', replace: 'value = 10' },
      { path: 'b.py', search: 'value = 2', replace: 'value = 20' }
    ]
  });
  assert.equal(result.applied, true);
  assert.deepEqual(result.changedPaths.sort(), ['a.py', 'b.py']);
  assert.equal(result.outputs['a.py'], 'value = 10\n');
  assert.equal(result.safetyViolation, false);
});

test('batch apply rejects edits touching test files as safety violation', () => {
  const result = applyEditBatch({
    sources: { 'tests/test_a.py': 'x\n' },
    edits: [{ path: 'tests/test_a.py', search: 'x', replace: 'y' }]
  });
  assert.equal(result.applied, false);
  assert.equal(result.safetyViolation, true);
});

test('batch apply enforces changed file limit', () => {
  const sources = { 'a.py': 'x', 'b.py': 'x', 'c.py': 'x', 'd.py': 'x' };
  const edits = ['a.py', 'b.py', 'c.py', 'd.py'].map(path => ({ path, search: 'x', replace: 'y' }));
  const result = applyEditBatch({ sources, edits, maxChangedFiles: 3 });
  assert.equal(result.applied, false);
  assert.match(result.failures[0].reason, /file limit exceeded/);
});

test('batch apply reports missing source file with structured failure', () => {
  const result = applyEditBatch({
    sources: { 'a.py': 'x' },
    edits: [{ path: 'missing.py', search: 'x', replace: 'y' }]
  });
  assert.equal(result.applied, false);
  assert.equal(result.safetyViolation, false);
  assert.match(result.failures[0].reason, /source not loaded/);
  assert.match(describeEditFailures(result), /missing\.py/);
});

test('batch apply reports unmatched search block with preview for feedback', () => {
  const result = applyEditBatch({
    sources: { 'a.py': 'real content\n' },
    edits: [{ path: 'a.py', search: 'hallucinated content', replace: 'y' }]
  });
  assert.equal(result.applied, false);
  assert.match(describeEditFailures(result), /hallucinated content/);
});

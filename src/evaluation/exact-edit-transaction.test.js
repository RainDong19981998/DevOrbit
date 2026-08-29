import assert from 'node:assert/strict';
import test from 'node:test';
import { planExactEditTransaction } from './exact-edit-transaction.js';

const allowed = path => path.startsWith('pydicom/') && path.endsWith('.py');

test('plans all exact edits before exposing outputs', () => {
  const sources = {
    'pydicom/a.py': 'left = 1\nright = 2\n',
    'pydicom/b.py': 'enabled = False\n'
  };
  const plan = planExactEditTransaction({
    sources,
    edits: [
      { file: 'pydicom/a.py', oldText: 'left = 1', newText: 'left = 3' },
      { file: 'pydicom/b.py', oldText: 'enabled = False', newText: 'enabled = True' }
    ],
    validatePath: allowed
  });
  assert.deepEqual(plan.changedPaths, ['pydicom/a.py', 'pydicom/b.py']);
  assert.equal(plan.outputs['pydicom/a.py'], 'left = 3\nright = 2\n');
  assert.equal(plan.outputs['pydicom/b.py'], 'enabled = True\n');
  assert.equal(sources['pydicom/a.py'], 'left = 1\nright = 2\n');
});

test('rejects duplicate sequential replacements without mutating inputs', () => {
  const original = '        if self.value is None:\n            return 0\n';
  const sources = { 'pydicom/dataelem.py': original };
  const duplicate = {
    file: 'pydicom/dataelem.py',
    oldText: '        if self.value is None:\n            return 0',
    newText: "        if self.value is None and self.VR != 'SQ':\n            return 0"
  };
  assert.throws(
    () => planExactEditTransaction({ sources, edits: [duplicate, duplicate], validatePath: allowed }),
    /oldText occurrence count 0/
  );
  assert.equal(sources['pydicom/dataelem.py'], original);
});

test('rejects out-of-policy paths before planning', () => {
  assert.throws(
    () => planExactEditTransaction({
      sources: { 'pydicom/tests/test_dataelem.py': 'assert False\n' },
      edits: [{ file: 'pydicom/tests/test_dataelem.py', oldText: 'False', newText: 'True' }],
      validatePath: path => allowed(path) && !path.startsWith('pydicom/tests/')
    }),
    /path policy/
  );
});

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const selectedPath = process.env.DEVORBIT_BENCH_SELECTED || '/tmp/zhanlu/selected-cases.json';
const manifestOut = new URL('evaluation/public-benchmark.manifest.json', root);
const casesDir = new URL('evaluation/public-benchmark/cases/', root);
const parquetSha = process.env.DEVORBIT_SWEBENCH_PARQUET_SHA256 || '';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const selected = JSON.parse(await readFile(selectedPath, 'utf8'));
if (selected.length !== 30) throw new Error(`expected 30 selected cases, got ${selected.length}`);

const LICENSES = {
  'pydicom/pydicom': 'MIT',
  'sqlfluff/sqlfluff': 'MIT',
  'pylint-dev/astroid': 'LGPL-2.1-or-later',
  'marshmallow-code/marshmallow': 'MIT'
};

const cases = [];
for (const [index, row] of selected.entries()) {
  const caseId = `PUB-${row.instance_id.toUpperCase().replace(/[^A-Z0-9._:-]/g, '-')}`;
  const dir = new URL(`${row.instance_id}/`, casesDir);
  await mkdir(dir, { recursive: true });
  const issue = { instanceId: row.instance_id, repository: row.repo, version: row.version, createdAt: row.created_at, problemStatement: row.problem_statement, hintsText: row.hints_text };
  await writeFile(new URL('issue.json', dir), JSON.stringify(issue, null, 2) + '\n');
  await writeFile(new URL('test.patch', dir), row.test_patch);
  const testPatchDigest = `sha256:${sha256(row.test_patch)}`;
  const goldContentId = sha256(row.patch).slice(0, 40);
  const failToPass = row.FAIL_TO_PASS;
  const repro = [
    'python -m pip install --disable-pip-version-check --no-input --target deps .',
    `python -m pytest -q ${failToPass.join(' ')}`
  ];
  cases.push({
    caseId,
    sourceId: 'swe-bench',
    repository: row.repo,
    issueUrl: `https://github.com/${row.repo}/pull/${row.instance_id.split('-').at(-1)}`,
    baseCommit: row.base_commit,
    testPatchDigest,
    expectedFixCommit: goldContentId,
    reproductionCommand: repro,
    split: 'test',
    license: LICENSES[row.repo],
    language: 'Python',
    tags: [row.repo.split('/')[1], `version:${row.version}`, `failToPass:${failToPass.length}`]
  });
  console.log(`frozen ${caseId} (${row.repo}@${row.base_commit.slice(0, 7)}, F2P=${failToPass.length})`);
}

const manifest = {
  protocolVersion: '1.0',
  datasetId: 'devorbit-public-software-repair-v1',
  status: 'frozen',
  disclosure: 'Frozen 30-case test split drawn from the public SWE-bench dev parquet (princeton-nlp/SWE-bench), repository-quota sampled with deterministic SHA-256 ordering. pvlib and pyvista cases are excluded because their heavyweight scientific-computing dependency stacks are outside the pinned offline-friendly evaluation environment; the exclusion is disclosed rather than silently dropped. expectedFixCommit fields carry the content-addressed SHA-256 prefix of the withheld gold patch, not a git commit; gold patches stay evaluator-only and never enter model context. Scores are produced by the DevOrbit evaluation harness on this frozen manifest and must not be read as official SWE-bench leaderboard numbers.',
  selectionPolicy: {
    eligibility: [
      'Public repository and issue provenance are available under a redistributable research-compatible license',
      'The defect reproduces from an immutable base commit with a deterministic test patch',
      'FAIL_TO_PASS contains 1-3 tests and the withheld gold patch touches at most 2 non-test source files',
      'Problem statement length is bounded (<= 4000 chars) to keep the evaluation budget uniform'
    ],
    exclusions: [
      'Cases requiring unavailable proprietary services or personal data',
      'Cases that do not reproduce in the pinned container after three independent attempts',
      'pvlib/pvlib-python and pyvista/pyvista: heavyweight scientific dependency stacks outside the pinned evaluation environment',
      'Cases whose gold patch modifies test files (leakage-adjacent shape)'
    ],
    splitSeed: 'devorbit-public-v1-split',
    splitAlgorithm: 'repository-grouped deterministic SHA-256 ordering; no repository may cross train/validation/test; quotas pydicom 10, sqlfluff 10, astroid 6, marshmallow 4'
  },
  evaluationPolicy: {
    goldFixAccess: 'evaluator-only',
    networkAccess: 'allowlisted',
    maxAttemptsPerCase: 2,
    timeoutSeconds: 1800,
    primarySplit: 'test',
    primaryMetric: 'closedLoopRate'
  },
  sources: [
    {
      id: 'swe-bench',
      name: 'SWE-bench (dev split parquet via hf-mirror)',
      url: 'https://huggingface.co/datasets/princeton-nlp/SWE-bench',
      license: 'SWE-bench software repository declares MIT; constituent case repositories carry their own licenses (see per-case license field)',
      snapshot: parquetSha ? `sha256:${parquetSha}` : null,
      retrievedAt: new Date().toISOString().slice(0, 10)
    }
  ],
  splits: { train: [], validation: [], test: cases.map(item => item.caseId) },
  cases
};

await writeFile(manifestOut, JSON.stringify(manifest, null, 2) + '\n');
console.log(`PASS frozen manifest: ${cases.length} cases -> evaluation/public-benchmark.manifest.json`);

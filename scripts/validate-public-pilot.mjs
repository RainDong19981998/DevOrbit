import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validateJsonSchema } from '../src/evaluation/public-benchmark.js';

const manifest = JSON.parse(await readFile(new URL('../evaluation/public-benchmark-pilot.manifest.json', import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../schemas/public-benchmark-pilot.schema.json', import.meta.url), 'utf8'));
const failures = validateJsonSchema(manifest, schema).map(error => `schema: ${error}`);
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const checks = [];
const check = (label, ok, detail = null) => { checks.push({ label, ok: Boolean(ok), detail }); if (!ok) failures.push(label); };
const verify = async (path, expected) => {
  const actual = sha256(await readFile(new URL(`../${path}`, import.meta.url)));
  check(`digest ${path}`, actual === expected, actual);
};

check('pilot manifest schema', failures.length === 0);
await verify(manifest.case.testPatchPath, manifest.case.testPatchSha256);
await verify(manifest.environment.requirementsPath, manifest.environment.requirementsSha256);
await verify(manifest.evidence.baselineLogPath, manifest.evidence.baselineLogSha256);
await verify(manifest.evidence.goldFailToPassLogPath, manifest.evidence.goldFailToPassLogSha256);
await verify(manifest.evidence.goldAnsiFileLogPath, manifest.evidence.goldAnsiFileLogSha256);

const baseline = await readFile(new URL(`../${manifest.evidence.baselineLogPath}`, import.meta.url), 'utf8');
const goldFailToPass = await readFile(new URL(`../${manifest.evidence.goldFailToPassLogPath}`, import.meta.url), 'utf8');
const goldAnsi = await readFile(new URL(`../${manifest.evidence.goldAnsiFileLogPath}`, import.meta.url), 'utf8');
check('baseline proves expected defect assertion', baseline.includes('assert raw_seg.is_whitespace') && baseline.includes('1 failed'));
check('gold remains evaluator-only', manifest.case.goldPatchStored === false && goldFailToPass.includes('1 passed') && goldAnsi.includes('43 passed'));

for (const failure of failures) console.error(`FAIL ${failure}`);
const report = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'failed' : 'passed',
  boundary: 'One SWE-bench dev validation pilot reproduced. This report contains no DevOrbit run, score, test-set result, or ranking claim.',
  manifestDigest: sha256(await readFile(new URL('../evaluation/public-benchmark-pilot.manifest.json', import.meta.url))),
  case: { instanceId: manifest.case.instanceId, split: manifest.case.split, baselineExitCode: manifest.evidence.baselineExitCode, goldFailToPassPassed: manifest.evidence.goldFailToPassPassed, goldAnsiFilePassed: manifest.evidence.goldAnsiFilePassed },
  summary: { checks: checks.length, passed: checks.filter(item => item.ok).length, failed: checks.filter(item => !item.ok).length },
  checks
};
await writeFile(new URL('../reports/public-benchmark-pilot.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exit(1);
console.log(`PASS frozen public reproduction pilot: ${report.summary.passed}/${report.summary.checks}, 1 case reproduced, 0 DevOrbit scores claimed`);

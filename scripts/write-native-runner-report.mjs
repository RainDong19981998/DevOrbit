import { writeFile } from 'node:fs/promises';

const checks = [
  ['non-root runtime', process.env.NATIVE_RUNNER_UID === '10001'],
  ['Git runtime pinned', process.env.NATIVE_RUNNER_GIT_VERSION === 'git version 2.39.5'],
  ['real repository clone in hardened container', /^[0-9a-f]{40}$/.test(process.env.NATIVE_RUNNER_CLONE_COMMIT || '')],
  ['native container environment', process.env.NATIVE_RUNNER_ENVIRONMENT === 'container-native'],
  ['read-only and least-privilege invocation', process.env.NATIVE_RUNNER_READ_ONLY === 'true' && process.env.NATIVE_RUNNER_CAP_DROP === '[ALL]' && process.env.NATIVE_RUNNER_NO_NEW_PRIVILEGES === 'true'],
  ['durable idempotency mount configured', process.env.NATIVE_RUNNER_IDEMPOTENCY_MOUNT === '/var/lib/devorbit/idempotency']
];
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
const passed = checks.filter(([, ok]) => ok).length;
const report = {
  generatedAt: new Date().toISOString(),
  status: passed === checks.length ? 'passed' : 'failed',
  boundary: 'Build and runtime evidence for the native connector image. Vendor credentials and production cluster execution are not claimed.',
  image: process.env.NATIVE_RUNNER_IMAGE,
  imageId: process.env.NATIVE_RUNNER_IMAGE_ID,
  baseImage: process.env.NATIVE_RUNNER_NODE_IMAGE,
  gitVersion: process.env.NATIVE_RUNNER_GIT_VERSION,
  cloneCommit: process.env.NATIVE_RUNNER_CLONE_COMMIT,
  hardening: { uid: Number(process.env.NATIVE_RUNNER_UID), readOnlyRootfs: process.env.NATIVE_RUNNER_READ_ONLY === 'true', capDrop: process.env.NATIVE_RUNNER_CAP_DROP, noNewPrivileges: process.env.NATIVE_RUNNER_NO_NEW_PRIVILEGES === 'true' },
  persistence: { path: '/var/lib/devorbit/idempotency', externalWrites: ['jenkins.build.trigger', 'argo.rollout.patch', 'argo.rollout.rollback'], workspaceLifecycle: 'process-scoped' },
  summary: { checks: checks.length, passed, failed: checks.length - passed },
  checks: checks.map(([label, ok]) => ({ label, ok }))
};
await writeFile(process.env.NATIVE_RUNNER_REPORT, `${JSON.stringify(report, null, 2)}\n`);
if (passed !== checks.length) process.exit(1);
console.log(`PASS native runner image: ${passed}/${checks.length}`);

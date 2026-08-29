import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const deliverables = join(root, 'deliverables');
const tmpDir = '/tmp/zhanlu/total-bundle';
const totalZip = join(deliverables, 'DevOrbit_复赛提交总包.zip');
const codeZip = join(deliverables, 'DevOrbit_复赛可执行代码包.zip');

rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

// 从代码包中提取文件（扁平化）的映射：目标文件名 → 代码包内路径
const fromCodeZip = [
  ['作品简介.md', 'docs/作品简介.md'],
  ['官网提交粘贴稿.md', 'docs/官网提交粘贴稿.md'],
  ['提交清单.md', 'docs/提交清单.md'],
  ['评委90秒验收.md', 'docs/评委90秒验收.md'],
  ['第三方依赖与合规清单.md', 'docs/第三方依赖与合规清单.md'],
  ['演示脚本.md', 'docs/演示脚本.md'],
  ['AgentTeams本地运行验证.md', 'docs/AgentTeams本地运行验证.md'],
  ['威胁模型.md', 'docs/威胁模型.md'],
  ['证据索引.md', 'docs/证据索引.md'],
  ['Adapter生产契约.md', 'docs/Adapter生产契约.md'],
  ['公开基准协议.md', 'docs/公开基准协议.md'],
  ['公开基准复现试点.md', 'docs/公开基准复现试点.md'],
  ['原生平台连接器.md', 'docs/原生平台连接器.md'],
  ['agentteams-contract.md', 'reports/agentteams-contract.md'],
  ['benchmark.md', 'reports/benchmark.md'],
  ['security-evaluation.md', 'reports/security-evaluation.md'],
  ['container-smoke.json', 'reports/container-smoke.json'],
  ['agentteams-runtime.json', 'reports/agentteams-runtime.json'],
  ['public-benchmark.json', 'reports/public-benchmark.json'],
  ['public-benchmark.md', 'reports/public-benchmark.md'],
  ['public-benchmark-pilot.json', 'reports/public-benchmark-pilot.json'],
  ['public-model-pilot-v11.json', 'reports/public-model-pilot-v11.json'],
  ['independent-model-pilot.json', 'reports/independent-model-pilot.json'],
  ['native-platform-smoke.json', 'reports/native-platform-smoke.json'],
  ['native-runner-smoke.json', 'reports/native-runner-smoke.json'],
  ['http-adapter.openapi.json', 'schemas/http-adapter.openapi.json'],
  ['public-benchmark.schema.json', 'schemas/public-benchmark.schema.json'],
  ['public-benchmark-results.schema.json', 'schemas/public-benchmark-results.schema.json'],
  ['public-benchmark-report.schema.json', 'schemas/public-benchmark-report.schema.json'],
  ['public-benchmark-pilot.schema.json', 'schemas/public-benchmark-pilot.schema.json'],
  ['public-model-pilot-v11.schema.json', 'schemas/public-model-pilot-v11.schema.json'],
  ['independent-model-pilot.schema.json', 'schemas/independent-model-pilot.schema.json'],
  ['agentteams-runtime-case.manifest.json', 'evaluation/agentteams-runtime-case.manifest.json'],
  ['agentteams-runtime-case.schema.json', 'schemas/agentteams-runtime-case.schema.json'],
  ['agentteams-runtime-report.schema.json', 'schemas/agentteams-runtime-report.schema.json'],
  ['public-benchmark.manifest.json', 'evaluation/public-benchmark.manifest.json'],
  ['public-benchmark-pilot.manifest.json', 'evaluation/public-benchmark-pilot.manifest.json'],
  ['public-model-pilot-v11.manifest.json', 'evaluation/public-model-pilot-v11.manifest.json'],
  ['independent-model-pilot.manifest.json', 'evaluation/independent-model-pilot.manifest.json'],
  ['run-011-transcript.json', 'evaluation/public-model-pilot/run-011-transcript.json'],
  ['run-011-model.patch', 'evaluation/public-model-pilot/run-011-model.patch'],
  ['run-011-target.log', 'evaluation/public-model-pilot/run-011-target.log'],
  ['run-011-regression.log', 'evaluation/public-model-pilot/run-011-regression.log'],
  ['run-011-classification.log', 'evaluation/public-model-pilot/run-011-classification.log'],
  ['candidate-selection.json', 'evaluation/independent-model-pilot/candidate-selection.json'],
  ['transcript.json', 'evaluation/independent-model-pilot/pydicom__pydicom-965/transcript.json'],
  ['baseline-target.log', 'evaluation/independent-model-pilot/pydicom__pydicom-965/baseline-target.log'],
  ['contract-rejection.json', 'evaluation/independent-model-pilot/pydicom__pydicom-965/evidence/contract-rejection.json'],
  ['platform-native.contract.json', 'config/platform-native.contract.json'],
  ['platform-native.contract.schema.json', 'schemas/platform-native.contract.schema.json'],
  ['Dockerfile.native', 'Dockerfile.native'],
  ['native-runner-smoke.sh', 'scripts/native-runner-smoke.sh'],
  ['write-native-runner-report.mjs', 'scripts/write-native-runner-report.mjs']
];

let extracted = 0;
for (const [destName, srcPath] of fromCodeZip) {
  try {
    execFileSync('unzip', ['-j', '-o', codeZip, srcPath, '-d', tmpDir], { stdio: 'pipe' });
    extracted += 1;
  } catch {
    // 文件可能在代码包中不存在，从工作树直接复制
    const srcFile = join(root, srcPath);
    if (existsSync(srcFile)) {
      copyFileSync(srcFile, join(tmpDir, destName));
      extracted += 1;
    }
  }
}

// 从 deliverables 复制所有文件
for (const file of readdirSync(deliverables)) {
  const src = join(deliverables, file);
  if (existsSync(src) && file !== 'DevOrbit_复赛提交总包.zip') {
    try { copyFileSync(src, join(tmpDir, file)); } catch { /* 跳过目录 */ }
  }
}

// 打包总包（扁平化）
rmSync(totalZip, { force: true });
execFileSync('bash', ['-c', `cd "${tmpDir}" && zip -j -q "${totalZip}" *`], { stdio: 'pipe' });

// 验证
const entries = execFileSync('unzip', ['-Z1', totalZip], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log(`PASS total bundle: ${entries.length} files, ${extracted} extracted from code ZIP`);

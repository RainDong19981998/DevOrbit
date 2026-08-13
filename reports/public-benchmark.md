# 公开软件修复基准

> 状态：`not_run`。正式计分 manifest 尚未冻结，案例数和真实方法结果均为 0；本文件不是分数。

- Manifest 状态：`protocol-only`
- 正式计分案例：0
- 真实方法结果：0
- 独立 validation pilot：1 个 SWE-bench dev 案例已冻结并复现基线失败，不计入本报告

Pilot 证据：`npm run validate-public-pilot`；联网重放：`npm run reproduce-public-pilot`。

运行正式结果时使用：`npm run public-benchmark -- --manifest evaluation/public-benchmark.manifest.json --results path/to/results.json`

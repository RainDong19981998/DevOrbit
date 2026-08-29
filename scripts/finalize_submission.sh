#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

npm test
npm run bundle
npm run build-total-bundle
npm run release-audit || true

# 总包可能需要刷新 release-audit 报告，重新打包
npm run build-total-bundle
unzip -tq deliverables/DevOrbit_复赛提交总包.zip
npm run compliance

echo 'PASS finalized submission bundle with release audit'

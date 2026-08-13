#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

npm run verify-all
npm run bundle-submission
npm run release-audit

zip -qj deliverables/DevOrbit_初赛提交总包.zip \
  reports/release-audit.md \
  reports/release-audit.json
unzip -tq deliverables/DevOrbit_初赛提交总包.zip
npm run compliance

echo 'PASS finalized submission bundle with release audit'

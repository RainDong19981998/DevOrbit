#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

npm run build-supporting-pdfs
npm run bundle
npm run write-checksums

out='deliverables/DevOrbit_初赛提交总包.zip'
rm -f "$out"
zip -qj "$out" \
  deliverables/DevOrbit_初赛方案.pdf \
  deliverables/DevOrbit_初赛方案.pptx \
  deliverables/DevOrbit_初赛可执行代码包.zip \
  deliverables/DevOrbit_演示视频.mp4 \
  deliverables/DevOrbit_演示视频封面.png \
  deliverables/DevOrbit_初赛讲解视频_自动语音版.mp4 \
  deliverables/DevOrbit_Agent-Identity清单.pdf \
  deliverables/DevOrbit_Skill清单.pdf \
  deliverables/DevOrbit_工具与云产品清单.pdf \
  deliverables/DevOrbit_威胁模型.pdf \
  deliverables/DevOrbit_证据索引.pdf \
  deliverables/DevOrbit_对照与消融评测.pdf \
  deliverables/DevOrbit_对抗安全评测.pdf \
  deliverables/交付物_SHA256.txt \
  docs/作品简介.md \
  docs/官网提交粘贴稿.md \
  docs/提交清单.md \
  docs/评委90秒验收.md \
  docs/第三方依赖与合规清单.md \
  docs/演示脚本.md \
  docs/威胁模型.md \
  docs/证据索引.md \
  reports/agentteams-contract.md \
  reports/benchmark.md \
  reports/security-evaluation.md

unzip -tq "$out"
echo 'PASS built initial submission bundle'

#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/worker-packages/dist"
official_sls="$root/third_party/aliyun/alibabacloud-sls-query-0.0.2-devorbit-curated.zip"
official_sls_sha='0ac29b58e60a10ca67bc900f447daa962683e9986f14a35a90d198daa9aa21e7'
rm -rf "$out"
mkdir -p "$out"

printf '%s  %s\n' "$official_sls_sha" "$official_sls" | sha256sum -c - >/dev/null

while IFS=: read -r worker skill; do
  src="$root/worker-packages/$worker"
  rm -rf "$src"
  mkdir -p "$src/config" "$src/skills/$skill"
  cp "$root/skills/$skill/SKILL.md" "$src/skills/$skill/SKILL.md"
  cp "$root/skills/$skill/agents/openai.yaml" "$src/skills/$skill/openai.yaml"
  if [[ "$worker" == 'intake-worker' || "$worker" == 'rca-worker' ]]; then
    mkdir -p "$src/skills/alibabacloud-sls-query"
    unzip -q "$official_sls" -d "$src/skills/alibabacloud-sls-query"
  fi
  sed "s/__WORKER__/$worker/g; s/__SKILL__/$skill/g" "$root/worker-packages/templates/manifest.json" > "$src/manifest.json"
  sed "s/__WORKER__/$worker/g; s/__SKILL__/$skill/g" "$root/worker-packages/templates/AGENTS.md" > "$src/config/AGENTS.md"
  sed "s/__WORKER__/$worker/g; s/__SKILL__/$skill/g" "$root/worker-packages/templates/SOUL.md" > "$src/config/SOUL.md"
  (cd "$src" && zip -qr "$out/$worker.zip" manifest.json config skills)
done <<'EOF'
intake-worker:signal-fusion
impact-worker:impact-map
rca-worker:evidence-rca
patch-worker:patch-plan
verify-worker:test-gate
release-worker:release-guard
learning-worker:knowledge-card
EOF

echo "PASS built 7 AgentTeams worker packages"

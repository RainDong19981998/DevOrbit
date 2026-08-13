#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
agt_bin=${AGT_BIN:-agt}
mcp_url=${MCP_URL:-}

if ! command -v "$agt_bin" >/dev/null 2>&1; then
  echo "AgentTeams CLI not found: $agt_bin" >&2
  exit 1
fi
if [[ -z "$mcp_url" || "$mcp_url" == *devorbit.example* ]]; then
  echo "Set MCP_URL to the full AgentTeams-reachable DevOrbit MCP endpoint." >&2
  exit 1
fi
if [[ ! "$mcp_url" =~ ^https?:// ]]; then
  echo "MCP_URL must be an absolute HTTP(S) URL." >&2
  exit 1
fi

cd "$root"
bash scripts/package_workers.sh

while IFS=: read -r worker _skill; do
  "$agt_bin" apply worker \
    --name "$worker" \
    --zip "$root/worker-packages/dist/$worker.zip" \
    --runtime openclaw
done <<'EOF'
intake-worker:signal-fusion
impact-worker:impact-map
rca-worker:evidence-rca
patch-worker:patch-plan
verify-worker:test-gate
release-worker:release-guard
learning-worker:knowledge-card
EOF

manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT
node scripts/render-agentteams-config.mjs --mcp-url "$mcp_url" --out "$manifest"
"$agt_bin" apply -f "$manifest"

"$agt_bin" get team devorbit-delivery-team
echo "PASS applied DevOrbit to AgentTeams v1.2.2-compatible resources"

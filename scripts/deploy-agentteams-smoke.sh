#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
log="$tmp/agt.log"
fake="$tmp/agt"

cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

cat >"$fake" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_AGT_LOG"
if [[ "$1 $2" == "apply worker" ]]; then
  zip=''
  while (($#)); do
    [[ "$1" == "--zip" ]] && { zip=$2; break; }
    shift
  done
  [[ -n "$zip" && -f "$zip" ]]
  unzip -t "$zip" >/dev/null
elif [[ "$1 $2" == "apply -f" ]]; then
  manifest=$3
  [[ -f "$manifest" ]]
  [[ $(rg -o 'https://smoke.example/devorbit/mcp' "$manifest" | wc -l) -eq 10 ]]
  ! rg -q 'devorbit\.example' "$manifest"
elif [[ "$1 $2 $3" == "get team devorbit-delivery-team" ]]; then
  printf 'team/devorbit-delivery-team Active\n'
fi
EOF
chmod +x "$fake"

FAKE_AGT_LOG="$log" AGT_BIN="$fake" MCP_URL='https://smoke.example/devorbit/mcp' \
  bash "$root/scripts/deploy_agentteams.sh" >/dev/null

[[ $(rg -c '^apply worker ' "$log") -eq 7 ]]
[[ $(rg -c '^apply -f ' "$log") -eq 1 ]]
[[ $(rg -c '^get team devorbit-delivery-team$' "$log") -eq 1 ]]
[[ $(sed -n '1p' "$log") == apply\ worker* ]]
[[ $(tail -n 1 "$log") == 'get team devorbit-delivery-team' ]]

if FAKE_AGT_LOG="$log" AGT_BIN="$fake" MCP_URL='https://devorbit.example/mcp' \
  bash "$root/scripts/deploy_agentteams.sh" >/dev/null 2>&1; then
  echo 'placeholder MCP URL was not rejected' >&2
  exit 1
fi

echo 'PASS AgentTeams deploy choreography: 7 ZIP uploads, overlay apply, Team verification, placeholder rejection'

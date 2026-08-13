#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

image=${DEVORBIT_IMAGE:-devorbit:0.5.1-smoke}
node_image=${DEVORBIT_NODE_IMAGE:-node:22.18.0-bookworm-slim}
report=${DEVORBIT_CONTAINER_REPORT:-reports/container-smoke.json}
container="devorbit-smoke-$$"
token="devorbit-container-smoke-$$"
cid=''

cleanup() {
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  if [[ ${KEEP_DEVORBIT_SMOKE_IMAGE:-0} != 1 ]]; then docker image rm -f "$image" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

docker build --pull=false --build-arg "NODE_IMAGE=$node_image" -t "$image" .

configured_user=$(docker image inspect "$image" --format '{{.Config.User}}')
[[ "$configured_user" == '10001:10001' ]] || { echo "FAIL image user is $configured_user"; exit 1; }

cid=$(docker run -d \
  --name "$container" \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 128 \
  --memory 512m \
  -e "DEVORBIT_CONTROL_TOKEN=$token" \
  -p 127.0.0.1::4173 \
  "$image")

port=$(docker port "$cid" 4173/tcp | sed -E 's/.*:([0-9]+)$/\1/')
base="http://127.0.0.1:$port"

ready=0
for _ in $(seq 1 60); do
  if curl -fsS "$base/api/health" >/dev/null 2>&1; then ready=1; break; fi
  if ! docker inspect "$cid" --format '{{.State.Running}}' | grep -qx true; then
    docker logs "$cid" >&2
    echo 'FAIL container exited before becoming ready' >&2
    exit 1
  fi
  sleep 0.25
done
[[ "$ready" == 1 ]] || { docker logs "$cid" >&2; echo 'FAIL container did not become ready' >&2; exit 1; }

runtime_uid=$(docker exec "$cid" id -u)
[[ "$runtime_uid" == 10001 ]] || { echo "FAIL runtime uid is $runtime_uid"; exit 1; }

health_status=''
for _ in $(seq 1 60); do
  health_status=$(docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')
  [[ "$health_status" == healthy ]] && break
  sleep 0.25
done
[[ "$health_status" == healthy ]] || { docker inspect "$cid" --format '{{json .State.Health}}' >&2; exit 1; }

read_only=$(docker inspect "$cid" --format '{{.HostConfig.ReadonlyRootfs}}')
cap_drop=$(docker inspect "$cid" --format '{{.HostConfig.CapDrop}}')
security_options=$(docker inspect "$cid" --format '{{json .HostConfig.SecurityOpt}}')
no_new_privileges=false
[[ "$security_options" == *no-new-privileges* ]] && no_new_privileges=true
image_id=$(docker image inspect "$image" --format '{{.Id}}')
[[ "$read_only" == true ]] || { echo 'FAIL root filesystem is writable'; exit 1; }
[[ "$cap_drop" == '[ALL]' ]] || { echo 'FAIL capabilities were not dropped'; exit 1; }
[[ "$no_new_privileges" == true ]] || { echo 'FAIL no-new-privileges is disabled'; exit 1; }

CONTAINER_SMOKE_URL="$base" \
CONTAINER_SMOKE_TOKEN="$token" \
CONTAINER_SMOKE_NODE_IMAGE="$node_image" \
CONTAINER_SMOKE_IMAGE="$image" \
CONTAINER_SMOKE_IMAGE_ID="$image_id" \
CONTAINER_SMOKE_UID="$runtime_uid" \
CONTAINER_SMOKE_READ_ONLY="$read_only" \
CONTAINER_SMOKE_CAP_DROP="$cap_drop" \
CONTAINER_SMOKE_NO_NEW_PRIVILEGES="$no_new_privileges" \
CONTAINER_SMOKE_HEALTH="$health_status" \
CONTAINER_SMOKE_REPORT="$report" \
node scripts/container-smoke.mjs

echo "PASS hardened container: uid=10001, read-only rootfs, cap-drop=ALL, health=$health_status"

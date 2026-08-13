#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

image=${DEVORBIT_NATIVE_IMAGE:-devorbit:0.6.0-native-smoke}
node_image=${DEVORBIT_NODE_IMAGE:-node:22.18.0-bookworm-slim}
debian_mirror=${DEVORBIT_DEBIAN_MIRROR:-https://deb.debian.org}
report=${DEVORBIT_NATIVE_RUNNER_REPORT:-reports/native-runner-smoke.json}
container="devorbit-native-smoke-$$"
token="devorbit-native-smoke-$$"
volume="devorbit-native-idempotency-$$"
cid=''

cleanup() {
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
  if [[ ${KEEP_DEVORBIT_NATIVE_IMAGE:-0} != 1 ]]; then docker image rm -f "$image" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

docker volume create "$volume" >/dev/null
docker build --pull=false --network host \
  --build-arg "NODE_IMAGE=$node_image" \
  --build-arg "DEBIAN_MIRROR=$debian_mirror" \
  -f Dockerfile.native -t "$image" .

configured_user=$(docker image inspect "$image" --format '{{.Config.User}}')
[[ "$configured_user" == '10001:10001' ]] || { echo "FAIL native image user is $configured_user"; exit 1; }

git_version=$(docker run --rm \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint git "$image" --version)
[[ "$git_version" == 'git version 2.39.5' ]] || { echo "FAIL unexpected Git runtime: $git_version"; exit 1; }

clone_commit=$(docker run --rm \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$root/fixtures/checkout-service,dst=/fixture,readonly" \
  --entrypoint sh "$image" -c 'cp -R /fixture /tmp/seed && git -C /tmp/seed init --quiet -b main && git -C /tmp/seed -c user.name=DevOrbit -c user.email=devorbit@localhost add . && git -C /tmp/seed -c user.name=DevOrbit -c user.email=devorbit@localhost commit --quiet -m seed && git clone --quiet file:///tmp/seed /tmp/repository && git -C /tmp/repository rev-parse HEAD')
[[ "$clone_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'FAIL native image did not clone a real Git repository'; exit 1; }

cid=$(docker run -d \
  --name "$container" \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777 \
  --mount "type=volume,src=$volume,dst=/var/lib/devorbit/idempotency" \
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
  sleep 0.25
done
[[ "$ready" == 1 ]] || { docker logs "$cid" >&2; echo 'FAIL native container did not become ready' >&2; exit 1; }

runtime_uid=$(docker exec "$cid" id -u)
runtime_git=$(docker exec "$cid" git --version)
environment=$(curl -fsS "$base/api/health" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.parse(s).environment))")
image_id=$(docker image inspect "$image" --format '{{.Id}}')
read_only=$(docker inspect "$cid" --format '{{.HostConfig.ReadonlyRootfs}}')
cap_drop=$(docker inspect "$cid" --format '{{.HostConfig.CapDrop}}')
security_options=$(docker inspect "$cid" --format '{{json .HostConfig.SecurityOpt}}')
idempotency_mount=$(docker inspect "$cid" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/devorbit/idempotency"}}{{.Destination}}{{end}}{{end}}')
no_new_privileges=false
[[ "$security_options" == *no-new-privileges* ]] && no_new_privileges=true

NATIVE_RUNNER_REPORT="$report" \
NATIVE_RUNNER_IMAGE="$image" \
NATIVE_RUNNER_IMAGE_ID="$image_id" \
NATIVE_RUNNER_NODE_IMAGE="$node_image" \
NATIVE_RUNNER_GIT_VERSION="$runtime_git" \
NATIVE_RUNNER_CLONE_COMMIT="$clone_commit" \
NATIVE_RUNNER_UID="$runtime_uid" \
NATIVE_RUNNER_ENVIRONMENT="$environment" \
NATIVE_RUNNER_READ_ONLY="$read_only" \
NATIVE_RUNNER_CAP_DROP="$cap_drop" \
NATIVE_RUNNER_NO_NEW_PRIVILEGES="$no_new_privileges" \
NATIVE_RUNNER_IDEMPOTENCY_MOUNT="$idempotency_mount" \
node scripts/write-native-runner-report.mjs

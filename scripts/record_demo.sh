#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PORT=${DEMO_RECORD_PORT:-4195}
DISPLAY_ID=${DEMO_RECORD_DISPLAY:-:97}
OUT="$ROOT/deliverables/DevOrbit_演示视频.mp4"
PROFILE="$ROOT/.firefox-record-profile"

server_pid=''
xvfb_pid=''
browser_pid=''

cleanup() {
  [[ -n "$browser_pid" ]] && kill "$browser_pid" 2>/dev/null || true
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
  [[ -n "$xvfb_pid" ]] && kill "$xvfb_pid" 2>/dev/null || true
  rm -rf "$PROFILE"
}
trap cleanup EXIT

cd "$ROOT"
PORT="$PORT" node server.js >/tmp/devorbit-record-server.log 2>&1 &
server_pid=$!
Xvfb "$DISPLAY_ID" -screen 0 1280x800x24 -nolisten tcp >/tmp/devorbit-record-xvfb.log 2>&1 &
xvfb_pid=$!

for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null; then break; fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null

rm -rf "$PROFILE"
mkdir -p "$PROFILE"
cp scripts/firefox-demo-user.js "$PROFILE/user.js"
chmod 700 "$PROFILE"

DISPLAY="$DISPLAY_ID" firefox --no-remote --profile "$PROFILE" --kiosk \
  "http://127.0.0.1:$PORT/?demo=happy-path&delay=10000" >/tmp/devorbit-record-firefox.log 2>&1 &
browser_pid=$!

sleep 4
ffmpeg -hide_banner -loglevel error \
  -f x11grab -framerate 30 -video_size 1280x800 -i "$DISPLAY_ID" \
  -t 26 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -movflags +faststart -an -y "$OUT"

echo "PASS recorded $OUT"

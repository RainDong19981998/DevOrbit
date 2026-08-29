#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PORT=${DEMO_RECORD_PORT:-4195}
DISPLAY_ID=${DEMO_RECORD_DISPLAY:-:97}
OUT="$ROOT/deliverables/DevOrbit_演示视频.mp4"
NARRATED="$ROOT/deliverables/DevOrbit_演示视频_语音讲解版.mp4"
COVER="$ROOT/deliverables/DevOrbit_演示视频封面.png"
PRODUCT="$ROOT/deliverables/DevOrbit_产品界面.png"
PROFILE="$ROOT/.firefox-record-profile"
TRACK="/tmp/zhanlu/narration/full-track.mp3"

DURATION=$(node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/app/tour-timeline.js', 'utf8');
const json = src.replace(/^window\.TOUR_TIMELINE = /, '').replace(/;\s*$/, '');
console.log(Math.ceil(JSON.parse(json).totalDuration) + 2);
")

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
  "http://127.0.0.1:$PORT/?demo=tour&tourDelay=4000" >/tmp/devorbit-record-firefox.log 2>&1 &
browser_pid=$!

sleep 9
ffmpeg -hide_banner -loglevel error \
  -f x11grab -framerate 30 -video_size 1280x800 -i "$DISPLAY_ID" \
  -t "$DURATION" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -movflags +faststart -an -y "$OUT"

if [[ -f "$TRACK" ]]; then
  ffmpeg -hide_banner -loglevel error \
    -i "$OUT" -i "$TRACK" \
    -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k \
    -movflags +faststart -shortest -y "$NARRATED"
  echo "PASS narrated version: $NARRATED"
fi

ffmpeg -hide_banner -loglevel error -ss 3 -i "$OUT" -frames:v 1 -y "$COVER"
ffmpeg -hide_banner -loglevel error -ss 62 -i "$OUT" -frames:v 1 \
  -vf 'crop=1280:720:0:40' -y "$PRODUCT"

echo "PASS recorded $OUT (${DURATION}s tour mode) and refreshed cover/product screenshots"

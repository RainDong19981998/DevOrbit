#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
out="$root/deliverables/DevOrbit_初赛讲解视频_无配音版.mp4"
font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
[[ -f "$font" ]] || font='/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf'
trap 'rm -rf "$tmp"' EXIT

# The explainer intentionally contains no audio stream. Captions carry the
# submission narrative while keeping the evidence frames independently usable.
pages=(1 2 3 4 5 demo 13 14 15 16 17 18)
durations=(8 12 10 10 10 34 10 10 10 10 8 8)
captions=(
  'DevOrbit：自动处理线上缺陷的多 Agent 研发平台'
  '输入问题和代码仓，输出根因、补丁、测试、发布决策与复盘报告'
  '痛点：研发、测试和发布跨系统交接，证据不断丢失'
  '实际案例：支付重复下单，从异常信号到修复证据包'
  '这就是 DevOrbit 的研发缺陷处理驾驶舱'
  '现场演示：输入任务 → Agent 协同 → 人工审批 → 检查证据'
  '当前价值：把不可控交接变成可检查的执行结果'
  '四步使用：输入、观察、审批、检查证据'
  '已验证与尚未验证严格分开，不虚构生产收益'
  '为什么使用多 Agent：职责隔离、独立验证和最小权限'
  '下一步：公开缺陷对照评测和真实工具链接入'
  '每次判断有依据，每次动作有边界，每次结果可验证'
)

mkdir -p "$tmp/pages" "$tmp/segments"
for page in 1 2 3 4 5 13 14 15 16 17 18; do
  pdftoppm -f "$page" -l "$page" -singlefile -png -r 120 \
    "$root/deliverables/DevOrbit_复赛方案.pdf" "$tmp/pages/page-$page" >/dev/null
done

for index in "${!pages[@]}"; do
  printf '%s' "${captions[$index]}" >"$tmp/caption-$index.txt"
  if [[ "${pages[$index]}" == demo ]]; then
    ffmpeg -hide_banner -loglevel error \
      -i "$root/deliverables/DevOrbit_演示视频.mp4" \
      -filter_complex "[0:v]scale=1152:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf3f1e9,drawbox=x=0:y=ih-82:w=iw:h=82:color=0x12231ddd:t=fill,drawtext=fontfile='$font':textfile='$tmp/caption-$index.txt':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-56[v]" \
      -map '[v]' -an -t "${durations[$index]}" -c:v libx264 -preset medium -crf 20 \
      -r 30 -pix_fmt yuv420p -y "$tmp/segments/$index.mp4"
  else
    ffmpeg -hide_banner -loglevel error -loop 1 -framerate 30 \
      -i "$tmp/pages/page-${pages[$index]}.png" \
      -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf3f1e9,drawbox=x=0:y=ih-82:w=iw:h=82:color=0x12231ddd:t=fill,drawtext=fontfile='$font':textfile='$tmp/caption-$index.txt':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-56[v]" \
      -map '[v]' -an -t "${durations[$index]}" -c:v libx264 -preset medium -crf 20 \
      -r 30 -pix_fmt yuv420p -y "$tmp/segments/$index.mp4"
  fi
  printf "file '%s'\n" "$tmp/segments/$index.mp4" >>"$tmp/concat.txt"
done

ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i "$tmp/concat.txt" \
  -map 0:v:0 -an -c copy -movflags +faststart -y "$out"

echo "PASS built silent explainer: $out"

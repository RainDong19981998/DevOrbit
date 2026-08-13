#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
out="$root/deliverables/DevOrbit_初赛讲解视频_自动语音版.mp4"
raw="$tmp/explainer-raw.mp4"
monitor=${PULSE_MONITOR_SOURCE:-auto_null.monitor}
font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
[[ -f "$font" ]] || font='/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf'
trap 'rm -rf "$tmp"' EXIT

pages=(1 2 4 5 6 demo 8 9 10 11 12 13)
captions=(
  'DevOrbit：多 Agent 软件研发闭环引擎'
  '真实问题：事实分散，跨角色交接丢失证据'
  '架构：Team Leader → Skill → MCP → Tool'
  '七个职能 Worker，共享一份 Case State'
  '根因结论必须绑定现场与历史引用'
  '真实浏览器与 API：审批暂停、同 Trace 续跑'
  'L2 强制审批；指标退化自动回滚'
  '发布结果写回知识，形成下一次任务的上下文'
  '七个自定义 Skill，加一个官方日志查询 Skill'
  '工程证据：真实测试、MCP、原生连接器与契约审计'
  '开放演进：从原生连接器到厂商账号现场闭环'
  'DevOrbit：可运行、可验证、可审计、可复用'
)
narrations=(
  '大家好，这是 DevOrbit，多智能体软件研发闭环引擎。它把一次线上缺陷，从信号进入到根因、补丁、测试、灰度和知识沉淀，组织成一条可以复核的证据链。'
  '研发缺陷真正昂贵的部分，通常不是写补丁，而是事实散落在工单、反馈、日志、指标、代码和流水线里。不同角色反复对齐上下文，证据也容易在交接中丢失。'
  'DevOrbit 将判断、能力、连接和证据分层。团队负责人负责任务拆解和状态推进，Worker 通过版本化 Skill 调用 MCP 工具，所有结果回到同一份 Case State 和 Trace。'
  '七个 Worker 分别负责信号归并、影响分析、根因诊断、补丁计划、测试门禁、发布治理和知识沉淀。异常不会被隐藏，低置信、测试失败、审批拒绝和灰度退化都有明确分支。'
  '根因不是一句猜测。系统把配置变更、超时日志、错误率、代码位置和历史案例引用绑定到同一时间窗。置信度不足零点八时，自动修复立即停止并请求补证。'
  '这里是真实浏览器和真实 API 录屏。补丁 Worker 先在隔离样例仓复现三个失败，再修改两个文件；验证 Worker 运行同一批测试得到四项通过。流程暂停在二级审批，批准后从同一个 Case 和 Trace 继续，错误率从百分之七点四下降到百分之零点三。'
  '高风险动作默认停在门禁前。只读诊断和沙箱修改可以自主执行，生产小流量灰度必须人工确认；如果错误率、延迟或业务指标越界，系统执行预置回滚，不等待模型再次判断。'
  '上线不是终点。学习 Worker 把根因、补丁、测试、审批、灰度和最终结果合成知识卡，并生成预防规则。下次相似案例进入时，根因 Worker 可以检索并引用这次经验。'
  '能力层包含七个自定义 Skill，并锁定官方日志查询 Skill 的合规快照给信号和根因 Worker。真实部署时它只使用最小只读权限；当前无密钥演示使用本地观测适配器，不伪装成云调用。'
  '工程证据可以一条命令复核：二十九项单元测试，七个闭环案例，五个安全分支、六个对抗安全案例、四个检索案例和原生平台连接器八项检查全部通过。AgentTeams 资源、Worker 包和 Skill 契约是一百四十项全通过；七组对照和消融显示关闭核心门禁会退化。'
  '初赛版本仍可无密钥、无数据库运行；同时已实现 GitHub、Git、Jenkins 和 Argo Rollouts 原生连接器，并用本地协议端点加真实 Git 与测试命令完成 8/8 证据。厂商账号、生产集群和公开缺陷分数仍单独验证，不把本地证据包装成生产收益。'
  'DevOrbit 不替代专家判断，而是把判断所需的证据、动作边界和结果验证组织起来。最终目标是让每个研发团队，都拥有一支可运行、可验证、可审计、可复用的智能交付小队。'
)

mkdir -p "$tmp/pages" "$tmp/audio" "$tmp/segments"
for page in 1 2 4 5 6 8 9 10 11 12 13; do
  pdftoppm -f "$page" -l "$page" -singlefile -png -r 120 \
    "$root/deliverables/DevOrbit_初赛方案.pdf" "$tmp/pages/page-$page" >/dev/null
done

synthesize() {
  local index=$1 text=$2 raw="$tmp/audio/$index.raw" wav="$tmp/audio/$index.wav"
  parec --format=s16le --rate=44100 --channels=2 --device="$monitor" "$raw" >/dev/null 2>&1 &
  local recorder=$!
  sleep 0.35
  spd-say -w -o espeak-ng -l cmn -y 'Chinese (Mandarin)+female1' -r -5 "$text"
  sleep 0.45
  kill "$recorder" 2>/dev/null || true
  wait "$recorder" 2>/dev/null || true
  ffmpeg -hide_banner -loglevel error -f s16le -ar 44100 -ac 2 -i "$raw" \
    -af 'silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:stop_threshold=-50dB,loudnorm=I=-16:LRA=7:TP=-1.5,apad=pad_dur=0.35' \
    -c:a pcm_s16le -y "$wav"
}

for index in "${!pages[@]}"; do
  synthesize "$index" "${narrations[$index]}"
  printf '%s' "${captions[$index]}" >"$tmp/caption-$index.txt"
  if [[ "${pages[$index]}" == demo ]]; then
    ffmpeg -hide_banner -loglevel error -i "$root/deliverables/DevOrbit_演示视频.mp4" -i "$tmp/audio/$index.wav" \
      -filter_complex "[0:v]scale=1152:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf3f1e9,tpad=stop_mode=clone:stop_duration=20,drawbox=x=0:y=ih-82:w=iw:h=82:color=0x12231ddd:t=fill,drawtext=fontfile='$font':textfile='$tmp/caption-$index.txt':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-56[v]" \
      -map '[v]' -map 1:a -c:v libx264 -preset medium -crf 20 -r 30 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -y "$tmp/segments/$index.mp4"
  else
    ffmpeg -hide_banner -loglevel error -loop 1 -framerate 30 -i "$tmp/pages/page-${pages[$index]}.png" -i "$tmp/audio/$index.wav" \
      -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf3f1e9,drawbox=x=0:y=ih-82:w=iw:h=82:color=0x12231ddd:t=fill,drawtext=fontfile='$font':textfile='$tmp/caption-$index.txt':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-56[v]" \
      -map '[v]' -map 1:a -c:v libx264 -preset medium -crf 20 -r 30 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -y "$tmp/segments/$index.mp4"
  fi
  printf "file '%s'\n" "$tmp/segments/$index.mp4" >>"$tmp/concat.txt"
done

ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i "$tmp/concat.txt" -c copy -y "$raw"
ffmpeg -hide_banner -loglevel error -i "$raw" \
  -filter_complex '[0:v]setpts=PTS/1.42[v];[0:a]atempo=1.42[a]' \
  -map '[v]' -map '[a]' -c:v libx264 -preset medium -crf 20 -r 30 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart -y "$out"
echo "PASS built narrated explainer: $out"

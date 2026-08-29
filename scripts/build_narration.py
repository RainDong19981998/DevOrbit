#!/usr/bin/python3
"""V1.0.0 演示视频旁白生成：CosyVoice 逐句合成 -> 测量时长 -> 生成导览时间轴与完整音轨。"""
import json
import os
import subprocess
import sys

import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer, AudioFormat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
WORK = '/tmp/zhanlu/narration'
os.makedirs(WORK, exist_ok=True)

env_file = os.path.join(ROOT, '.env')
if os.path.exists(env_file):
    with open(env_file, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

dashscope.api_key = os.environ.get('DASHSCOPE_API_KEY')
VOICE = os.environ.get('DEVORBIT_NARRATION_VOICE', 'longanyang')

SCENES = [
    {'id': 'opening', 'action': 'top',
     'text': 'DevOrbit，多智能体研发闭环平台。输入问题、日志与代码仓，输出根因、补丁、测试报告与可审计证据。'},
    {'id': 'collaboration', 'action': 'run',
     'text': '七个职能智能体分工协同：根因定位、补丁生成、独立验证，各由专职智能体完成，全程记录在同一条追踪里。'},
    {'id': 'gates', 'action': 'scroll:#workspace',
     'text': '高风险动作默认停在门禁前：补丁必须通过独立测试，发布需要签名审批，模型无法绕过。'},
    {'id': 'canary', 'action': 'scroll:#release',
     'text': '灰度发布伴随服务等级监控，退化即确定性回滚；每次事故沉淀为结构化经验，服务下一次诊断。'},
    {'id': 'evidence', 'action': 'scroll:#evidence',
     'text': '全程由链式哈希证据链绑定，篡改任何一环都可被检出，证据可以独立复核。'},
    {'id': 'skill-trace', 'action': 'scroll:#skills',
     'text': '技能调用证据：八个技能全部版本化管理，每次运行在追踪中记录技能版本与内容摘要，任何结果都能定位到产生它的技能版本。'},
    {'id': 'self-healing', 'action': 'run:self-healing',
     'text': '异常处理演示：第一版补丁让三项测试失败，失败日志回传修复智能体，二次生成补全幂等保护，测试转绿。三次尝试仍失败则熔断降级人工。'},
    {'id': 'benchmark', 'action': 'scroll:#benchmark',
     'text': '在冻结的三十案例公开基准上，编辑式补丁引擎把闭环修复率从零提升到百分之十，补丁可应用率提升到百分之五十六。'},
    {'id': 'ablation', 'action': 'hold',
     'text': '管道、模型、架构三维消融完全可复现；四十二条失败经验自动沉淀，在第二轮运行中召回为警示。'},
    {'id': 'closing', 'action': 'hold',
     'text': 'DevOrbit，让每个研发团队，都有一支可验证的交付小队。'},
]

GAP_AFTER_VOICE = 2.2
LEAD = 1.2


def probe_duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


timeline_scenes = []
audio_files = []
cursor = LEAD
for index, scene in enumerate(SCENES):
    mp3 = os.path.join(WORK, f'{index:02d}-{scene["id"]}.mp3')
    synthesizer = SpeechSynthesizer(model='cosyvoice-v3-flash', voice=VOICE,
                                    format=AudioFormat.MP3_22050HZ_MONO_256KBPS)
    audio = synthesizer.call(scene['text'])
    if not audio:
        print(f'FAIL no audio for scene {scene["id"]}', file=sys.stderr)
        sys.exit(1)
    with open(mp3, 'wb') as f:
        f.write(audio)
    duration = probe_duration(mp3)
    timeline_scenes.append({
        'id': scene['id'], 'at': round(cursor, 2), 'voiceDuration': round(duration, 2),
        'caption': scene['text'], 'action': scene['action'],
    })
    audio_files.append({'file': mp3, 'at': cursor})
    cursor += duration + GAP_AFTER_VOICE
    print(f'  scene {index} {scene["id"]}: voice={duration:.2f}s at={cursor - duration - GAP_AFTER_VOICE:.2f}s')

total = round(cursor + 1.5, 2)
timeline = {'totalDuration': total, 'voice': VOICE, 'scenes': timeline_scenes}
with open(os.path.join(ROOT, 'app', 'tour-timeline.js'), 'w', encoding='utf-8') as f:
    f.write('window.TOUR_TIMELINE = ')
    json.dump(timeline, f, ensure_ascii=False, indent=1)
    f.write(';\n')

filter_parts = []
inputs = []
for i, item in enumerate(audio_files):
    inputs.extend(['-i', item['file']])
    delay_ms = int(item['at'] * 1000)
    filter_parts.append(f'[{i}:a]adelay={delay_ms}|{delay_ms}[a{i}]')
mix_inputs = ''.join(f'[a{i}]' for i in range(len(audio_files)))
filter_complex = ';'.join(filter_parts) + f';{mix_inputs}amix=inputs={len(audio_files)}:normalize=0[out]'
track = os.path.join(WORK, 'full-track.mp3')
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs,
                '-filter_complex', filter_complex, '-map', '[out]',
                '-t', str(total), '-c:a', 'libmp3lame', '-q:a', '2', track], check=True)

print(f'PASS narration: {len(SCENES)} scenes, total={total}s, track={track}')
print(f'timeline written to app/tour-timeline.js')

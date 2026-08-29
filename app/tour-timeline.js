window.TOUR_TIMELINE = {
 "totalDuration": 126.32,
 "voice": "longanyang",
 "scenes": [
  {
   "id": "opening",
   "at": 1.2,
   "voiceDuration": 10.19,
   "caption": "DevOrbit，多智能体研发闭环平台。输入问题、日志与代码仓，输出根因、补丁、测试报告与可审计证据。",
   "action": "top"
  },
  {
   "id": "collaboration",
   "at": 13.59,
   "voiceDuration": 10.79,
   "caption": "七个职能智能体分工协同：根因定位、补丁生成、独立验证，各由专职智能体完成，全程记录在同一条追踪里。",
   "action": "run"
  },
  {
   "id": "gates",
   "at": 26.58,
   "voiceDuration": 9.06,
   "caption": "高风险动作默认停在门禁前：补丁必须通过独立测试，发布需要签名审批，模型无法绕过。",
   "action": "scroll:#workspace"
  },
  {
   "id": "canary",
   "at": 37.84,
   "voiceDuration": 9.51,
   "caption": "灰度发布伴随服务等级监控，退化即确定性回滚；每次事故沉淀为结构化经验，服务下一次诊断。",
   "action": "scroll:#release"
  },
  {
   "id": "evidence",
   "at": 49.55,
   "voiceDuration": 7.68,
   "caption": "全程由链式哈希证据链绑定，篡改任何一环都可被检出，证据可以独立复核。",
   "action": "scroll:#evidence"
  },
  {
   "id": "skill-trace",
   "at": 59.43,
   "voiceDuration": 12.41,
   "caption": "技能调用证据：八个技能全部版本化管理，每次运行在追踪中记录技能版本与内容摘要，任何结果都能定位到产生它的技能版本。",
   "action": "scroll:#skills"
  },
  {
   "id": "self-healing",
   "at": 74.04,
   "voiceDuration": 14.47,
   "caption": "异常处理演示：第一版补丁让三项测试失败，失败日志回传修复智能体，二次生成补全幂等保护，测试转绿。三次尝试仍失败则熔断降级人工。",
   "action": "run:self-healing"
  },
  {
   "id": "benchmark",
   "at": 90.71,
   "voiceDuration": 11.81,
   "caption": "在冻结的三十案例公开基准上，编辑式补丁引擎把闭环修复率从零提升到百分之十，补丁可应用率提升到百分之五十六。",
   "action": "scroll:#benchmark"
  },
  {
   "id": "ablation",
   "at": 104.72,
   "voiceDuration": 9.8,
   "caption": "管道、模型、架构三维消融完全可复现；四十二条失败经验自动沉淀，在第二轮运行中召回为警示。",
   "action": "hold"
  },
  {
   "id": "closing",
   "at": 116.71,
   "voiceDuration": 5.9,
   "caption": "DevOrbit，让每个研发团队，都有一支可验证的交付小队。",
   "action": "hold"
  }
 ]
};

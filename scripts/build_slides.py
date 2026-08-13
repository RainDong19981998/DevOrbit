#!/usr/bin/python3
import os
import subprocess
import time
import uno
from com.sun.star.beans import PropertyValue

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'deliverables')
os.makedirs(OUT, exist_ok=True)

BG = 0xF3F1E9
INK = 0x12231D
GREEN = 0x0E7053
LIME = 0xCCEF73
NAVY = 0x162B35
MUTED = 0x60716A
WHITE = 0xFFFDF7
ORANGE = 0xF06A3A
LINE = 0xD6D9CF

slides = [
    ('DevOrbit', '多 Agent 软件研发闭环引擎', '从缺陷信号到修复确认，把研发协作变成一条可验证、可回放、可复用的证据链。', '初赛方案 · V0.5.1'),
    ('研发缺陷的真正成本，不在写补丁', '事实散落在多个系统，人工反复对齐；修复、测试、审批、灰度和复盘由不同角色接力，证据在交接中丢失。', '5+ 异构信息源\n7 个职能环节\n1 条统一证据链', '场景价值与行业可复制性 · 25%'),
    ('一次支付下单异常的完整案例', '用户反馈：“10:15 后支付页一直转圈，刷新后出现两笔订单。”', '10:02 配置 80 → 8\n10:15 错误率抬升\n10:15 幂等存储超时', '输出：Case · 影响图 · 根因证据 · 补丁/回滚 · 测试/灰度 · 知识卡'),
    ('判断、能力、连接、证据四层解耦', 'Team Leader 统一委派，Worker 通过 Skill 调用 MCP Tool。', '输入 → Team → Skill\n→ MCP 2025-06-18 → Tool', '10 Tools · 15 Calls · Case/Trace/Audit · 人类介入'),
    ('七个职能 Agent，一条状态机', 'Intake · Impact · RCA · Patch · Verify · Release · Learn', 'received → triaged → diagnosed → planned → verified\n→ approval_pending → canary → confirmed → learned', '失败回路：补证 · 返工 · 停止 · 自动回滚'),
    ('根因结论必须能被复核', '首要根因 · 91% · RAG Top-1 KB-HIST-001', '连接池从 80 降为 8，幂等键读写排队超时；客户端重试放大重复创建风险。', '现场证据 + knowledge:// 引用；低置信仍停止'),
    ('修复是最小变更，验证是强制门禁', 'Patch Worker 复制样例仓，先复现失败，再改文件并生成回滚摘要。', 'poolSize: 8 → 80\nqueueTimeoutMs: 800\nduplicateKey → 409', '同一批测试：3 failed → 4 passed · sha256 制品'),
    ('高风险动作，默认停在门禁前', 'Manager 校验 RCA、测试和回滚点，签发 Case/Action/时效受限的 HMAC 回执；Release Worker 只能消费，MCP 服务端再次验签。', 'L0 只读 · L1 沙箱\nL2 签名审批 + 灰度\nL3 只生成方案\n6/6 对抗安全案例', '越权、伪造、过期、跨 Case 重放和 Schema 混淆均 fail closed；指标退化触发确定性回滚。'),
    ('上线不是终点，经验要回到下一次任务', 'KB-20260812-014 · 连接池缩容 + 幂等重试放大', '容量策略校验\n幂等存储水位告警\n重复提交回归纳入门禁', '复盘绑定 Case、代码、测试、审批、灰度和最终结果。'),
    ('把专家经验变成可复用工程资产', '7 自定义 Skill + 1 官方日志 Skill + 6 类 MCP Adapter', '输入输出 Schema\n调用条件与失败处理\n安全边界与证据引用\nGolden Case 评估与版本回滚', '官方 SLS Query v0.0.2 合规快照锁定\n核心 SKILL.md 未修改；来源/差异/摘要可审计\nIntake / RCA 只读接入；默认 Demo 不调用云账号'),
    ('一键运行，现场可复现', 'verify-all / AgentTeams contract / POST /mcp', '7 Worker · OTLP Agent/Tool Span\n10 MCP Tools · 运行时 Schema\n7/7 Golden Cases · 6/6 Security\n7 组对照/消融', 'AgentTeams v1.2.2 · 140/140 契约检查\n完整策略 100% 决策/安全；朴素基线 28.6%\n结果为团队构造仿真，不外推生产收益。'),
    ('从可复现 Demo 到开放研发基础设施', '初赛 V0.5.1 → 复赛 V0.5 → 决赛 V1.0', '真实样例/MCP/RAG/策略 → 公开缺陷集 → 真实平台现场闭环', '开放 Agent/Skill、MCP Server、Schema、策略契约、案例集和评测脚本。'),
    ('让每个研发团队，都有一支可验证的交付小队', 'DevOrbit 不替代专家判断，而是把判断所需的证据、动作的边界和结果的验证组织起来。', '可运行 · 可审计 · 可复用', '谢谢'),
    ('附录 A1 · Agent Identity 清单', '官方字段：Name · Role · Capabilities · Inputs / Outputs · Dependencies · Decision Boundary · Trace', 'DEVORBIT-LEAD｜主控编排\n能：拆解 / 路由 / 状态推进；禁：改代码 / 发布\nI/O：原始任务 + Case → 子任务 / 状态 / 升级\n依赖：7 Worker｜边界：L2/L3 人审\nTrace：父 Span / 状态版本 / 消息 / 升级原因\n\nINTAKE-WORKER｜信号接入\n能：聚合 / 去重 / 定级；禁：推断代码根因\nI/O：5 类信号 → Canonical Case / 时间线\n依赖：SignalFusion + 官方 SLS Query + MCP\n边界：云日志只读；冲突升级｜Trace：信号 / I/O 摘要', 'IMPACT-WORKER｜影响分析\n能：代码检索 / 影响图；禁：写仓库\nI/O：Case + Repo → Impact Graph / 关键文件\n依赖：ImpactMap + Repository Tool\n边界：只读｜Trace：文件摘要 / 工具审计\n\nRCA-WORKER｜根因诊断\n能：候选排序 / 证据评分；禁：无证据下结论\nI/O：时间线 + 影响 + 历史 → 根因 / 证据缺口\n依赖：EvidenceRCA + 官方 SLS Query + KB\n边界：置信度 < 0.80 停止｜Trace：分数 / 引用'),
    ('附录 A2 · Agent Identity 清单', '所有 Worker 共享 Case / Trace；凭据不进入 Worker 上下文，写动作由工具网关按最小权限执行。', 'PATCH-WORKER｜修复计划\n能：沙箱补丁 / 回滚；禁：合并主干\nI/O：根因 + 代码 → 补丁 / 变更计划 / 回滚点\n依赖：PatchPlan + Repository Tool\n边界：仅沙箱；越界升级｜Trace：补丁 / 基线制品\n\nVERIFY-WORKER｜质量门禁\n能：选测 / 测试 / 归档；禁：绕过失败\nI/O：补丁 + 影响 → Test Report / 制品\n依赖：TestGate + CI Tool\n边界：必选测试失败即阻断｜Trace：命令 / 退出码', 'RELEASE-WORKER｜发布治理\n能：审批 / 灰度 / 回滚；禁：L3 自动执行\nI/O：补丁 + 测试 + 审批 + 指标 → 发布决策\n依赖：ReleaseGuard + Release Tool\n边界：L2 人审；退化回滚｜Trace：审批 / 幂等 / 指标\n\nLEARNING-WORKER｜知识沉淀\n能：复盘 / 知识卡；禁：改变生产状态\nI/O：完整 Trace + 结果 → Case Card / 预防规则\n依赖：KnowledgeCard + Knowledge Tool\n边界：脱敏后写入｜Trace：知识引用 / 关联证据'),
    ('附录 B1 · 核心 Skill 清单', '官方字段：类型 / 场景 · I/O · 调用条件 · 依赖 · 失败处理 · 安全 · 复用价值 · 协同关系', 'SIGNALFUSION v1.0｜自定义 / 多源归并\nI/O：Signals → Case｜条件：新信号进入\n依赖：Issue + Observability Tool\n失败 / 安全：解析隔离、冲突人审、只读脱敏\n复用 / 协同：告警工单归并；Intake 形成唯一输入\n\nIMPACTMAP v1.0｜自定义 / 影响分析\nI/O：Case + Repo → Impact Graph｜条件：已归并\n依赖：Repository Tool\n失败 / 安全：索引刷新、证据缺口、仓库只读\n复用 / 协同：变更评审；约束 RCA / Patch 范围', 'EVIDENCERCA v1.0｜自定义 / 根因排序\nI/O：Timeline + Impact + KB → Causes\n条件：至少两类证据｜依赖：Knowledge Tool\n失败 / 安全：低置信停止；结论强制绑定引用\n复用 / 协同：测试 / 生产缺陷；决定能否自动修复\n\nPATCHPLAN v1.0｜自定义 / 最小修复\nI/O：Root Cause + Repo → Plan / Rollback\n条件：置信度 ≥ 0.80｜依赖：Repository Tool\n失败 / 安全：失败回滚沙箱；禁止污染主干\n复用 / 协同：常见修复；把诊断转为可逆变更'),
    ('附录 B2 · 核心 Skill 清单', '7 个自定义 Skill 有回归门禁；官方 Skill 固定门户版本、裁剪差异与摘要。', 'TESTGATE v1.0｜自定义 / 回归门禁\nI/O：Plan + Impact → Test Report / Artifact\n条件：补丁后｜依赖：CI Tool\n失败 / 安全：超时重试；失败阻断；命令白名单\n复用 / 协同：提交 / 发布门禁；给 Release 硬证据\n\nRELEASEGUARD v1.0｜自定义 / 发布治理\nI/O：Plan + Tests + Policy → Release Decision\n条件：测试全绿 + 回滚点｜依赖：Release Tool\n失败 / 安全：审批超时人审；L2/L3；退化回滚\n复用 / 协同：全部发布流程；结果交给 Learn', 'KNOWLEDGECARD v1.0｜自定义 / 复盘沉淀\nI/O：Trace + Outcome → Case Card / 预防规则\n条件：达到终态｜依赖：Knowledge Tool\n失败 / 安全：脱敏失败生成待审草稿，不写入\n\nSLS QUERY v0.0.2｜官方用云 / 日志证据\nI/O：Project + Logstore + Intent → Logs / Aggregates\n条件：显式云配置｜依赖：Aliyun CLI ≥ 3.3.8\n失败 / 安全：无凭据即停止；GetIndex / GetLogsV2 只读\n协同：Intake / RCA；默认 Demo 使用 Fixture 回退')
]

def prop(name, value):
    p = PropertyValue(); p.Name = name; p.Value = value; return p

def add_text(doc, page, text, x, y, w, h, size=18, color=INK, bold=False, font='Noto Sans CJK SC'):
    shape = doc.createInstance('com.sun.star.drawing.TextShape')
    shape.setPosition(uno.createUnoStruct('com.sun.star.awt.Point', x, y))
    shape.setSize(uno.createUnoStruct('com.sun.star.awt.Size', w, h))
    shape.CharFontName = font
    shape.CharHeight = size
    shape.CharColor = color
    shape.CharWeight = 150.0 if bold else 100.0
    shape.TextVerticalAdjust = 0
    shape.TextAutoGrowHeight = False
    page.add(shape)
    shape.getText().setString(text)
    shape.CharFontName = font
    shape.CharHeight = size
    shape.CharColor = color
    shape.CharWeight = 150.0 if bold else 100.0
    return shape

def add_rect(doc, page, x, y, w, h, fill, line=LINE):
    shape = doc.createInstance('com.sun.star.drawing.RectangleShape')
    shape.setPosition(uno.createUnoStruct('com.sun.star.awt.Point', x, y))
    shape.setSize(uno.createUnoStruct('com.sun.star.awt.Size', w, h))
    shape.FillColor = fill; shape.LineColor = line
    page.add(shape); return shape

def build(desktop):
    doc = desktop.loadComponentFromURL('private:factory/simpress', '_blank', 0, ())
    pages = doc.getDrawPages()
    for index, data in enumerate(slides):
        page = pages.getByIndex(0) if index == 0 else pages.insertNewByIndex(index)
        for shape_index in range(page.getCount() - 1, -1, -1):
            page.remove(page.getByIndex(shape_index))
        page.Width = 33866; page.Height = 19050
        dark = index in (0, 3, 5, 8, 11, 14, 16)
        appendix = index >= 13
        add_rect(doc, page, 0, 0, 33866, 19050, NAVY if dark else BG, NAVY if dark else BG)
        fg = WHITE if dark else INK
        accent = LIME if dark else GREEN
        muted = 0xB8C9C2 if dark else MUTED
        add_text(doc, page, f'{index + 1:02d} / {len(slides)}   DEVORBIT', 2000, 1150, 10000, 500, 10, accent, True, 'Liberation Mono')
        add_text(doc, page, data[0], 2000, 2400, 30000, 2100, 26 if appendix else (30 if index else 42), fg, True)
        add_text(doc, page, data[1], 2050, 5000, 28500, 1800, 14 if appendix else (18 if index else 25), accent if index == 0 else muted, index == 0)
        if index == 0:
            add_rect(doc, page, 22500, 3000, 7800, 8500, 0x1E3942, 0x1E3942)
            add_text(doc, page, '缺陷\n→ 根因\n→ 补丁\n→ 验证\n→ 发布\n→ 知识', 24000, 3900, 5000, 6500, 23, LIME, True)
            add_text(doc, page, data[3], 2050, 8900, 8000, 900, 13, fg, True)
        else:
            box_y = 7100 if appendix else 7600
            box_h = 9400 if appendix else 6000
            add_rect(doc, page, 2000, box_y, 14200, box_h, WHITE if not dark else 0x1E3942, LINE if not dark else 0x31505A)
            add_rect(doc, page, 17000, box_y, 14800, box_h, 0xE7EBDD if not dark else 0x203B44, LINE if not dark else 0x31505A)
            left_text = add_text(doc, page, data[2], 2700, 7550 if appendix else 8350, 12700, 8300 if appendix else 4500, 10 if appendix else 19, INK if not dark else WHITE, True)
            right_text = add_text(doc, page, data[3], 17700, 7550 if appendix else 8350, 13400, 8300 if appendix else 4500, 10 if appendix else 17, GREEN if not dark else LIME, True)
            if appendix:
                for shape in (left_text, right_text):
                    shape.CharFontNameAsian = 'Noto Sans CJK SC'
                    shape.CharHeightAsian = 10
                    shape.CharWeightAsian = 150.0
        add_text(doc, page, 'AgentTeams · Skill · MCP 2025-06-18 · RAG · Evidence-first', 2000, 17800, 20500, 350, 9, muted, False, 'Liberation Mono')
        add_text(doc, page, str(index + 1), 30500, 17800, 1400, 350, 9, muted, False, 'Liberation Mono')
    pptx = uno.systemPathToFileUrl(os.path.join(OUT, 'DevOrbit_初赛方案.pptx'))
    pdf = uno.systemPathToFileUrl(os.path.join(OUT, 'DevOrbit_初赛方案.pdf'))
    doc.storeAsURL(pptx, (prop('FilterName', 'Impress MS PowerPoint 2007 XML'), prop('Overwrite', True)))
    doc.storeToURL(pdf, (prop('FilterName', 'impress_pdf_Export'), prop('Overwrite', True)))
    doc.close(True)

if __name__ == '__main__':
    profile = 'file:///tmp/devorbit-lo-profile'
    proc = subprocess.Popen(['libreoffice', '--headless', '--accept=socket,host=localhost,port=2002;urp;StarOffice.ComponentContext', f'-env:UserInstallation={profile}', '--norestore', '--nodefault', '--nofirststartwizard'])
    try:
        local_ctx = uno.getComponentContext()
        resolver = local_ctx.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local_ctx)
        ctx = None
        for _ in range(40):
            try:
                ctx = resolver.resolve('uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext'); break
            except Exception: time.sleep(.25)
        if ctx is None: raise RuntimeError('Could not connect to LibreOffice')
        desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        build(desktop)
    finally:
        proc.terminate(); proc.wait(timeout=10)

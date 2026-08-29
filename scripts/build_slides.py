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
RED = 0xC0392B

# 18 页：P1 封面 · P2 初赛反馈调整点（标红对比）· P3 场景闭环图 · P4-5 架构与风险边界 ·
# P6-11 复杂 Case 主线 · P12-14 数据与知识资产 · P15 对比 · P16 路线图 · P17 可复制性 · P18 结尾
slides = [
    # P1 封面
    ('DevOrbit', '自动处理线上缺陷的多 Agent 研发平台',
     '输入 Issue、日志与代码仓；输出根因、代码补丁、测试报告、发布决策和可审计证据链。',
      'GOAI Agent Infra · 复赛方案 V1.0.0 · 2026年8月31日'),
    # P2 初赛反馈调整点（标红对比）
    ('初赛反馈的具体调整点', '逐条回应评审反馈；红色为本版本（V0.9.6 → V1.0.0）新增或强化。',
     '反馈：多 Agent 协同证据不足\n→ AgentTeams v1.2.2 官方本地实跑 18/18\n→ 动态补证回边 + 返工回边（非固定顺序）\n\n反馈：效果缺少外部有效性\n→ 30 案例 SWE-bench dev 冻结基准\n→ 三维消融（管道/模型/架构）全披露',
     '反馈：工程可信度与安全边界\n→ GitLab CE 真实自愈 e2e 17/17\n→ Docker 灰度 + SLO 回滚 8/8 · 9/9 对抗安全'),
    # P3 场景闭环图
    ('场景闭环：谁在用、痛在哪、得到什么', '目标用户、现实流程、价值收益与输入输出链路。',
     '目标用户与现实流程\n值班研发：在 Issue/日志/指标间对时\n开发与测试：重新确认影响、修复和回归\n发布负责人：重新核对审批、灰度与回滚\n\n真实失败代价\n误修：表象信号误导修错服务\n漏检：证据分散在多系统难对齐\n返工：失败补丁反复重做\n生产中断：MTTR 人工基线 3250 秒',
     '输入 → 输出链路\n5 类异构信号（反馈/Issue/日志/指标/变更）\n→ 规范化案例 → 带证据引用的根因\n→ 最小补丁 + Red→Green 独立验证\n→ 签名审批 → 10% 灰度 → 知识卡\n\n量化收益（仿真基线，标注口径）\nMTTR 3250s → 14.8s · 误发布率 0\n人工介入率：低置信/熔断时显性停机'),
    # P4 架构
    ('七个职能 Agent，一条会"回头"的状态机', 'Intake · Impact · RCA · Patch · Verify · Release · Learn —— 直线推进之外，状态机带两条自主回边。',
     '主线\nreceived → triaged → diagnosed → planned → verified\n→ approval_pending → canary → confirmed → learned',
     '补证回边\ntriaged ↔ evidence_gathering（置信度不足，≤2 轮熔断）\n\n返工回边\nplanned → diagnosed（测试失败带日志返工，≤3 次熔断）'),
    # P5 风险边界声明
    ('风险边界声明：高风险操作的审批、回滚与审计', '策略门禁由确定性代码执行，不由模型绕过。',
     '分级与审批\nL0 只读 · L1 沙箱 · L2 签名审批+灰度 · L3 只出方案\nManager 签发 Case/Action/时效受限的 HMAC 回执\nRelease Worker 只能消费，MCP 服务端二次验签\n审批拒绝/超时 → 链路安全停止',
     '回滚与审计\n灰度错误率 Δ>1% / p95 Δ>20% / 业务退化 → 确定性回滚\n司法级证据链：incident → 信号 → git SHA → patch → 测试\n→ HMAC 审批 → 灰度指标 → Episode，链式 sha256\nnpm run verify-evidence-chain 独立复核\n9/9 对抗案例 fail closed · 人工与 Agent 操作统一审计'),
    # P6 Case 开场：表象误导
    ('一个会"骗人"的支付事故', '用户反馈："10:15 后支付页一直转圈，刷新后出现两笔订单。"',
     '10:15  网关 502 率抬升\n10:15  POST /orders p95 420ms → 2.8s\n10:15  IdempotencyStore timeout 日志\n10:02  一条配置变更记录尚未被注意到',
     '表象指向"下游网关故障"——\n如果系统只信第一层证据，\n就会去修一个根本没坏的东西。'),
    # P7 主线 1：动态补证
    ('证据不够，自主去采', 'RCA 首因置信度 0.58，低于 0.80 门禁——系统不再停止，也不再硬猜。',
     '0.58', '→ 0.91'),
    # P8 主线 2：自愈闭环
    ('补丁失败，自己再修一次', 'Patch↔Verify 闭环博弈：失败日志回传，带反馈二次生成。',
     'RED', 'GREEN'),
    # P9 主线 3：DB Branch
    ('数据库事故：隔离分支上并行验证假设', '涉及 Schema 变更与慢 SQL 的缺陷，从脱敏基线一键拉出多个隔离数据分支。',
     'BRANCH-A', 'BRANCH-B'),
    # P10 主线 4：负面方案召回
    ('系统记得"什么不能做"', 'Incident Episode 不只召回成功方案，还召回历史失败修法。',
     '负面证据注入\nEP-005：曾将连接池 80 → 200 试图缓解超时\n结果下游 Redis 集群 OOM，级联崩溃\n本次 RCA 报告自动生成警示：\n"调大连接池方案已自动规避"',
     'Episode 结构\n表象症状 + 服务拓扑依赖 + 竞争假设\n+ 根因证据链 + 正反补丁 + 回滚指标\n检索先硬过滤：租户→服务→环境\ngit revision → 配置版本\n杜绝不同版本相同报错的误召回'),
    # P11 主线 5：灰度与回滚
    ('上线之后仍在被验证', '10% 灰度 + SLO 违约检测，退化即确定性回滚。',
     '灰度门禁\n错误率 Δ>1% / p95 Δ>20% / 业务指标退化\n→ 自动回滚，不等待模型再次判断',
     '观察窗口与知识准入\n修复后不立刻入库：15 分钟指标观察\n+ 业务断言 + 复盘确认通过\n→ Episode 才从 pending 转 active 进入默认召回\n回滚/复发 → 转 negative 立即可召回作警示'),
    # P12 Benchmark 数据
    ('公开基准：从 0% 到可验证闭环', '同冻结 30 案例 SWE-bench dev test split，edit-based 补丁引擎 + 三维消融。',
     '闭环率 0% → 10%（3/30 devorbit）\n补丁可应用率 0% → 56%\nsingle-agent 同模型同预算 0/30 闭环\n失败样本全披露，95% Wilson 区间',
     '三维消融\n管道：diff-based V0.8 0% vs edit-based V0.9.6\n模型：glm / deepseek-v4-flash / qwen3:8b\n架构：devorbit 10% vs single-agent 0%\n失败知识自沉淀：42 条 negative Episode\n第二轮按仓库召回警示注入 patch 提示'),
    # P13 Episode 知识资产
    ('把每次事故变成企业级诊断资产', '从"本地词法匹配"到结构化 Incident Episode 知识图谱。',
     '结构化 Episode\n症状 + 拓扑 + 竞争假设 + 证据链\n+ 正反补丁 + 观察窗口 + 最终业务结果\n跨班次、跨服务可检索复用',
     '准入生命周期\n写入即 pending（不进默认召回）\n观察窗口 + 复盘通过 → active\n复发/回滚 → negative（立即警示）\n接手人不再重梳全部日志'),
    # P14 验证证据矩阵
    ('每一项能力，都有可复核的证据', '所有数字可通过仓库内命令独立重放。',
      '113/113 单元测试 · 63/63 validate 校验\n7/7 Golden Cases · 5/5 安全分支\n9/9 对抗安全案例（Hash 篡改/DB 隔离/恶意 Migration）\n18/18 AgentTeams 运行时 · 141/141 契约',
      '14 个 MCP 工具全审计 · Skill 版本+摘要溯源\n重启恢复：崩溃后审批续跑同 case/trace 闭环\n场景迁移：结算→库存 机制序列完全一致\n可靠性故障演练 6/6 · GitLab 真实自愈 e2e 17/17\nDocker 灰度回滚 8/8 · 3/30 公开基准闭环'),
    # P15 对比
    ('为什么不是单 Agent，也不是固定工作流', '复杂研发任务需要职责隔离、独立验证和动态停止条件。',
     '单 Agent\n上下文集中、权限过宽\n生成与验证同源偏差\n\n固定工作流\n可控但难处理证据冲突\n低置信只能停机等待',
     'DevOrbit\nLeader 动态委派与补证决策\nWorker 单职能 + 最小权限\nVerify 独立于 Patch\n失败带反馈自主返工\n策略门禁不由模型绕过'),
    # P16 路线图与诚实边界
    ('把已验证与尚未验证分开', '可信度来自证据边界，而不是把仿真指标包装成生产收益。',
      '已验证\nV1.0.0：状态持久化与重启恢复 · Skill 版本溯源\n第二类场景迁移（结算→库存）闭环\n可靠性故障演练 6/6 · 上下文治理显性化\nV0.9.6：edit-based 补丁引擎 · 闭环率 0%→10%\n三维消融 · GitLab 真实自愈 e2e 17/17\nAgentTeams 运行时 18/18 · Chaos 故障注入',
     '诚实边界\nAgentTeams 为官方软件本地实跑，非生产集群\nDB Branch 为本地 PostgreSQL 等价语义\n生产路径为 PolarDB Agentic Database Branch\nMTTR 基线为 3 例仿真计时，标注区间\n迁移场景为团队构造仿真，非生产数据'),
    # P17 可复制性
    ('可复制性：跨域迁移已实测', '从结算支付域到库存域，机制零改动复制，闭环一次跑通。',
     '保持不变（零改动）\ncase-lifecycle 状态机与熔断策略\n7 Worker 边界 + Manager 委派\n7 个版本化 Skill（版本+摘要进 trace）\n门禁/审批/证据链/幂等/隔离工作区',
     '迁移时替换\nfixture 仓库（含真实失败测试）\n分层信号池（surface 表象 / deep 深层）\n业务断言与修复模板 · 知识域 Episode\n\n实测：两域 Worker×Skill 序列、状态路径、\nMCP 工具集完全一致；均 3 失败→4 通过→promoted'),
    # P18 结尾
    ('让每个研发团队，都有一支可验证的交付小队', 'DevOrbit 不替代专家判断，而是把判断所需的证据、动作边界和结果验证组织起来。',
     '', ''),
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

def add_image(doc, page, path, x, y, w, h):
    shape = doc.createInstance('com.sun.star.drawing.GraphicObjectShape')
    shape.setPosition(uno.createUnoStruct('com.sun.star.awt.Point', x, y))
    shape.setSize(uno.createUnoStruct('com.sun.star.awt.Size', w, h))
    shape.GraphicURL = uno.systemPathToFileUrl(path)
    page.add(shape)
    return shape

def add_circle(doc, page, x, y, diameter, fill, line=None):
    shape = doc.createInstance('com.sun.star.drawing.EllipseShape')
    shape.setPosition(uno.createUnoStruct('com.sun.star.awt.Point', x, y))
    shape.setSize(uno.createUnoStruct('com.sun.star.awt.Size', diameter, diameter))
    shape.FillColor = fill
    shape.LineColor = fill if line is None else line
    page.add(shape)
    return shape

def add_line(doc, page, x1, y1, x2, y2, color=LINE, width=40):
    shape = doc.createInstance('com.sun.star.drawing.LineShape')
    shape.setPosition(uno.createUnoStruct('com.sun.star.awt.Point', x1, y1))
    shape.setSize(uno.createUnoStruct('com.sun.star.awt.Size', x2 - x1, y2 - y1))
    shape.LineColor = color
    shape.LineWidth = width
    page.add(shape)
    return shape

def two_col(doc, page, left, right, dark, small=False):
    fill_l = 0x1E3942 if dark else WHITE
    fill_r = 0x203B44 if dark else 0xE7EBDD
    line_c = 0x31505A if dark else LINE
    add_rect(doc, page, 2000, 7100, 14200, 8800, fill_l, line_c)
    add_rect(doc, page, 17000, 7100, 14800, 8800, fill_r, line_c)
    size = 12 if small else 13
    add_text(doc, page, left, 2700, 7850, 12700, 7300, size, WHITE if dark else INK, True)
    add_text(doc, page, right, 17700, 7850, 13400, 7300, size, LIME if dark else GREEN, True)

def build(desktop):
    doc = desktop.loadComponentFromURL('private:factory/simpress', '_blank', 0, ())
    pages = doc.getDrawPages()
    dark_indexes = {0, 4, 9, 11, 17}
    for index, data in enumerate(slides):
        page = pages.getByIndex(0) if index == 0 else pages.insertNewByIndex(index)
        for shape_index in range(page.getCount() - 1, -1, -1):
            page.remove(page.getByIndex(shape_index))
        page.Width = 33866; page.Height = 19050
        dark = index in dark_indexes
        add_rect(doc, page, 0, 0, 33866, 19050, NAVY if dark else BG, NAVY if dark else BG)
        fg = WHITE if dark else INK
        accent = LIME if dark else GREEN
        muted = 0xB8C9C2 if dark else MUTED
        add_text(doc, page, f'{index + 1:02d} / {len(slides)}   DEVORBIT', 2000, 1150, 10000, 500, 10, accent, True, 'Liberation Mono')
        title_size = 40 if index == 0 else (30 if index in (6, 7, 8, 11) else 27)
        add_text(doc, page, data[0], 2000, 2400, 30000, 2100, title_size, fg, True)
        subtitle_size = 24 if index == 0 else 15
        add_text(doc, page, data[1], 2050, 5000, 29000, 1800, subtitle_size, accent if index == 0 else muted, index == 0)

        if index == 0:
            # P1 封面
            add_rect(doc, page, 22500, 3000, 7800, 8500, 0x1E3942, 0x1E3942)
            add_text(doc, page, '缺陷\n→ 根因\n→ 补丁\n→ 验证\n→ 发布\n→ 知识', 24000, 3900, 5000, 6500, 23, LIME, True)
            add_text(doc, page, data[2], 2050, 6800, 17500, 1500, 15, 0xB8C9C2, False)
            add_text(doc, page, data[3], 2050, 8900, 15500, 1100, 13, fg, True)
            for chip_index, chip in enumerate(('AGENTTEAMS', 'SKILL', 'MCP', 'DB BRANCH', 'HASH CHAIN')):
                chip_x = 2050 + chip_index * 3300
                add_rect(doc, page, chip_x, 11800, 3000, 900, 0x1E3942, 0x31505A)
                add_text(doc, page, chip, chip_x + 300, 12050, 2600, 360, 9, LIME, True, 'Liberation Mono')
        elif index == 1:
            # P2 初赛反馈调整点：左列反馈→调整，右列 V1.0.0 新增（标红）
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, LINE)
            add_text(doc, page, '初赛反馈 → 调整', 2700, 7550, 8000, 500, 12, MUTED, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 6800, 12, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 4200, WHITE, RED)
            add_text(doc, page, 'V1.0.0 新增（标红）', 17700, 7550, 8000, 500, 12, RED, True)
            add_text(doc, page, '① 状态持久化与重启恢复：进程崩溃后\n审批挂起案例自动恢复续跑（同 case/trace）\n② Skill 版本溯源：每次运行记录版本+摘要', 17700, 8300, 13400, 2600, 11, RED, True)
            add_rect(doc, page, 17000, 11500, 14800, 4300, WHITE, RED)
            add_text(doc, page, 'V1.0.0 新增（标红）续', 17700, 12050, 8000, 500, 12, RED, True)
            add_text(doc, page, '③ 第二类场景迁移：结算→库存，机制零改动\n④ 可靠性故障演练 6/6（429/500/工具错误/\nDB 门禁/端点不可达/熔断）\n⑤ 上下文治理：租户硬过滤、陈旧阻断、TTL', 17700, 12800, 13400, 2800, 11, RED, True)
        elif index == 2:
            # P3 场景闭环图：左=用户与痛点，右=链路与收益
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, LINE)
            add_text(doc, page, '目标用户 · 核心痛点（真实失败代价）', 2700, 7550, 12000, 500, 12, MUTED, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 7000, 12, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, 0xE7EBDD, GREEN)
            add_text(doc, page, '价值收益 · 输入输出链路', 17700, 7550, 10000, 500, 12, GREEN, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 7000, 12, INK, False)
        elif index == 3:
            # P4 架构：7 Agent 卡片 + 状态机回边
            agents = (
                ('01', 'Intake', '归并'), ('02', 'Impact', '影响'), ('03', 'RCA', '诊断'),
                ('04', 'Patch', '修复'), ('05', 'Verify', '验证'), ('06', 'Release', '发布'), ('07', 'Learn', '沉淀'),
            )
            for agent_index, (number, name, role) in enumerate(agents):
                x = 2000 + agent_index * 4300
                add_rect(doc, page, x, 7000, 3800, 3000, WHITE, LINE)
                add_text(doc, page, number, x + 350, 7300, 1200, 350, 8, GREEN, True, 'Liberation Mono')
                add_text(doc, page, name, x + 350, 8000, 3000, 600, 15, INK, True, 'Liberation Mono')
                add_text(doc, page, role, x + 350, 9000, 3000, 500, 11, GREEN, True)
                if agent_index < 6:
                    add_text(doc, page, '→', x + 3850, 8400, 450, 450, 13, MUTED, True)
            add_rect(doc, page, 2000, 10600, 29600, 2500, 0xE7EBDD, LINE)
            add_text(doc, page, '主线', 2600, 11150, 2600, 450, 10, GREEN, True)
            add_text(doc, page, 'received → triaged → diagnosed → planned → verified → approval_pending → canary → confirmed → learned', 5200, 11100, 25000, 500, 10, INK, True, 'Liberation Mono')
            add_rect(doc, page, 2000, 13400, 14300, 2300, WHITE, GREEN)
            add_text(doc, page, '↺ 补证回边  triaged ↔ evidence_gathering', 2700, 13950, 13000, 500, 11, GREEN, True)
            add_text(doc, page, '置信度 < 0.80 时自主生成补证计划，反向拉取深层 Trace；≤2 轮，不足则熔断 needs_human', 2700, 14700, 12800, 800, 9, MUTED, False)
            add_rect(doc, page, 17500, 13400, 14300, 2300, WHITE, ORANGE)
            add_text(doc, page, '↺ 返工回边  planned → diagnosed', 18200, 13950, 13000, 500, 11, ORANGE, True)
            add_text(doc, page, '测试失败带日志回传 Patch Worker 二次生成；≤3 次尝试，超限熔断降级', 18200, 14700, 12800, 800, 9, MUTED, False)
        elif index == 5:
            # P6 Case 开场：左侧信号时间线 + 右侧陷阱警示
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, LINE)
            add_text(doc, page, '表象信号 · surface 层', 2700, 7550, 8000, 500, 12, MUTED, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 6800, 13, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, 0xFBEDEA, ORANGE)
            add_text(doc, page, '表象陷阱', 17700, 7550, 8000, 500, 12, ORANGE, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 6800, 15, INK, True)
        elif index == 6:
            # P7 动态补证：超大置信度数字 + 步骤流
            add_text(doc, page, '0.58', 3000, 7400, 9000, 3000, 66, ORANGE, True, 'Liberation Mono')
            add_text(doc, page, '首轮置信度 < 0.80 门禁', 3300, 10800, 8000, 500, 11, MUTED, False)
            add_text(doc, page, '→', 12800, 7900, 2500, 1500, 40, GREEN, True)
            add_text(doc, page, '0.91', 15800, 7400, 9000, 3000, 66, GREEN, True, 'Liberation Mono')
            add_text(doc, page, '补证后晋级，根因确认', 16100, 10800, 8000, 500, 11, MUTED, False)
            steps = (
                ('01', '生成补证计划', '假设 → 缺失证据清单\n→ 服务/时间窗/TraceID 查询'),
                ('02', '反向拉取深层证据', '配置变更 CHG-402\n连接池水位 Trace-771\n链路 Trace-772'),
                ('03', '合并重评分', '0.91 ≥ 0.80，晋级\n仍不足则进入第 2 轮'),
                ('04', '熔断兜底', '≤2 轮仍不达标\n→ needs_human 人工介入'),
            )
            for step_index, (number, heading, detail) in enumerate(steps):
                x = 2000 + step_index * 7600
                add_rect(doc, page, x, 12400, 7000, 3900, WHITE, LINE)
                add_text(doc, page, number, x + 500, 12800, 1200, 400, 9, GREEN, True, 'Liberation Mono')
                add_text(doc, page, heading, x + 500, 13500, 5900, 600, 13, INK, True)
                add_text(doc, page, detail, x + 500, 14400, 5900, 1500, 9, MUTED, False)
        elif index == 7:
            # P8 自愈闭环：RED → RED → GREEN 三状态块
            states = (
                ('PATCH #1', '只恢复连接池\n遗漏幂等保护', ORANGE, 'RED · 3 项失败'),
                ('分析失败日志', '失败输出回传\nPatch Worker 读日志定位遗漏', MUTED, '带反馈二次生成'),
                ('PATCH #2', '补全幂等逻辑\n重复请求返回 409+原订单', GREEN, 'GREEN · 4/4 通过'),
            )
            for s_index, (heading, detail, color, badge) in enumerate(states):
                x = 2000 + s_index * 10300
                add_rect(doc, page, x, 7400, 9400, 5600, WHITE, color)
                add_text(doc, page, heading, x + 600, 7900, 8000, 700, 17, color if color != MUTED else INK, True)
                add_text(doc, page, detail, x + 600, 8800, 8000, 1800, 11, MUTED, False)
                add_rect(doc, page, x + 600, 11100, 4600, 800, color, color)
                add_text(doc, page, badge, x + 850, 11330, 4200, 400, 10, WHITE, True, 'Liberation Mono')
                if s_index < 2:
                    add_text(doc, page, '→', x + 9550, 9400, 700, 700, 22, GREEN, True)
            add_text(doc, page, '最大 3 次尝试，超限熔断降级 needs_human · 失败样本同样进入证据链，不掩盖', 2050, 14000, 29000, 700, 14, GREEN, True)
        elif index == 8:
            # P9 DB Branch：双分支对比 + 择优
            add_rect(doc, page, 2000, 7300, 14200, 6000, WHITE, GREEN)
            add_text(doc, page, 'BRANCH-A · 索引优化方案', 2700, 7800, 9000, 600, 15, GREEN, True)
            add_text(doc, page, '重放事故流量：报错消失\n外键约束完好 · 无锁等待\n事务耗时正常', 2700, 8700, 12700, 2500, 12, INK, False)
            add_rect(doc, page, 2700, 11800, 5000, 800, GREEN, GREEN)
            add_text(doc, page, '择优合并 → L2 审批', 2950, 12030, 4700, 400, 10, WHITE, True, 'Liberation Mono')
            add_rect(doc, page, 17500, 7300, 14200, 6000, WHITE, ORANGE)
            add_text(doc, page, 'BRANCH-B · 分页改写方案', 18200, 7800, 9000, 600, 15, ORANGE, True)
            add_text(doc, page, '重放事故流量：报错消失\n但并发锁等待超限\n事务耗时劣化', 18200, 8700, 12700, 2500, 12, INK, False)
            add_rect(doc, page, 18200, 11800, 5000, 800, ORANGE, ORANGE)
            add_text(doc, page, '自动淘汰 · 零污染销毁', 18450, 12030, 4700, 400, 10, WHITE, True, 'Liberation Mono')
            add_text(doc, page, '同一脱敏基线并行比对，失败试验不相互污染，Branch 数据不进入生产；本地 PostgreSQL 等价语义验证，生产路径为 PolarDB Agentic Database Branch。', 2050, 14300, 29500, 1400, 12, MUTED, False)
        elif index == 11:
            # P12 Benchmark：大数字对比（闭环口径）
            add_text(doc, page, '10%', 3000, 7400, 11000, 3000, 66, LIME, True, 'Liberation Mono')
            add_text(doc, page, 'DevOrbit 闭环率（3/30）', 3300, 10800, 8000, 500, 11, 0xB8C9C2, False)
            add_text(doc, page, 'vs', 12800, 8300, 2500, 1200, 26, 0xB8C9C2, True)
            add_text(doc, page, '0%', 17800, 7400, 11000, 3000, 66, 0x8FA8A0, True, 'Liberation Mono')
            add_text(doc, page, '单 Agent · 同模型同预算（0/30）', 18100, 10800, 8000, 500, 11, 0xB8C9C2, False)
            metrics = (
                ('3250s → 14.8s', 'MTTR（3 例仿真计时基线，标注区间）'),
                ('0', '误发布率 · fail-closed 门禁'),
                ('9/9', '对抗安全案例全部阻断'),
            )
            for m_index, (value, label) in enumerate(metrics):
                x = 2000 + m_index * 10100
                add_rect(doc, page, x, 12600, 9300, 3400, 0x1E3942, 0x31505A)
                add_text(doc, page, value, x + 600, 13150, 8200, 900, 24, LIME, True, 'Liberation Mono')
                add_text(doc, page, label, x + 600, 14450, 8200, 1000, 10, 0xB8C9C2, False)
        elif index == 14:
            # P15 三栏对比
            cols = (
                ('单 Agent', '上下文集中、权限过宽\n生成与验证同源偏差', 0xE7EBDD, INK),
                ('固定工作流', '可控但难处理证据冲突\n低置信只能停机等待', 0xE7EBDD, INK),
                ('DevOrbit', 'Leader 动态委派与补证决策\nWorker 最小权限 · 独立验证\n失败带反馈自主返工\n策略门禁不由模型绕过', GREEN, WHITE),
            )
            for c_index, (heading, detail, fill, fg_c) in enumerate(cols):
                x = 2000 + c_index * 10100
                add_rect(doc, page, x, 7400, 9300, 5600, fill, LINE)
                add_text(doc, page, heading, x + 600, 7900, 8000, 700, 18, GREEN if fill != GREEN else LIME, True)
                add_text(doc, page, detail, x + 600, 9000, 8000, 3400, 12, fg_c if fill != GREEN else WHITE, False)
        elif index == 16:
            # P17 可复制性：左=不变机制，右=替换项+实测结果
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, GREEN)
            add_text(doc, page, '保持不变（机制零改动）', 2700, 7550, 10000, 500, 12, GREEN, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 6800, 13, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, 0xE7EBDD, LINE)
            add_text(doc, page, '迁移时替换 · 实测结果', 17700, 7550, 10000, 500, 12, MUTED, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 6800, 13, INK, False)
        elif index == 17:
            # P18 结尾
            add_rect(doc, page, 2000, 7600, 29800, 5300, 0x1E3942, 0x31505A)
            values = (('01', '有依据', '根因绑定现场与历史引用'), ('02', '有边界', '最小权限、审批与回滚'), ('03', '可验证', '独立测试、灰度与司法级审计'))
            for value_index, (number, heading, detail) in enumerate(values):
                x = 2700 + value_index * 9700
                add_text(doc, page, number, x, 8250, 1200, 400, 9, LIME, True, 'Liberation Mono')
                add_text(doc, page, heading, x, 9000, 7600, 800, 23, WHITE, True)
                add_text(doc, page, detail, x, 10400, 7600, 900, 11, 0xB8C9C2, False)
            add_text(doc, page, 'GOAI Agent Infra 复赛 · V1.0.0 · 2026年8月31日', 2050, 14400, 18000, 500, 11, LIME, True)
        else:
            # 默认双栏：P5 风险边界、P10 负面召回、P11 灰度、P13 Episode、P14 证据矩阵、P16 路线图
            small = index in (10, 13, 15)
            two_col(doc, page, data[2], data[3], dark, small)

        add_text(doc, page, 'AgentTeams · Skill · MCP · RAG · Evidence-first · 2026-08-31', 2000, 17800, 23500, 350, 9, muted, False, 'Liberation Mono')
        add_text(doc, page, str(index + 1), 30500, 17800, 1400, 350, 9, muted, False, 'Liberation Mono')
    pptx = uno.systemPathToFileUrl(os.path.join(OUT, 'DevOrbit_复赛方案.pptx'))
    pdf = uno.systemPathToFileUrl(os.path.join(OUT, 'DevOrbit_复赛方案.pdf'))
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

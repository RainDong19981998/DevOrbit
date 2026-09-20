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

# 19 页：前 13 页主讲，后 6 页附录。
slides = [
    ('DevOrbit', '自动处理线上缺陷的多 Agent 研发平台',
     '输入 Issue、日志与代码仓；输出根因、代码补丁、测试报告、发布决策和可审计证据链。',
      'GOAI 2026 Agent Infra 决赛 · V1.1.0 · 2026年9月18日'),
    ('决赛版只回答三个问题', '真实 Worker 是否执行、结论是否来自证据、系统是否可持续恢复。',
     '① 官方 AT：R4 七 Worker 各自发言并调用自有 MCP\n   （422 条消息 + 69 条审计，同一 Case/Trace）\n② 主案例：RCA/Patch 不再读取预置 rootCause/fix\n③ 企业运行：审批、状态、知识可恢复',
     '当前边界\nAgentTeams R4 探针 passed（非预置库存案例）\nPolarDB 实测：协议已就绪，待账号环境复跑\nWorker 触发依赖 m.mentions（探针 auto-nudge 补发）\nSkill PATCH：升级与回退已实跑并留 digest/Trace'),
    ('研发事故的真正困难', '团队缺的不是再一个聊天窗口，而是可复核的任务推进与异常处理。',
     '值班研发：对齐 Issue、日志、指标和代码\n开发与测试：确认影响、修改与回归\n发布负责人：核对审批、灰度和回滚\n\n常见失败\n证据不足仍下结论 · 生成与验证同源\n中断后重复执行 · 失败经验随进程消失',
     'DevOrbit 的职责\n让 Worker 自己加载 Skill、调用最小权限 MCP\n让 Leader 按中间证据补证或返工\n让固定控制面只守 Schema、测试、权限与审批\n让每个结果可反查 Case / Trace / Skill / Tool / Approval'),
    ('三类职责，不能混在一起', '模型判断、固定门禁和人工决定各自有清晰边界。',
     '模型与 Worker\n理解陌生 Issue · 生成竞争假设\n选择工具补证 · 提议最小修改\n读取失败日志后二次生成',
     '确定性控制面\n身份与最小权限 · 输入输出 Schema\n独立测试与证据完整性 · 幂等恢复\n\n人工决定\nL2 发布批准、拒绝或要求补证'),
    ('安全门禁：高风险动作不能靠模型自证', '审批、测试、回滚和审计由确定性代码执行。',
     '执行前\nWorker×Tool allowlist · Schema 校验\n隔离工作区 · 写操作幂等键\nL2 签名审批绑定 Case / Action / 时效',
     '执行后\n独立 Verify Worker 判定 Red→Green\n10% 灰度触发 SLO 回滚\nHash 链绑定代码、测试、审批与发布结果'),
    ('一个会"骗人"的库存事故（R4 实拍）', '用户反馈："秒杀下单成功后被取消，提示库存不足。"（FB-2210 / ISSUE-832）',
     '14:05  库存扣减 API 成功率 99.9%（METRIC-61）\n14:05  缓存 DECR 正常 qps=310（LOG-20A）\n14:06  stock_ledger 出现负库存（DB-77）\n13:40  变更记录：移除乐观锁条件（CHG-501）',
     '表象指向"库存不足"——\n但真实根因是 13:40 的变更移除了乐观锁。\n只信第一层证据就会去修一个没坏的东西。'),
    ('证据不够，Worker 自主去采（R4 实拍）', 'intake 拉取 7 条信号聚 4 簇；rca 独立证伪假设；不消费预置 rootCause。',
     '7 条信号', '→ 4 簇根因候选'),
    ('补丁验证与人工门禁（R4 实拍）', 'patch 最小修改 → verify 独立测试门禁 → release 诚实停在 needs_human。',
     '10 次 MCP 调用', 'needs_human'),
    ('失败也不停摆：补证回边自动触发', '首轮置信度不足时，系统不硬猜也不停机——自主补证后再评分。',
     '0.45', '→ 0.92'),
    ('数据库分支试验：协议已就绪，实测待凭据', '候选应在相同数据与负载下先验业务一致性，再比较执行计划与性能。',
     'BRANCH-A', 'BRANCH-B'),
    ('审批后重启，继续而不是重做', '状态、证据链和幂等键一起恢复，避免重复写入与重复发布。',
     '中断前\napproval_pending 快照原子落盘\n保存 Case / Trace / Evidence Chain / Approval\n终态结果进入运行归档',
     '重启后\n校验快照与证据链 → 恢复同一 Case / Trace\n外部写操作按幂等键对账\n批准后从待处理节点继续验收'),
    ('经验资产必须带适用边界', '成功和失败假设都持久化，并按项目、版本与可信状态过滤。',
     'Episode 保存\n事故、候选补丁、验证报告、失败原因\nSchema / 代码版本 / 审批依据 / 证据引用\npending → active；回滚或复发 → negative',
     '当前实现\n本地持久化已验证跨应用重启保留\nPolarDB PostgreSQL 迁移待账号环境实跑\n过期版本结论默认阻断，不直接复用'),
    ('决赛结论：已验证与待完成分开', '价值来自可复核边界，不来自无法成立的耗时对比。',
     '已验证', '待完成'),
    ('附录 A｜七 Worker 与权限边界', '主讲只讲职责边界；完整角色清单放在附录。',
     'Intake：Issue / Observability\nImpact：Repository read\nRCA：Observability / Knowledge\nPatch：Repository write / CI',
     'Verify：CI（独立于 Patch）\nRelease：Approval / Canary / Rollback\nLearning：Knowledge write\nLeader：委派与终态，不代替 Worker 调工具\n\n触发说明：Worker 经 Matrix m.mentions 唤醒；delegate 通知未带 mention 字段时，探针 auto-nudge 补发（审计可见，不干预执行内容）'),
    ('附录 B｜测试与安全矩阵', '所有门禁均可从报告和命令独立复核。',
     '单元测试 · validate · Golden Cases\nHash 链篡改检测 · 恶意 Migration 阻断\n租户隔离 · 路径逃逸 · 凭据扫描',
     '审批拒绝/过期 fail closed\n最大补证与返工次数熔断\n灰度 SLO 退化自动回滚\n外部写入幂等与恢复对账'),
    ('附录 C｜公开基准与对照边界', '基准数据留在附录；主讲不再用失败尝试耗时推导 MTTR 收益。',
     '单 Agent\n上下文集中、权限过宽\n生成与验证同源偏差\n\n固定工作流\n可控但难处理证据冲突\n低置信只能停机等待',
     'DevOrbit\nLeader 动态委派与补证决策\nWorker 单职能 + 最小权限\nVerify 独立于 Patch\n失败带反馈自主返工\n策略门禁不由模型绕过'),
    ('附录 D｜部署与数据库迁移边界', '开发分支试验与生产状态持久化是两条独立验收线。',
     '当前已验证\n内存 DB Branch 契约与安全门禁\n本地状态/知识持久化及重启恢复\nPostgreSQL smoke 未成功时保持 measured=false',
     '账号到位后\nPolarDB Agentic Database 独立分支对比\n生产 PolarDB PostgreSQL 迁移检查\n权限、备份恢复、监控、状态幂等联验'),
    ('附录 E｜Skill PATCH 升级与回退', 'evidence-rca 在隔离注册表完成真实版本切换。',
     '升级\n1.0.0 → 1.0.1\nfrontmatter / registry 契约通过\n代表性 RCA golden check 通过\ndigest 发生变化',
     '回退\n1.0.1 → 1.0.0\n回退后 golden check 通过\n最终 digest 与基线完全一致\n同一 Trace 写入 reports/skill-upgrade-rollback.json'),
    ('附录 F｜现场验收入口', '先看事实，再看演示；任何 blocked 项都不算通过。',
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
        section = 'MAIN 01-13' if index < 13 else 'APPENDIX'
        add_text(doc, page, f'{index + 1:02d} / {len(slides)}   {section}   DEVORBIT', 2000, 1150, 14000, 500, 10, accent, True, 'Liberation Mono')
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
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, LINE)
            add_text(doc, page, '决赛验收重点', 2700, 7550, 8000, 500, 12, MUTED, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 6800, 12, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, WHITE, RED)
            add_text(doc, page, 'V1.1.0 事实边界', 17700, 7550, 8000, 500, 12, RED, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 6800, 12, INK, False)
        elif index == 2:
            # P3 场景闭环图：左=用户与痛点，右=链路与收益
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, LINE)
            add_text(doc, page, '目标用户 · 核心痛点（真实失败代价）', 2700, 7550, 12000, 500, 12, MUTED, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 7000, 12, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, 0xE7EBDD, GREEN)
            add_text(doc, page, '价值收益 · 输入输出链路', 17700, 7550, 10000, 500, 12, GREEN, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 7000, 12, INK, False)
        elif index == 3:
            agents = (
                ('01', 'Worker / 模型', '分析 · 补证 · 提议修改'),
                ('02', '固定控制面', '权限 · Schema · 测试 · 幂等'),
                ('03', '人工负责人', 'L2 批准 · 拒绝 · 要求补证'),
            )
            for agent_index, (number, name, role) in enumerate(agents):
                x = 2000 + agent_index * 10100
                add_rect(doc, page, x, 7000, 9300, 3600, WHITE, LINE)
                add_text(doc, page, number, x + 350, 7300, 1200, 350, 8, GREEN, True, 'Liberation Mono')
                add_text(doc, page, name, x + 350, 8000, 8000, 600, 15, INK, True)
                add_text(doc, page, role, x + 350, 9000, 8200, 800, 11, GREEN, True)
            add_rect(doc, page, 2000, 11600, 29600, 3600, 0xE7EBDD, LINE)
            add_text(doc, page, '不可越界原则', 2700, 12200, 5000, 500, 12, GREEN, True)
            add_text(doc, page, '模型不能批准自己的发布；Patch 不能判定自己的补丁通过；Leader 不能代替 Worker 制造工具审计；\n凭据缺失或证据不完整时，系统必须 blocked / needs_human，而不是生成成功记录。', 2700, 13100, 27800, 1500, 13, INK, True)
        elif index == 5:
            # P6 Case 开场：左侧信号时间线 + 右侧陷阱警示
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, LINE)
            add_text(doc, page, '表象信号 · surface 层', 2700, 7550, 8000, 500, 12, MUTED, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 6800, 13, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, 0xFBEDEA, ORANGE)
            add_text(doc, page, '表象陷阱', 17700, 7550, 8000, 500, 12, ORANGE, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 6800, 15, INK, True)
        elif index == 6:
            # P7 动态补证：R4 真实信号聚合数据
            add_text(doc, page, '7 条', 3000, 7400, 9000, 3000, 66, ORANGE, True, 'Liberation Mono')
            add_text(doc, page, 'intake 拉取去重信号（R4 实拍）', 3300, 10800, 8000, 500, 11, MUTED, False)
            add_text(doc, page, '→', 12800, 7900, 2500, 1500, 40, GREEN, True)
            add_text(doc, page, '4 簇', 15800, 7400, 9000, 3000, 66, GREEN, True, 'Liberation Mono')
            add_text(doc, page, '聚合根因候选（跨粒度去重）', 16100, 10800, 8000, 500, 11, MUTED, False)
            steps = (
                ('01', 'intake 信号归并', 'FB-2210 / ISSUE-832\nLOG-20A / METRIC-61\nCHG-501 / DB-77'),
                ('02', 'impact 影响面', '多轮代码阅读\n定位受影响模块与接口'),
                ('03', 'rca 独立证伪', '8 次 MCP 调用\n读代码 + 搜知识库\n生成竞争假设'),
                ('04', '诚实标注缺失', '重试策略/重复扣减计数\n回滚状态/缓存一致性'),
            )
            for step_index, (number, heading, detail) in enumerate(steps):
                x = 2000 + step_index * 7600
                add_rect(doc, page, x, 12400, 7000, 3900, WHITE, LINE)
                add_text(doc, page, number, x + 500, 12800, 1200, 400, 9, GREEN, True, 'Liberation Mono')
                add_text(doc, page, heading, x + 500, 13500, 5900, 600, 13, INK, True)
                add_text(doc, page, detail, x + 500, 14400, 5900, 1500, 9, MUTED, False)
        elif index == 7:
            # P8 R4 真实执行链路：patch→verify→release
            states = (
                ('PATCH', 'patch 最小修改\n10 次 MCP 调用\n含 create_workspace\nread_file/write_file', GREEN, 'tests executed'),
                ('VERIFY', 'verify 独立门禁\n5 次 MCP 调用\nci.run_tests\nrepository.read_file', GREEN, 'gate checked'),
                ('RELEASE', 'release 诚实停住\nrelease.canary 调用\n无审批 → needs_human\n不绕过人工门禁', ORANGE, 'needs_human'),
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
            add_text(doc, page, 'R4 实拍：七 Worker 自主执行 · 69 条 MCP 审计 · 同一 Case/Trace · Leader 交付终态', 2050, 14000, 29000, 700, 14, GREEN, True)
        elif index == 8:
            # P8.5 失败→返工：补证回边自动触发
            add_text(doc, page, '0.45', 3000, 7400, 9000, 3000, 66, ORANGE, True, 'Liberation Mono')
            add_text(doc, page, '首轮置信度 < 0.80 门禁', 3300, 10800, 8000, 500, 11, MUTED, False)
            add_text(doc, page, '→', 12800, 7900, 2500, 1500, 40, GREEN, True)
            add_text(doc, page, '0.92', 15800, 7400, 9000, 3000, 66, GREEN, True, 'Liberation Mono')
            add_text(doc, page, '补证后晋级，根因确认', 16100, 10800, 8000, 500, 11, MUTED, False)
            steps = (
                ('01', '生成补证计划', '假设 → 缺失证据清单\n服务/时间窗/TraceID'),
                ('02', '反向拉取深层证据', '配置变更 / 连接池水位\n链路 Trace / 日志'),
                ('03', '合并重评分', '0.92 ≥ 0.80，晋级\n仍不足则进入第 2 轮'),
                ('04', '熔断兜底', '≤2 轮仍不达标\n→ needs_human 人工介入'),
            )
            for step_index, (number, heading, detail) in enumerate(steps):
                x = 2000 + step_index * 7600
                add_rect(doc, page, x, 12400, 7000, 3900, WHITE, LINE)
                add_text(doc, page, number, x + 500, 12800, 1200, 400, 9, GREEN, True, 'Liberation Mono')
                add_text(doc, page, heading, x + 500, 13500, 5900, 600, 13, INK, True)
                add_text(doc, page, detail, x + 500, 14400, 5900, 1500, 9, MUTED, False)
        elif index == 9:
            # P9 DB Branch：双分支对比 + 择优
            add_rect(doc, page, 2000, 7300, 14200, 6000, WHITE, GREEN)
            add_text(doc, page, 'BRANCH-A · 索引候选', 2700, 7800, 9000, 600, 15, GREEN, True)
            add_text(doc, page, '待 PolarDB 账号环境执行\n先校验业务结果一致性\n再保存真实执行计划与负载数据', 2700, 8700, 12700, 2500, 12, INK, False)
            add_rect(doc, page, 2700, 11800, 5000, 500, GREEN, GREEN)
            add_text(doc, page, '协议就绪 · 待复跑', 2950, 11900, 4700, 350, 9, WHITE, True, 'Liberation Mono')
            add_rect(doc, page, 17500, 7300, 14200, 6000, WHITE, ORANGE)
            add_text(doc, page, 'BRANCH-B · 查询改写候选', 18200, 7800, 9000, 600, 15, ORANGE, True)
            add_text(doc, page, '待相同快照与负载对照\n看似合理的方案必须接受淘汰\n不得用估算指标替代真实计划', 18200, 8700, 12700, 2500, 12, INK, False)
            add_rect(doc, page, 18200, 11800, 5000, 500, ORANGE, ORANGE)
            add_text(doc, page, '待账号环境', 18450, 11900, 4700, 350, 9, WHITE, True, 'Liberation Mono')
            add_text(doc, page, '事实边界：reports/db-branch.json 当前 measured=false；本页仅说明验收协议，不主张 PostgreSQL 或 PolarDB 真实性能实测。', 2050, 14300, 29500, 1400, 12, MUTED, False)
        elif index == 12:
            add_text(doc, page, 'PASS', 3000, 7400, 11000, 3000, 56, LIME, True, 'Liberation Mono')
            add_text(doc, page, '七 Worker 自主 AT · 控制面 · 恢复 · Skill 回退', 3300, 10800, 9000, 500, 11, 0xB8C9C2, False)
            add_text(doc, page, '/', 13800, 8300, 1200, 1200, 26, 0xB8C9C2, True)
            add_text(doc, page, 'PENDING', 16800, 7400, 14000, 3000, 48, 0x8FA8A0, True, 'Liberation Mono')
            add_text(doc, page, 'PolarDB 实测（待账号环境复跑）', 17100, 10800, 11000, 500, 11, 0xB8C9C2, False)
            metrics = (
                ('7 / 7', 'R4 探针：精确 Worker sender + 各自非零 MCP 审计'),
                ('69', '同一 Case/Trace 的 MCP 审计条数'),
                ('~27 min', 'intake 2m → impact 3m → rca 13m → patch 3m → verify 2m → release 2m → learning 2m'),
            )
            for m_index, (value, label) in enumerate(metrics):
                x = 2000 + m_index * 10100
                add_rect(doc, page, x, 12600, 9300, 3400, 0x1E3942, 0x31505A)
                add_text(doc, page, value, x + 600, 13150, 8200, 900, 24, LIME, True, 'Liberation Mono')
                add_text(doc, page, label, x + 600, 14450, 8200, 1000, 10, 0xB8C9C2, False)
        elif index == 15:
            cols = (
                ('冻结数据集', 'SWE-bench dev 30 案例\n选择规则与 manifest 固化\n失败样本全部披露', 0xE7EBDD, INK),
                ('对照结果', 'DevOrbit 闭环 3/30\nsingle-agent 同模型预算 0/30\n仅描述该冻结样本', 0xE7EBDD, INK),
                ('禁止外推', '不是生产修复率\n不是独立 test split 排名\n失败尝试耗时不是成功 MTTR\n不用于宣称团队提效倍数', GREEN, WHITE),
            )
            for c_index, (heading, detail, fill, fg_c) in enumerate(cols):
                x = 2000 + c_index * 10100
                add_rect(doc, page, x, 7400, 9300, 5600, fill, LINE)
                add_text(doc, page, heading, x + 600, 7900, 8000, 700, 18, GREEN if fill != GREEN else LIME, True)
                add_text(doc, page, detail, x + 600, 9000, 8000, 3400, 12, fg_c if fill != GREEN else WHITE, False)
        elif index == 17:
            # P17 可复制性：左=不变机制，右=替换项+实测结果
            add_rect(doc, page, 2000, 7000, 14200, 8800, WHITE, GREEN)
            add_text(doc, page, 'PATCH 升级', 2700, 7550, 10000, 500, 12, GREEN, True)
            add_text(doc, page, data[2], 2700, 8300, 12700, 6800, 13, INK, False)
            add_rect(doc, page, 17000, 7000, 14800, 8800, 0xE7EBDD, LINE)
            add_text(doc, page, '回退验证', 17700, 7550, 10000, 500, 12, MUTED, True)
            add_text(doc, page, data[3], 17700, 8300, 13400, 6800, 13, INK, False)
        elif index == 18:
            # P18 附录验收入口
            add_rect(doc, page, 2000, 7600, 29800, 5300, 0x1E3942, 0x31505A)
            values = (('01', '主链路', 'npm test && npm run validate'), ('02', 'Skill 回退', 'npm run skill-upgrade-drill'), ('03', '事实边界', '检查 AT probe 与 DB status'))
            for value_index, (number, heading, detail) in enumerate(values):
                x = 2700 + value_index * 9700
                add_text(doc, page, number, x, 8250, 1200, 400, 9, LIME, True, 'Liberation Mono')
                add_text(doc, page, heading, x, 9000, 7600, 800, 23, WHITE, True)
                add_text(doc, page, detail, x, 10400, 7600, 900, 11, 0xB8C9C2, False)
            add_text(doc, page, 'GOAI 2026 Agent Infra 决赛 · V1.1.0 · 主讲 13 页 + 附录 6 页', 2050, 14400, 22000, 500, 11, LIME, True)
        else:
            # 默认双栏：P5 风险边界、P10 负面召回、P11 灰度、P13 Episode、P14 证据矩阵、P16 路线图
            small = index in (10, 13, 15)
            two_col(doc, page, data[2], data[3], dark, small)

        add_text(doc, page, 'AgentTeams · Skill · MCP · RAG · Evidence-first · 2026-09-18', 2000, 17800, 23500, 350, 9, muted, False, 'Liberation Mono')
        add_text(doc, page, str(index + 1), 30500, 17800, 1400, 350, 9, muted, False, 'Liberation Mono')
    pptx = uno.systemPathToFileUrl(os.path.join(OUT, 'DevOrbit_决赛方案.pptx'))
    pdf = uno.systemPathToFileUrl(os.path.join(OUT, 'DevOrbit_决赛方案.pdf'))
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

#!/usr/bin/python3
"""Render review evidence Markdown to deterministic, readable PDFs.

Only the small Markdown subset used by this repository is supported: headings,
paragraphs, blockquotes, bullets, fenced code, and pipe tables.
"""

import html
import os
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deliverables"
FONT_NAME = "STSong-Light"

INK = colors.HexColor("#1d2b27")
GREEN = colors.HexColor("#0e7053")
NAVY = colors.HexColor("#163d37")
LIME = colors.HexColor("#ccef73")
PALE = colors.HexColor("#f1f5ef")
LINE = colors.HexColor("#cbd5ce")
MUTED = colors.HexColor("#60716a")

pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))

JOBS = [
    ("docs/Agent-Identity清单.md", "DevOrbit_Agent-Identity清单.pdf"),
    ("docs/Skill清单.md", "DevOrbit_Skill清单.pdf"),
    ("docs/工具与云产品清单.md", "DevOrbit_工具与云产品清单.pdf"),
    ("docs/威胁模型.md", "DevOrbit_威胁模型.pdf"),
    ("docs/证据索引.md", "DevOrbit_证据索引.pdf"),
    ("reports/benchmark.md", "DevOrbit_对照与消融评测.pdf"),
    ("reports/security-evaluation.md", "DevOrbit_对抗安全评测.pdf"),
    ("docs/公开基准复现试点.md", "DevOrbit_公开基准复现试点.pdf"),
]


def inline(value: str) -> str:
    value = html.escape(value.strip())
    value = re.sub(r"`([^`]+)`", r'<font color="#0e7053">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"\[([^]]+)]\(([^)]+)\)", r"\1", value)
    return value


def table_cells(line: str):
    return [part.strip() for part in line.strip().strip("|").split("|")]


def is_separator(line: str) -> bool:
    cells = table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def parse_blocks(text: str):
    lines = text.splitlines()
    blocks = []
    paragraph = []
    index = 0

    def flush():
        if paragraph:
            blocks.append(("paragraph", " ".join(item.strip() for item in paragraph)))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            flush()
            index += 1
            continue
        if stripped.startswith("```"):
            flush()
            code = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code.append(lines[index])
                index += 1
            index += 1
            blocks.append(("code", "\n".join(code)))
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            flush()
            blocks.append((f"h{len(heading.group(1))}", heading.group(2)))
            index += 1
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and is_separator(lines[index + 1]):
            flush()
            rows = [table_cells(stripped)]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(table_cells(lines[index]))
                index += 1
            blocks.append(("table", rows))
            continue
        if stripped.startswith(">"):
            flush()
            blocks.append(("quote", stripped.lstrip("> ")))
            index += 1
            continue
        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            flush()
            blocks.append(("bullet", bullet.group(1)))
            index += 1
            continue
        paragraph.append(stripped)
        index += 1
    flush()
    return blocks


def max_columns(blocks):
    return max((len(rows[0]) for kind, rows in blocks if kind == "table"), default=0)


def column_widths(rows, available):
    columns = len(rows[0])
    weights = []
    for column in range(columns):
        lengths = [len(re.sub(r"[`*_]", "", row[column] if column < len(row) else "")) for row in rows]
        weights.append(max(7, min(max(lengths, default=7), 36)))
    total = sum(weights)
    return [available * weight / total for weight in weights]


def render(source: Path, destination: Path):
    blocks = parse_blocks(source.read_text(encoding="utf-8"))
    wide = max_columns(blocks) >= 5
    page_size = landscape(A4) if wide else A4
    width, height = page_size
    margin_x = 13 * mm
    margin_top = 14 * mm
    margin_bottom = 16 * mm
    available = width - 2 * margin_x

    base = getSampleStyleSheet()
    styles = {
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName=FONT_NAME, fontSize=9.2, leading=14, textColor=INK, spaceAfter=5),
        "h1": ParagraphStyle("h1", parent=base["Title"], fontName=FONT_NAME, fontSize=22, leading=28, textColor=NAVY, backColor=PALE, borderPadding=8, spaceAfter=12),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=FONT_NAME, fontSize=14, leading=19, textColor=GREEN, spaceBefore=9, spaceAfter=5, keepWithNext=True),
        "h3": ParagraphStyle("h3", parent=base["Heading3"], fontName=FONT_NAME, fontSize=11, leading=15, textColor=GREEN, spaceBefore=6, spaceAfter=4, keepWithNext=True),
        "quote": ParagraphStyle("quote", parent=base["BodyText"], fontName=FONT_NAME, fontSize=9, leading=14, leftIndent=9, rightIndent=9, borderColor=LIME, borderWidth=0, borderPadding=7, backColor=PALE, textColor=INK, spaceAfter=7),
        "bullet": ParagraphStyle("bullet", parent=base["BodyText"], fontName=FONT_NAME, fontSize=9.2, leading=14, leftIndent=13, firstLineIndent=-8, bulletIndent=4, textColor=INK, spaceAfter=3),
        "code": ParagraphStyle("code", parent=base["Code"], fontName=FONT_NAME, fontSize=8.2, leading=11, leftIndent=7, rightIndent=7, borderPadding=6, backColor=PALE, textColor=INK, spaceAfter=7),
        "cell": ParagraphStyle("cell", parent=base["BodyText"], fontName=FONT_NAME, fontSize=7.3 if wide else 8.2, leading=10.2 if wide else 11.5, textColor=INK),
        "head": ParagraphStyle("head", parent=base["BodyText"], fontName=FONT_NAME, fontSize=7.5 if wide else 8.4, leading=10.5 if wide else 11.5, textColor=colors.white),
    }

    title = next((value for kind, value in blocks if kind == "h1"), source.stem)

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LIME)
        canvas.setLineWidth(2)
        canvas.line(margin_x, height - 8 * mm, width - margin_x, height - 8 * mm)
        canvas.setFont(FONT_NAME, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(margin_x, 7 * mm, f"DevOrbit V0.6.0 | {title}")
        canvas.drawRightString(width - margin_x, 7 * mm, f"{doc.page} | 证据边界见正文")
        canvas.restoreState()

    doc = BaseDocTemplate(str(destination), pagesize=page_size, leftMargin=margin_x, rightMargin=margin_x, topMargin=margin_top, bottomMargin=margin_bottom, title=title, author="DevOrbit")
    frame = Frame(margin_x, margin_bottom, available, height - margin_top - margin_bottom, id="evidence-frame")
    doc.addPageTemplates([PageTemplate(id="evidence", frames=[frame], onPage=decorate)])

    story = []
    for kind, value in blocks:
        if kind in ("h1", "h2", "h3"):
            story.append(Paragraph(inline(value), styles[kind]))
        elif kind == "paragraph":
            story.append(Paragraph(inline(value), styles["body"]))
        elif kind == "quote":
            story.append(Paragraph(inline(value), styles["quote"]))
        elif kind == "bullet":
            story.append(Paragraph(f"- {inline(value)}", styles["bullet"]))
        elif kind == "code":
            story.append(Paragraph(html.escape(value).replace("\n", "<br/>"), styles["code"]))
        elif kind == "table":
            columns = len(value[0])
            normalized = [row + [""] * (columns - len(row)) for row in value]
            data = []
            for row_index, row in enumerate(normalized):
                style = styles["head"] if row_index == 0 else styles["cell"]
                data.append([Paragraph(inline(cell), style) for cell in row])
            table = Table(data, colWidths=column_widths(normalized, available), repeatRows=1, hAlign="LEFT", splitByRow=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ]))
            story.extend([table, Spacer(1, 6)])
    doc.build(story)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for source, output in JOBS:
        render(ROOT / source, OUT / output)
    print(f"PASS built {len(JOBS)} styled supporting PDFs")


if __name__ == "__main__":
    main()

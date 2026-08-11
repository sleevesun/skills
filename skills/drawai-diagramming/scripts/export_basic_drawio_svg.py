#!/usr/bin/env python3
"""Export one uncompressed draw.io page with basic mxGraph shapes to SVG."""

from __future__ import annotations

import argparse
import html
import math
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


FONT_FAMILY = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"


@dataclass
class Rect:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


def style_map(style: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in style.split(";"):
        if not part:
            continue
        if "=" in part:
            key, value = part.split("=", 1)
            result[key] = value
        else:
            result[part] = "1"
    return result


def number(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


def fmt(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:.2f}".rstrip("0").rstrip(".")


def clean_lines(value: str) -> list[str]:
    normalized = re.sub(r"(?i)<br\s*/?>", "\n", value)
    normalized = re.sub(r"<[^>]+>", "", normalized)
    normalized = html.unescape(normalized)
    return [line.strip() for line in normalized.splitlines()] or [""]


def estimate_text_width(text: str, font_size: float) -> float:
    width = 0.0
    for char in text:
        if char.isspace():
            width += font_size * 0.35
        elif ord(char) >= 0x2E80:
            width += font_size
        elif char.isupper():
            width += font_size * 0.68
        else:
            width += font_size * 0.58
    return width


class DrawioPage:
    def __init__(self, diagram: ET.Element):
        model = diagram.find("mxGraphModel")
        root = diagram.find("./mxGraphModel/root")
        if model is None or root is None:
            raise ValueError("The selected page is compressed or missing mxGraphModel/root")
        self.name = diagram.get("name", "")
        self.width = number(model.get("pageWidth"), 1200)
        self.height = number(model.get("pageHeight"), 760)
        self.cells = list(root.findall("mxCell"))
        self.by_id = {cell.get("id", ""): cell for cell in self.cells}
        self._rect_cache: dict[str, Rect] = {}

    def local_rect(self, cell: ET.Element) -> Rect:
        geo = cell.find("mxGeometry")
        if geo is None:
            return Rect(0, 0, 0, 0)
        return Rect(
            number(geo.get("x")),
            number(geo.get("y")),
            number(geo.get("width")),
            number(geo.get("height")),
        )

    def absolute_rect(self, cell: ET.Element) -> Rect:
        cell_id = cell.get("id", "")
        if cell_id in self._rect_cache:
            return self._rect_cache[cell_id]
        local = self.local_rect(cell)
        parent = self.by_id.get(cell.get("parent", ""))
        if parent is not None and parent.get("vertex") == "1":
            parent_rect = self.absolute_rect(parent)
            result = Rect(parent_rect.x + local.x, parent_rect.y + local.y, local.width, local.height)
        else:
            result = local
        self._rect_cache[cell_id] = result
        return result

    def parent_origin(self, cell: ET.Element) -> tuple[float, float]:
        parent = self.by_id.get(cell.get("parent", ""))
        if parent is None or parent.get("vertex") != "1":
            return 0.0, 0.0
        rect = self.absolute_rect(parent)
        return rect.x, rect.y


def render_shape(cell: ET.Element, rect: Rect) -> str:
    style = style_map(cell.get("style", ""))
    if "group" in style or "text" in style:
        return ""
    fill = style.get("fillColor", "#FFFFFF")
    stroke = style.get("strokeColor", "#000000")
    stroke_width = number(style.get("strokeWidth"), 1)
    dash = ' stroke-dasharray="8 6"' if style.get("dashed") == "1" else ""
    common = (
        f'fill="{html.escape(fill)}" stroke="{html.escape(stroke)}" '
        f'stroke-width="{fmt(stroke_width)}"{dash}'
    )
    if "rhombus" in style:
        points = [
            (rect.x + rect.width / 2, rect.y),
            (rect.right, rect.y + rect.height / 2),
            (rect.x + rect.width / 2, rect.bottom),
            (rect.x, rect.y + rect.height / 2),
        ]
        return f'<polygon points="{" ".join(f"{fmt(x)},{fmt(y)}" for x, y in points)}" {common}/>'
    if "ellipse" in style:
        return (
            f'<ellipse cx="{fmt(rect.x + rect.width / 2)}" cy="{fmt(rect.y + rect.height / 2)}" '
            f'rx="{fmt(rect.width / 2)}" ry="{fmt(rect.height / 2)}" {common}/>'
        )
    radius = min(12.0, rect.height / 4) if style.get("rounded") == "1" or "swimlane" in style else 0.0
    parts = [
        f'<rect x="{fmt(rect.x)}" y="{fmt(rect.y)}" width="{fmt(rect.width)}" height="{fmt(rect.height)}" '
        f'rx="{fmt(radius)}" ry="{fmt(radius)}" {common}/>'
    ]
    if "swimlane" in style:
        start_size = number(style.get("startSize"), 36)
        parts.append(
            f'<line x1="{fmt(rect.x)}" y1="{fmt(rect.y + start_size)}" '
            f'x2="{fmt(rect.right)}" y2="{fmt(rect.y + start_size)}" '
            f'stroke="{html.escape(stroke)}" stroke-width="{fmt(stroke_width)}"/>'
        )
    return "".join(parts)


def render_text(cell: ET.Element, rect: Rect) -> str:
    value = cell.get("value", "")
    if not value:
        return ""
    style = style_map(cell.get("style", ""))
    lines = clean_lines(value)
    font_size = number(style.get("fontSize"), 12)
    font_color = style.get("fontColor", "#1F2D3D")
    align = style.get("align", "center")
    vertical = style.get("verticalAlign", "middle")
    pad_left = number(style.get("spacingLeft"), number(style.get("spacing"), 0))
    pad_right = number(style.get("spacingRight"), number(style.get("spacing"), 0))
    pad_top = number(style.get("spacingTop"), number(style.get("spacing"), 0))
    pad_bottom = number(style.get("spacingBottom"), number(style.get("spacing"), 0))
    text_rect = rect
    if "swimlane" in style:
        text_rect = Rect(rect.x, rect.y, rect.width, number(style.get("startSize"), 36))

    if align == "left":
        x = text_rect.x + pad_left + 4
        anchor = "start"
    elif align == "right":
        x = text_rect.right - pad_right - 4
        anchor = "end"
    else:
        x = text_rect.x + text_rect.width / 2
        anchor = "middle"

    line_height = font_size * 1.45
    total_height = line_height * len(lines)
    if vertical == "top":
        first_y = text_rect.y + pad_top + font_size
    elif vertical == "bottom":
        first_y = text_rect.bottom - pad_bottom - total_height + font_size
    else:
        first_y = text_rect.y + (text_rect.height - total_height) / 2 + font_size

    font_style = int(number(style.get("fontStyle"), 0))
    weight = "700" if font_style & 1 else "400"
    italic = ' font-style="italic"' if font_style & 2 else ""
    tspans = []
    for index, line in enumerate(lines):
        dy = 0 if index == 0 else line_height
        tspans.append(
            f'<tspan x="{fmt(x)}" dy="{fmt(dy)}">{html.escape(line)}</tspan>'
        )
    return (
        f'<text x="{fmt(x)}" y="{fmt(first_y)}" text-anchor="{anchor}" '
        f'font-family="{FONT_FAMILY}" font-size="{fmt(font_size)}" font-weight="{weight}"'
        f'{italic} fill="{html.escape(font_color)}">{"".join(tspans)}</text>'
    )


def port_point(rect: Rect, x_ratio: float, y_ratio: float) -> tuple[float, float]:
    return rect.x + rect.width * x_ratio, rect.y + rect.height * y_ratio


def edge_points(page: DrawioPage, cell: ET.Element) -> list[tuple[float, float]]:
    style = style_map(cell.get("style", ""))
    source = page.by_id.get(cell.get("source", ""))
    target = page.by_id.get(cell.get("target", ""))
    if source is None or target is None:
        return []
    source_rect = page.absolute_rect(source)
    target_rect = page.absolute_rect(target)
    start = port_point(source_rect, number(style.get("exitX"), 1), number(style.get("exitY"), 0.5))
    end = port_point(target_rect, number(style.get("entryX"), 0), number(style.get("entryY"), 0.5))
    points = [start]
    geo = cell.find("mxGeometry")
    if geo is not None:
        array = geo.find("./Array[@as='points']")
        if array is not None:
            origin_x, origin_y = page.parent_origin(cell)
            for point in array.findall("mxPoint"):
                points.append((origin_x + number(point.get("x")), origin_y + number(point.get("y"))))
    if len(points) == 1:
        if abs(start[1] - end[1]) < 1 or abs(start[0] - end[0]) < 1:
            pass
        elif abs(start[0] - end[0]) >= abs(start[1] - end[1]):
            middle_x = (start[0] + end[0]) / 2
            points.extend([(middle_x, start[1]), (middle_x, end[1])])
        else:
            middle_y = (start[1] + end[1]) / 2
            points.extend([(start[0], middle_y), (end[0], middle_y)])
    points.append(end)
    compact: list[tuple[float, float]] = []
    for point in points:
        if not compact or point != compact[-1]:
            compact.append(point)
    return compact


def longest_segment_midpoint(points: list[tuple[float, float]]) -> tuple[float, float]:
    best_length = -1.0
    best_mid = points[0] if points else (0.0, 0.0)
    for start, end in zip(points, points[1:]):
        length = math.dist(start, end)
        if length > best_length:
            best_length = length
            best_mid = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
    return best_mid


def render_edge(page: DrawioPage, cell: ET.Element) -> tuple[str, str]:
    points = edge_points(page, cell)
    if len(points) < 2:
        return "", ""
    style = style_map(cell.get("style", ""))
    stroke = style.get("strokeColor", "#4C84C4")
    stroke_width = number(style.get("strokeWidth"), 1.5)
    marker_id = "arrow-" + re.sub(r"[^A-Za-z0-9]", "", stroke)
    dash = ' stroke-dasharray="8 6"' if style.get("dashed") == "1" else ""
    polyline = (
        f'<polyline points="{" ".join(f"{fmt(x)},{fmt(y)}" for x, y in points)}" '
        f'fill="none" stroke="{html.escape(stroke)}" stroke-width="{fmt(stroke_width)}"'
        f'{dash} marker-end="url(#{marker_id})"/>'
    )
    value = cell.get("value", "").strip()
    if not value:
        return polyline, ""
    font_size = number(style.get("fontSize"), 11)
    font_color = style.get("fontColor", stroke)
    label_x, label_y = longest_segment_midpoint(points)
    label_width = estimate_text_width(html.unescape(value), font_size) + 12
    label_height = font_size + 10
    label = (
        f'<rect x="{fmt(label_x - label_width / 2)}" y="{fmt(label_y - label_height / 2)}" '
        f'width="{fmt(label_width)}" height="{fmt(label_height)}" rx="4" fill="#FFFFFF" fill-opacity="0.94"/>'
        f'<text x="{fmt(label_x)}" y="{fmt(label_y + font_size * 0.34)}" text-anchor="middle" '
        f'font-family="{FONT_FAMILY}" font-size="{fmt(font_size)}" fill="{html.escape(font_color)}">'
        f'{html.escape(html.unescape(value))}</text>'
    )
    return polyline, label


def export_page(page: DrawioPage) -> str:
    edge_cells = [cell for cell in page.cells if cell.get("edge") == "1"]
    colors = sorted({style_map(cell.get("style", "")).get("strokeColor", "#4C84C4") for cell in edge_cells})
    markers = []
    for color in colors:
        marker_id = "arrow-" + re.sub(r"[^A-Za-z0-9]", "", color)
        markers.append(
            f'<marker id="{marker_id}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" '
            f'markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="{html.escape(color)}"/></marker>'
        )

    background_cells = []
    foreground_cells = []
    for cell in page.cells:
        if cell.get("vertex") != "1":
            continue
        style = style_map(cell.get("style", ""))
        if "group" in style:
            continue
        if "swimlane" in style or not cell.get("value", "") or cell.get("id", "").endswith("-bg"):
            background_cells.append(cell)
        else:
            foreground_cells.append(cell)

    shapes = []
    texts = []
    for cell in background_cells:
        rect = page.absolute_rect(cell)
        shapes.append(render_shape(cell, rect))
        texts.append(render_text(cell, rect))

    edge_shapes = []
    edge_labels = []
    for cell in edge_cells:
        edge, label = render_edge(page, cell)
        edge_shapes.append(edge)
        edge_labels.append(label)

    for cell in foreground_cells:
        rect = page.absolute_rect(cell)
        shapes.append(render_shape(cell, rect))
        texts.append(render_text(cell, rect))

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(page.width)}" height="{fmt(page.height)}" '
        f'viewBox="0 0 {fmt(page.width)} {fmt(page.height)}" role="img" aria-label="{html.escape(page.name)}">'
        f'<defs>{"".join(markers)}</defs>'
        f'<rect x="0" y="0" width="{fmt(page.width)}" height="{fmt(page.height)}" fill="#FFFFFF"/>'
        f'{"".join(shapes[:len(background_cells)])}'
        f'{"".join(texts[:len(background_cells)])}'
        f'{"".join(edge_shapes)}'
        f'{"".join(shapes[len(background_cells):])}'
        f'{"".join(texts[len(background_cells):])}'
        f'{"".join(edge_labels)}'
        "</svg>"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--page", required=True, help="Page name or zero-based page index")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    try:
        root = ET.parse(args.input).getroot()
        diagrams = root.findall("diagram")
        if args.page.isdigit():
            diagram = diagrams[int(args.page)]
        else:
            diagram = next(item for item in diagrams if item.get("name") == args.page)
        svg = export_page(DrawioPage(diagram))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(svg, encoding="utf-8")
    except (ET.ParseError, OSError, StopIteration, IndexError, ValueError) as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        return 1
    print(args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())

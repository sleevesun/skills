#!/usr/bin/env python3
"""Validate readable geometry in uncompressed draw.io mxGraph files."""

from __future__ import annotations

import argparse
import html
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


MIN_GAP = 24.0
EDGE_EPSILON = 0.5
PORT_EPSILON = 1e-6


@dataclass
class Box:
    cell_id: str
    parent_id: str
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


def geometry(cell: ET.Element) -> Box | None:
    geo = cell.find("mxGeometry")
    if geo is None:
        return None
    try:
        return Box(
            cell_id=cell.get("id", ""),
            parent_id=cell.get("parent", ""),
            x=float(geo.get("x", "0")),
            y=float(geo.get("y", "0")),
            width=float(geo.get("width", "0")),
            height=float(geo.get("height", "0")),
        )
    except ValueError:
        return None


def clean_lines(value: str) -> list[str]:
    normalized = re.sub(r"(?i)<br\s*/?>", "\n", value)
    normalized = re.sub(r"<[^>]+>", "", normalized)
    normalized = html.unescape(normalized)
    return [line.strip() for line in normalized.splitlines()] or [""]


def estimated_text_width(text: str, font_size: float) -> float:
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


def has_waypoints(cell: ET.Element) -> bool:
    geo = cell.find("mxGeometry")
    if geo is None:
        return False
    points = geo.find("./Array[@as='points']")
    return points is not None and bool(points.findall("mxPoint"))


def absolute_box(
    cell_id: str,
    cells: dict[str, ET.Element],
    boxes: dict[str, Box],
    trail: set[str] | None = None,
) -> Box | None:
    box = boxes.get(cell_id)
    cell = cells.get(cell_id)
    if box is None or cell is None:
        return None
    trail = set() if trail is None else set(trail)
    if cell_id in trail:
        return None
    trail.add(cell_id)
    parent_id = cell.get("parent", "")
    if parent_id in ("", "0", "1"):
        return Box(cell_id, parent_id, box.x, box.y, box.width, box.height)
    parent_box = absolute_box(parent_id, cells, boxes, trail)
    if parent_box is None:
        return Box(cell_id, parent_id, box.x, box.y, box.width, box.height)
    return Box(
        cell_id,
        parent_id,
        parent_box.x + box.x,
        parent_box.y + box.y,
        box.width,
        box.height,
    )


def explicit_edge_points(
    cell: ET.Element,
    cells: dict[str, ET.Element],
    boxes: dict[str, Box],
    style: dict[str, str],
) -> list[tuple[float, float]]:
    source = absolute_box(cell.get("source", ""), cells, boxes)
    target = absolute_box(cell.get("target", ""), cells, boxes)
    geo = cell.find("mxGeometry")
    array = geo.find("./Array[@as='points']") if geo is not None else None
    if source is None or target is None or array is None:
        return []
    start = (
        source.x + source.width * float(style.get("exitX", "1")),
        source.y + source.height * float(style.get("exitY", "0.5")),
    )
    end = (
        target.x + target.width * float(style.get("entryX", "0")),
        target.y + target.height * float(style.get("entryY", "0.5")),
    )
    parent_origin = absolute_box(cell.get("parent", ""), cells, boxes)
    origin_x = parent_origin.x if parent_origin is not None else 0.0
    origin_y = parent_origin.y if parent_origin is not None else 0.0
    points = [start]
    points.extend(
        (
            origin_x + float(point.get("x", "0")),
            origin_y + float(point.get("y", "0")),
        )
        for point in array.findall("mxPoint")
    )
    points.append(end)
    compact: list[tuple[float, float]] = []
    for point in points:
        if not compact or (
            abs(point[0] - compact[-1][0]) > EDGE_EPSILON
            or abs(point[1] - compact[-1][1]) > EDGE_EPSILON
        ):
            compact.append(point)
    return compact


def target_entry_is_perpendicular(
    points: list[tuple[float, float]],
    style: dict[str, str],
) -> bool | None:
    if len(points) < 2:
        return None
    try:
        entry_x = float(style["entryX"])
        entry_y = float(style["entryY"])
    except (KeyError, ValueError):
        return None

    previous = points[-2]
    target = points[-1]
    delta_x = target[0] - previous[0]
    delta_y = target[1] - previous[1]
    on_left = abs(entry_x) <= PORT_EPSILON
    on_right = abs(entry_x - 1) <= PORT_EPSILON
    on_top = abs(entry_y) <= PORT_EPSILON
    on_bottom = abs(entry_y - 1) <= PORT_EPSILON
    side_count = sum((on_left, on_right, on_top, on_bottom))
    if side_count != 1:
        return None

    if on_left:
        return abs(delta_y) <= EDGE_EPSILON and delta_x > EDGE_EPSILON
    if on_right:
        return abs(delta_y) <= EDGE_EPSILON and delta_x < -EDGE_EPSILON
    if on_top:
        return abs(delta_x) <= EDGE_EPSILON and delta_y > EDGE_EPSILON
    return abs(delta_x) <= EDGE_EPSILON and delta_y < -EDGE_EPSILON


def overlapping_segment_length(
    first_start: tuple[float, float],
    first_end: tuple[float, float],
    second_start: tuple[float, float],
    second_end: tuple[float, float],
) -> float:
    first_horizontal = abs(first_start[1] - first_end[1]) <= EDGE_EPSILON
    second_horizontal = abs(second_start[1] - second_end[1]) <= EDGE_EPSILON
    if first_horizontal and second_horizontal:
        if abs(first_start[1] - second_start[1]) > EDGE_EPSILON:
            return 0.0
        return max(
            0.0,
            min(max(first_start[0], first_end[0]), max(second_start[0], second_end[0]))
            - max(min(first_start[0], first_end[0]), min(second_start[0], second_end[0])),
        )

    first_vertical = abs(first_start[0] - first_end[0]) <= EDGE_EPSILON
    second_vertical = abs(second_start[0] - second_end[0]) <= EDGE_EPSILON
    if first_vertical and second_vertical:
        if abs(first_start[0] - second_start[0]) > EDGE_EPSILON:
            return 0.0
        return max(
            0.0,
            min(max(first_start[1], first_end[1]), max(second_start[1], second_end[1]))
            - max(min(first_start[1], first_end[1]), min(second_start[1], second_end[1])),
        )

    return 0.0


def is_rendered_node(cell: ET.Element) -> bool:
    if cell.get("vertex") != "1":
        return False
    style = style_map(cell.get("style", ""))
    if "group" in style or "image" in style:
        return False
    return True


def is_collision_node(cell: ET.Element) -> bool:
    if not is_rendered_node(cell) or not cell.get("value", "").strip():
        return False
    style = style_map(cell.get("style", ""))
    cell_id = cell.get("id", "")
    if "text" in style or "swimlane" in style:
        return False
    if cell_id.endswith("-bg") or cell_id.endswith("-container"):
        return False
    return True


def boxes_overlap(a: Box, b: Box) -> bool:
    return min(a.right, b.right) > max(a.x, b.x) and min(a.bottom, b.bottom) > max(a.y, b.y)


def orthogonal_gap(a: Box, b: Box) -> float | None:
    x_overlap = min(a.right, b.right) - max(a.x, b.x)
    y_overlap = min(a.bottom, b.bottom) - max(a.y, b.y)
    if x_overlap > 0 and y_overlap <= 0:
        return max(a.y, b.y) - min(a.bottom, b.bottom)
    if y_overlap > 0 and x_overlap <= 0:
        return max(a.x, b.x) - min(a.right, b.right)
    return None


def validate_page(diagram: ET.Element) -> list[dict[str, object]]:
    issues: list[dict[str, object]] = []
    model = diagram.find("mxGraphModel")
    root = diagram.find("./mxGraphModel/root")
    if model is None or root is None:
        return [{"page": diagram.get("name", ""), "type": "invalid-page", "cell": "", "detail": "Missing mxGraphModel/root"}]

    page_name = diagram.get("name", "")
    page_width = float(model.get("pageWidth", "0") or 0)
    page_height = float(model.get("pageHeight", "0") or 0)
    cells = {cell.get("id", ""): cell for cell in root.findall("mxCell")}
    boxes = {cell_id: box for cell_id, cell in cells.items() if (box := geometry(cell)) is not None}

    def add(issue_type: str, cell_id: str, detail: str) -> None:
        issues.append({"page": page_name, "type": issue_type, "cell": cell_id, "detail": detail})

    for cell_id, cell in cells.items():
        if not is_rendered_node(cell):
            continue
        value = cell.get("value", "").strip()
        if not value:
            continue
        style = style_map(cell.get("style", ""))
        box = boxes.get(cell_id)
        if "align" not in style:
            add("missing-align", cell_id, "Declare align explicitly")
        if "verticalAlign" not in style:
            add("missing-vertical-align", cell_id, "Declare verticalAlign explicitly")
        if box is None or box.width <= 0 or box.height <= 0:
            add("invalid-geometry", cell_id, "Text-bearing node needs positive width and height")
            continue

        font_size = float(style.get("fontSize", "12") or 12)
        pad_left = float(style.get("spacingLeft", style.get("spacing", "0")) or 0)
        pad_right = float(style.get("spacingRight", style.get("spacing", "0")) or 0)
        pad_top = float(style.get("spacingTop", style.get("spacing", "0")) or 0)
        pad_bottom = float(style.get("spacingBottom", style.get("spacing", "0")) or 0)
        usable_width = max(1.0, box.width - pad_left - pad_right - 4)
        lines = clean_lines(value)
        longest = max((estimated_text_width(line, font_size) for line in lines), default=0.0)
        if longest > usable_width + 1:
            add(
                "text-too-wide",
                cell_id,
                f"Estimated {math.ceil(longest)}px text exceeds {math.floor(usable_width)}px usable width; add a manual break or widen the node",
            )
        needed_height = len(lines) * font_size * 1.5 + pad_top + pad_bottom + 8
        if needed_height > box.height + 1:
            add(
                "text-too-tall",
                cell_id,
                f"Estimated {math.ceil(needed_height)}px text height exceeds {math.floor(box.height)}px node height",
            )

    edge_paths: dict[str, list[tuple[float, float]]] = {}
    for cell_id, cell in cells.items():
        if cell.get("edge") != "1":
            continue
        style = style_map(cell.get("style", ""))
        if style.get("edgeStyle") != "orthogonalEdgeStyle":
            add("non-orthogonal-edge", cell_id, "Use orthogonalEdgeStyle")
        missing_ports = [key for key in ("exitX", "exitY", "entryX", "entryY") if key not in style]
        if missing_ports:
            add("missing-edge-ports", cell_id, f"Missing {', '.join(missing_ports)}")
        source = cells.get(cell.get("source", ""))
        target = cells.get(cell.get("target", ""))
        if source is not None and target is not None and source.get("parent") != target.get("parent") and not has_waypoints(cell):
            add("cross-container-edge-without-waypoint", cell_id, "Cross-container edges need explicit waypoints")
        points = explicit_edge_points(cell, cells, boxes, style)
        if points:
            edge_paths[cell_id] = points
        for start, end in zip(points, points[1:]):
            if abs(start[0] - end[0]) > 0.5 and abs(start[1] - end[1]) > 0.5:
                add(
                    "non-orthogonal-waypoint-segment",
                    cell_id,
                    f"Segment {start} → {end} is diagonal; align one coordinate",
                )
                break
        perpendicular_entry = target_entry_is_perpendicular(points, style)
        if perpendicular_entry is False:
            add(
                "edge-non-perpendicular-entry",
                cell_id,
                "The final segment must approach the declared target side at 90° and point into the target",
            )

    edge_items = list(edge_paths.items())
    for edge_index, (first_id, first_points) in enumerate(edge_items):
        for second_id, second_points in edge_items[edge_index + 1 :]:
            overlap = 0.0
            for first_start, first_end in zip(first_points, first_points[1:]):
                for second_start, second_end in zip(second_points, second_points[1:]):
                    overlap = max(
                        overlap,
                        overlapping_segment_length(
                            first_start,
                            first_end,
                            second_start,
                            second_end,
                        ),
                    )
            if overlap > EDGE_EPSILON:
                add(
                    "edge-segment-overlap",
                    f"{first_id},{second_id}",
                    f"Distinct connectors share {overlap:.0f}px of the same route; assign separate ports or routing channels",
                )

    by_parent: dict[str, list[Box]] = {}
    for cell_id, cell in cells.items():
        if is_collision_node(cell) and cell_id in boxes:
            by_parent.setdefault(cell.get("parent", ""), []).append(boxes[cell_id])

    for siblings in by_parent.values():
        for index, left in enumerate(siblings):
            for right in siblings[index + 1 :]:
                if boxes_overlap(left, right):
                    add("node-overlap", f"{left.cell_id},{right.cell_id}", "Sibling node rectangles overlap")
                    continue
                gap = orthogonal_gap(left, right)
                if gap is not None and gap < MIN_GAP:
                    add(
                        "insufficient-clearance",
                        f"{left.cell_id},{right.cell_id}",
                        f"Sibling clearance is {gap:.0f}px; require at least {MIN_GAP:.0f}px",
                    )

    for cell_id, box in boxes.items():
        cell = cells[cell_id]
        parent = cells.get(cell.get("parent", ""))
        parent_box = boxes.get(parent.get("id", "")) if parent is not None else None
        if parent_box is not None and "group" in style_map(parent.get("style", "")):
            if box.x < 0 or box.y < 0 or box.right > parent_box.width or box.bottom > parent_box.height:
                add("child-outside-group", cell_id, f"Child exceeds group {parent.get('id', '')} bounds")
        elif cell.get("parent") == "1" and page_width > 0 and page_height > 0:
            if box.x < 0 or box.y < 0 or box.right > page_width or box.bottom > page_height:
                add("node-outside-page", cell_id, "Top-level node exceeds page bounds")

    return issues


def validate_file(path: Path) -> list[dict[str, object]]:
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        return [{"page": "", "type": "invalid-xml", "cell": "", "detail": str(exc)}]
    issues: list[dict[str, object]] = []
    for diagram in root.findall("diagram"):
        issues.extend(validate_page(diagram))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    payload = []
    for path in args.files:
        payload.append({"file": str(path), "issues": validate_file(path)})

    issue_count = sum(len(item["issues"]) for item in payload)
    if args.as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for item in payload:
            print(item["file"])
            if not item["issues"]:
                print("  OK")
                continue
            for issue in item["issues"]:
                print(f"  [{issue['type']}] {issue['page']} / {issue['cell']}: {issue['detail']}")
        print(f"Total issues: {issue_count}")
    return 1 if issue_count else 0


if __name__ == "__main__":
    sys.exit(main())

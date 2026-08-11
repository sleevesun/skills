#!/usr/bin/env python3
"""Regression tests for draw.io connector routing validation."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


VALIDATOR_PATH = Path(__file__).with_name("validate_drawio_layout.py")
SPEC = importlib.util.spec_from_file_location("validate_drawio_layout", VALIDATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VALIDATOR
SPEC.loader.exec_module(VALIDATOR)


NODE_STYLE = (
    "rounded=1;whiteSpace=wrap;html=1;"
    "align=center;verticalAlign=middle;"
    "spacingLeft=10;spacingRight=10;spacingTop=6;spacingBottom=6;"
)
EDGE_STYLE = (
    "endArrow=classic;html=1;edgeStyle=orthogonalEdgeStyle;"
    "orthogonalLoop=1;jettySize=auto;rounded=0;"
)


def add_node(root: ET.Element, node_id: str, x: int, y: int) -> None:
    cell = ET.SubElement(
        root,
        "mxCell",
        {
            "id": node_id,
            "value": node_id,
            "style": NODE_STYLE,
            "vertex": "1",
            "parent": "1",
        },
    )
    ET.SubElement(
        cell,
        "mxGeometry",
        {"x": str(x), "y": str(y), "width": "100", "height": "50", "as": "geometry"},
    )


def add_edge(
    root: ET.Element,
    edge_id: str,
    source: str,
    target: str,
    *,
    ports: str,
    points: list[tuple[int, int]],
) -> None:
    cell = ET.SubElement(
        root,
        "mxCell",
        {
            "id": edge_id,
            "style": EDGE_STYLE + ports,
            "edge": "1",
            "parent": "1",
            "source": source,
            "target": target,
        },
    )
    geometry = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})
    point_array = ET.SubElement(geometry, "Array", {"as": "points"})
    for x, y in points:
        ET.SubElement(point_array, "mxPoint", {"x": str(x), "y": str(y)})


def validate(nodes: list[tuple[str, int, int]], edges: list[dict[str, object]]) -> list[dict[str, object]]:
    mxfile = ET.Element("mxfile")
    diagram = ET.SubElement(mxfile, "diagram", {"id": "test", "name": "test"})
    model = ET.SubElement(
        diagram,
        "mxGraphModel",
        {"page": "1", "pageWidth": "800", "pageHeight": "600"},
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})
    for node in nodes:
        add_node(root, *node)
    for edge in edges:
        add_edge(root, **edge)

    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "routing.drawio"
        ET.ElementTree(mxfile).write(path, encoding="utf-8", xml_declaration=True)
        return VALIDATOR.validate_file(path)


class ConnectorRoutingValidationTests(unittest.TestCase):
    def test_rejects_collinear_overlap_between_distinct_edges(self) -> None:
        issues = validate(
            [
                ("source-a", 0, 0),
                ("source-b", 0, 200),
                ("target", 300, 100),
            ],
            [
                {
                    "edge_id": "edge-a",
                    "source": "source-a",
                    "target": "target",
                    "ports": "exitX=1;exitY=0.5;entryX=0;entryY=0.5;",
                    "points": [(150, 25), (150, 125)],
                },
                {
                    "edge_id": "edge-b",
                    "source": "source-b",
                    "target": "target",
                    "ports": "exitX=1;exitY=0.5;entryX=0;entryY=0.5;",
                    "points": [(150, 225), (150, 125)],
                },
            ],
        )

        self.assertIn("edge-segment-overlap", {issue["type"] for issue in issues})

    def test_rejects_sideways_entry_into_top_port(self) -> None:
        issues = validate(
            [
                ("source", 0, 100),
                ("target", 300, 100),
            ],
            [
                {
                    "edge_id": "edge",
                    "source": "source",
                    "target": "target",
                    "ports": "exitX=1;exitY=0.5;entryX=0.5;entryY=0;",
                    "points": [(200, 125), (200, 100), (250, 100)],
                },
            ],
        )

        self.assertIn("edge-non-perpendicular-entry", {issue["type"] for issue in issues})


if __name__ == "__main__":
    unittest.main()

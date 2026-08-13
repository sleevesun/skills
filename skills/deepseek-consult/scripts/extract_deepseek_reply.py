#!/usr/bin/env python3
"""Extract and validate the latest visible DeepSeek answer from a saved extract."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ASSISTANT_MARKERS = ["#### DeepSeek 说：", "#### DeepSeek said:", "#### DeepSeek:", "DeepSeek 说：", "DeepSeek said:"]
USER_MARKERS = ["#### 你说：", "#### You said:", "#### User:", "你说：", "You said:"]


def load_content(path: str) -> str:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or "content" not in data:
        raise ValueError("Extract JSON must contain a top-level 'content' field")
    return str(data["content"])


def _snapshot_answer(content: str) -> str | None:
    headings = list(re.finditer(r'(?m)^- heading "(?:DeepSeek|AI助手|Assistant)(?: 说| said)?"[^\n]*$', content))
    if not headings:
        # The current DeepSeek snapshot may render a visible thought summary
        # followed by a final paragraph block, without an assistant heading.
        anchors = [m.end() for m in re.finditer(r"(?m)^- generic: .*?(?:已思考|Thinking).*?$", content)]
        if not anchors:
            return None
        section = content[anchors[-1] :]
        blocks: list[str] = []
        current: list[str] = []
        for line in section.splitlines():
            if line.startswith("- textbox") and blocks:
                break
            paragraph = re.match(r"^\s*- paragraph:\s*(.*)$", line)
            if paragraph:
                if current:
                    blocks.append(" ".join(current).strip())
                current = [paragraph.group(1).strip()]
                continue
            nested_text = re.match(r"^\s+- text:\s*(.*)$", line)
            if nested_text and current:
                current.append(nested_text.group(1).strip())
                continue
            if line.startswith("- ") and current:
                blocks.append(" ".join(current).strip())
                current = []
        if current:
            blocks.append(" ".join(current).strip())
        if blocks:
            sentinel_blocks = [block for block in blocks if "DEEPSEEK_RESULT_" in block]
            return (sentinel_blocks or blocks)[-1]
        return None
    section = content[headings[-1].end() :]
    paragraphs: list[str] = []
    for line in section.splitlines():
        if line.startswith("- ") and paragraphs:
            break
        match = re.match(r"^\s{2}- paragraph:\s*(.*)$", line)
        if match:
            paragraphs.append(match.group(1).strip())
    return "\n".join(paragraphs).strip() if paragraphs else None


def split_latest_assistant(content: str) -> str:
    markers: list[tuple[int, str]] = []
    for marker in ASSISTANT_MARKERS:
        start = 0
        while True:
            found = content.find(marker, start)
            if found == -1:
                break
            markers.append((found, marker))
            start = found + len(marker)
    if not markers:
        snapshot_answer = _snapshot_answer(content)
        if snapshot_answer:
            return snapshot_answer
        raise ValueError("No DeepSeek assistant marker found in extracted content")

    start, marker = sorted(markers)[-1]
    reply = content[start + len(marker) :].strip()
    stops = [pos for marker in ASSISTANT_MARKERS + USER_MARKERS if (pos := reply.find(marker)) != -1]
    if stops:
        reply = reply[: min(stops)].strip()
    return reply


def normalize_sentinel(text: str) -> str:
    return text.replace("\\_", "_")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extract_json", help="Extract JSON path, or '-' for stdin")
    parser.add_argument("--sentinel")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        reply = split_latest_assistant(load_content(args.extract_json))
        sentinel_ok = not args.sentinel or args.sentinel in normalize_sentinel(reply)
        if args.sentinel and not sentinel_ok:
            raise ValueError(f"Sentinel not found in latest DeepSeek answer: {args.sentinel}")
    except Exception as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        else:
            print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({"ok": True, "sentinel_ok": sentinel_ok, "reply": reply}, ensure_ascii=False, indent=2))
    else:
        print(reply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

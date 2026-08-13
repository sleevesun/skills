#!/usr/bin/env python3
"""Extract and validate the latest visible Gemini answer from a saved extract.

The Chrome workflow remains authoritative. This helper is for deterministic
post-processing when a transcript or main-region extract has been saved.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ASSISTANT_MARKERS = [
    "#### Gemini 说：",
    "#### Gemini said:",
    "#### Gemini:",
    "Gemini 说：",
    "Gemini said:",
]
USER_MARKERS = ["#### 你说：", "#### You said:", "#### User:", "你说：", "You said:"]
DISCLAIMER_PATTERNS = [
    r"\n+Gemini 可能会犯错。.*$",
    r"\n+Gemini may make mistakes\..*$",
]


def load_content(path: str) -> str:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or "content" not in data:
        raise ValueError("Extract JSON must contain a top-level 'content' field")
    return str(data["content"])


def split_latest_assistant(content: str) -> str:
    marker_positions: list[tuple[int, str]] = []
    for marker in ASSISTANT_MARKERS:
        start = 0
        while True:
            found = content.find(marker, start)
            if found == -1:
                break
            marker_positions.append((found, marker))
            start = found + len(marker)
    if not marker_positions:
        # Chrome DOM snapshots use a heading followed by paragraph lines
        # instead of transcript markers.
        snapshot_matches = list(re.finditer(r'(?m)^- heading "Gemini (?:说|said)"[^\n]*$', content))
        if snapshot_matches:
            section = content[snapshot_matches[-1].end() :]
            paragraph_matches: list[str] = []
            for line in section.splitlines():
                if line.startswith("- ") and paragraph_matches:
                    break
                match = re.match(r"^\s{2}- paragraph:\s*(.*)$", line)
                if match:
                    paragraph_matches.append(match.group(1).strip())
            if paragraph_matches:
                return "\n".join(item.strip() for item in paragraph_matches).strip()
        raise ValueError("No Gemini assistant marker found in extracted content")

    start, marker = sorted(marker_positions)[-1]
    reply = content[start + len(marker) :].strip()
    next_positions = [pos for marker in ASSISTANT_MARKERS + USER_MARKERS if (pos := reply.find(marker)) != -1]
    if next_positions:
        reply = reply[: min(next_positions)].strip()
    for pattern in DISCLAIMER_PATTERNS:
        reply = re.sub(pattern, "", reply, flags=re.DOTALL).strip()
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
        sentinel_ok = True
        if args.sentinel:
            sentinel_ok = args.sentinel in normalize_sentinel(reply)
            if not sentinel_ok:
                raise ValueError(f"Sentinel not found in latest Gemini answer: {args.sentinel}")
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

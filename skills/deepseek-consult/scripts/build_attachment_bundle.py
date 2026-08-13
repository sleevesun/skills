#!/usr/bin/env python3
"""Build a reviewable Markdown bundle for DeepSeek Web attachments."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable


EXTENSIONS = {".c", ".cc", ".cfg", ".conf", ".css", ".csv", ".go", ".h", ".html", ".ini", ".java", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".rb", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"}
SKIP_DIRS = {".git", ".hg", ".svn", ".venv", "venv", "env", "__pycache__", "node_modules", "dist", "build", ".next", ".cache"}


def iter_files(paths: Iterable[Path]) -> list[Path]:
    found = []
    for path in paths:
        if path.is_file():
            found.append(path)
        elif path.is_dir():
            found.extend(item for item in path.rglob("*") if item.is_file() and item.name != ".DS_Store" and not any(part in SKIP_DIRS for part in item.parts))
    return sorted(set(found), key=lambda path: str(path))


def label(path: Path, roots: list[Path]) -> str:
    for root in roots:
        try:
            return str(path.relative_to(root))
        except ValueError:
            pass
    return str(path)


def fence(path: Path) -> str:
    return {".md": "markdown", ".py": "python", ".js": "javascript", ".mjs": "javascript", ".ts": "typescript", ".tsx": "tsx", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".sh": "bash"}.get(path.suffix.lower(), path.suffix.lower().lstrip(".") or "text")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--max-file-bytes", type=int, default=250_000)
    parser.add_argument("--max-total-bytes", type=int, default=2_000_000)
    parser.add_argument("--include-extension", action="append", default=[])
    args = parser.parse_args()
    roots = [path.resolve() for path in args.paths if path.exists()]
    extensions = EXTENSIONS | {ext if ext.startswith(".") else f".{ext}" for ext in args.include_extension}
    selected: list[tuple[Path, str, int, bool]] = []
    skipped: list[str] = []
    total = 0
    for path in iter_files(roots):
        resolved = path.resolve()
        if resolved.suffix.lower() not in extensions:
            skipped.append(f"{label(resolved, roots)} (unsupported extension)")
            continue
        try:
            raw = resolved.read_bytes()
        except OSError as exc:
            skipped.append(f"{label(resolved, roots)} (read error: {exc})")
            continue
        if b"\x00" in raw[:4096]:
            skipped.append(f"{label(resolved, roots)} (binary)")
            continue
        truncated = len(raw) > args.max_file_bytes
        raw = raw[: args.max_file_bytes]
        if total + len(raw) > args.max_total_bytes:
            skipped.append(f"{label(resolved, roots)} (total limit)")
            continue
        total += len(raw)
        selected.append((resolved, raw.decode("utf-8", errors="replace"), len(raw), truncated))

    lines = ["# DeepSeek Attachment Bundle", "", "Local paths below are provenance labels only; the bundle contains the file text.", "", "## Manifest"]
    lines.extend(f"- `{label(path, roots)}` ({size} bytes{' truncated' if truncated else ''})" for path, _text, size, truncated in selected)
    if skipped:
        lines.extend(["", "## Skipped", *[f"- {item}" for item in skipped]])
    lines.extend(["", "## Files"])
    for path, text, _size, truncated in selected:
        lines.extend(["", f"### `{label(path, roots)}`", "", f"````{fence(path)}", text.rstrip(), "````"])
        if truncated:
            lines.extend(["", "[TRUNCATED: file exceeded max-file-bytes]"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.output)
    print(f"files={len(selected)} skipped={len(skipped)} bytes={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

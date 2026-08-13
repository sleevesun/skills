#!/usr/bin/env python3
"""Build a reviewable Markdown bundle for Gemini Web attachments."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable


DEFAULT_EXTENSIONS = {
    ".c", ".cc", ".cfg", ".conf", ".css", ".csv", ".go", ".h", ".html",
    ".ini", ".java", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".rb",
    ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}
SKIP_DIRS = {".git", ".hg", ".svn", ".venv", "venv", "env", "__pycache__", "node_modules", "dist", "build", ".next", ".cache"}
SKIP_FILES = {".DS_Store"}


def iter_files(paths: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_file():
            files.append(path)
            continue
        if not path.is_dir():
            continue
        for item in path.rglob("*"):
            if item.is_file() and item.name not in SKIP_FILES and not any(part in SKIP_DIRS for part in item.parts):
                files.append(item)
    return sorted(set(files), key=lambda p: str(p))


def is_text(path: Path, extensions: set[str]) -> bool:
    if path.suffix.lower() not in extensions:
        return False
    try:
        return b"\x00" not in path.read_bytes()[:4096]
    except OSError:
        return False


def label_for(path: Path, roots: list[Path]) -> str:
    for root in roots:
        try:
            return str(path.relative_to(root))
        except ValueError:
            pass
    return str(path)


def fence_for(path: Path) -> str:
    return {
        ".md": "markdown", ".py": "python", ".js": "javascript", ".mjs": "javascript",
        ".ts": "typescript", ".tsx": "tsx", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
        ".sh": "bash", ".html": "html", ".css": "css",
    }.get(path.suffix.lower(), path.suffix.lower().lstrip(".") or "text")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--max-file-bytes", type=int, default=250_000)
    parser.add_argument("--max-total-bytes", type=int, default=2_000_000)
    parser.add_argument("--include-extension", action="append", default=[])
    args = parser.parse_args()

    roots = [path.resolve() for path in args.paths if path.exists()]
    extensions = set(DEFAULT_EXTENSIONS)
    extensions.update(ext if ext.startswith(".") else f".{ext}" for ext in args.include_extension)
    selected: list[tuple[Path, str, int, bool]] = []
    skipped: list[str] = []
    total = 0

    for path in iter_files(roots):
        resolved = path.resolve()
        label = label_for(resolved, roots)
        if not is_text(resolved, extensions):
            skipped.append(f"{label} (unsupported or binary)")
            continue
        try:
            raw = resolved.read_bytes()
        except OSError as exc:
            skipped.append(f"{label} (read error: {exc})")
            continue
        truncated = len(raw) > args.max_file_bytes
        raw = raw[: args.max_file_bytes]
        if total + len(raw) > args.max_total_bytes:
            skipped.append(f"{label} (total bundle limit reached)")
            continue
        total += len(raw)
        selected.append((resolved, raw.decode("utf-8", errors="replace"), len(raw), truncated))

    lines = [
        "# Gemini 3.6 Flash Attachment Bundle",
        "",
        "This bundle contains local files for review. Local paths are provenance labels only.",
        "",
        "## Manifest",
    ]
    lines.extend(f"- `{label_for(path, roots)}` ({size} bytes{' truncated' if truncated else ''})" for path, _text, size, truncated in selected)
    if skipped:
        lines.extend(["", "## Skipped", *[f"- {item}" for item in skipped]])
    lines.extend(["", "## Files"])
    for path, text, _size, truncated in selected:
        label = label_for(path, roots)
        lines.extend(["", f"### `{label}`", "", f"````{fence_for(path)}", text.rstrip(), "````"])
        if truncated:
            lines.extend(["", "[TRUNCATED: file exceeded max-file-bytes]"])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.output)
    print(f"files={len(selected)} skipped={len(skipped)} bytes={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

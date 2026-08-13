#!/usr/bin/env python3
"""Pure helpers for validating DeepSeek Web route and progress evidence."""

from __future__ import annotations

import re


FAST = "FAST_THINK"
FAST_SEARCH = "FAST_THINK_SEARCH"
EXPERT = "EXPERT"
TOGGLE_ON_HINTS = ("aria-pressed=\"true\"", "aria-pressed=true", "ds-toggle-button--selected", "selected")
EXPERT_LIMITATION_HINTS = ("不支持搜索和文件上传", "does not support search and file uploads", "no search", "no file upload")
GENERATING_HINTS = ("停止生成", "Stop generating", "深度思考中", "正在思考", "正在搜索", "搜索中", "Thinking", "Searching")


def _has_any(text: str, hints: tuple[str, ...]) -> bool:
    lowered = text.casefold()
    return any(hint.casefold() in lowered for hint in hints)


def toggle_is_on(control_html_or_state: str) -> bool:
    """Accept only an explicit selected/pressed state, never a label alone."""
    return _has_any(control_html_or_state, TOGGLE_ON_HINTS)


def expert_limitations_present(state: str) -> bool:
    return _has_any(state, EXPERT_LIMITATION_HINTS)


def route_is_fast_search(route: str) -> bool:
    return route == FAST_SEARCH


def route_is_fast(route: str) -> bool:
    return route in (FAST, FAST_SEARCH)


def page_is_generating(state: str) -> bool:
    return _has_any(state, GENERATING_HINTS)


def extract_sentinel(packet: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    match = re.search(r"DEEPSEEK_RESULT_[A-Za-z0-9_:-]+", packet)
    if not match:
        raise ValueError("Could not infer a DEEPSEEK_RESULT_... sentinel")
    return match.group(0)

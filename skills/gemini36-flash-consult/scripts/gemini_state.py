#!/usr/bin/env python3
"""Pure helpers for validating Gemini Web mode evidence."""

from __future__ import annotations

import re


FLASH36_HINTS = ("3.6 Flash",)
EXTENDED_HINTS = ("扩展思考", "Flash 扩展", "extended thinking", "Flash extended")
SELECTED_HINTS = ("selected", "已选中", "aria-checked=true", "aria-selected=true")
GENERATING_HINTS = (
    "停止回答",
    "停止生成",
    "Stop generating",
    "正在思考",
    "正在生成",
    "Thinking",
    "Generating",
)


def _has_any(text: str, hints: tuple[str, ...]) -> bool:
    lowered = text.casefold()
    return any((hint.casefold() in lowered) for hint in hints)


def _selected_block(state: str, label_hint: str) -> bool:
    lines = state.splitlines()
    for index, line in enumerate(lines):
        if label_hint.casefold() not in line.casefold():
            continue
        block = "\n".join(lines[index : index + 5])
        if _has_any(block, SELECTED_HINTS):
            return True
    return False


def model_is_confirmed(menu_state: str, mode_button_state: str = "") -> bool:
    """Require visible 3.6 Flash plus a selected-state signal."""
    combined = f"{menu_state}\n{mode_button_state}"
    if not _has_any(combined, FLASH36_HINTS):
        return False
    return _selected_block(menu_state, "3.6 Flash") or _has_any(mode_button_state, ("3.6 Flash",))


def extended_thinking_is_confirmed(menu_state: str, mode_button_state: str = "") -> bool:
    """Require a selected thinking item or a visible extended-mode button label."""
    if _has_any(mode_button_state, EXTENDED_HINTS[1:] + ("扩展", "thinking")):
        return True
    return _selected_block(menu_state, "扩展思考") or _selected_block(menu_state, "extended thinking")


def mode_is_confirmed(menu_state: str, mode_button_state: str = "") -> bool:
    return model_is_confirmed(menu_state, mode_button_state) and extended_thinking_is_confirmed(menu_state, mode_button_state)


def page_is_generating(state: str) -> bool:
    return _has_any(state, GENERATING_HINTS)


def extract_sentinel(packet: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    match = re.search(r"GEMINI36_FLASH_RESULT_[A-Za-z0-9_:-]+", packet)
    if not match:
        raise ValueError("Could not infer a GEMINI36_FLASH_RESULT_... sentinel")
    return match.group(0)

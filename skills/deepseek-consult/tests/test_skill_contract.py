#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR / "scripts"))
from deepseek_state import (  # noqa: E402
    EXPERT,
    FAST_SEARCH,
    expert_limitations_present,
    extract_sentinel,
    page_is_generating,
    toggle_is_on,
)
from extract_deepseek_reply import split_latest_assistant  # noqa: E402


class SkillContractTests(unittest.TestCase):
    def test_auto_route_and_chrome_default_are_documented(self) -> None:
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Use the Codex Chrome plugin for every consultation", skill)
        self.assertIn("FAST_THINK_SEARCH", skill)
        self.assertIn("EXPERT", skill)
        self.assertIn("Do not use OpenCLI", skill)
        self.assertIn("不支持搜索和文件上传", skill)

    def test_required_public_files_exist(self) -> None:
        for relative in (
            "agents/openai.yaml",
            "references/chrome-workflow.md",
            "references/context-packet-template.md",
            "scripts/build_attachment_bundle.py",
            "scripts/check_packet_safety.py",
            "scripts/deepseek_state.py",
            "scripts/extract_deepseek_reply.py",
            "evals/evals.json",
        ):
            self.assertTrue((SKILL_DIR / relative).is_file(), relative)

    def test_no_personal_absolute_paths(self) -> None:
        for path in SKILL_DIR.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                text = path.read_text(encoding="utf-8", errors="ignore")
                for forbidden in ("/" + "Users/me/", "/" + "Users/xianer/"):
                    self.assertNotIn(forbidden, text, str(path))

    def test_evals_cover_chrome_and_route_evidence(self) -> None:
        payload = json.loads((SKILL_DIR / "evals/evals.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(payload["evals"]), 5)
        for case in payload["evals"]:
            self.assertIn("Chrome", case["expected_output"])
            self.assertIn("DeepSeek", case["prompt"])

    def test_workflow_requires_selected_toggles_and_safe_recovery(self) -> None:
        workflow = (SKILL_DIR / "references/chrome-workflow.md").read_text(encoding="utf-8")
        for required in (
            "aria-pressed=true",
            'waitForEvent("filechooser"',
            "chooser.setFiles",
            "innerText()",
            "never create a fresh consultation or click Send again",
            "may be reclassified as `NOT_SENT` only when a fresh snapshot proves",
            "`NOT_SENT`",
            "`SENT`",
            "`UNKNOWN`",
        ):
            self.assertIn(required, workflow)

    def test_toggle_and_expert_evidence_helpers(self) -> None:
        self.assertTrue(toggle_is_on('<div aria-pressed="true" class="ds-toggle-button--selected">'))
        self.assertFalse(toggle_is_on('<div aria-pressed="false">'))
        self.assertTrue(expert_limitations_present("擅长复杂问题，资源紧张，不支持搜索和文件上传"))
        self.assertEqual(EXPERT, "EXPERT")
        self.assertEqual(FAST_SEARCH, "FAST_THINK_SEARCH")

    def test_progress_and_sentinel_helpers(self) -> None:
        self.assertTrue(page_is_generating("深度思考中\n停止生成"))
        self.assertEqual(extract_sentinel("DEEPSEEK_RESULT_20260813_TEST"), "DEEPSEEK_RESULT_20260813_TEST")

    def test_extracts_deepseek_snapshot_assistant_turn(self) -> None:
        snapshot = '- heading "DeepSeek 说" [level=2]\n  - paragraph: DEEPSEEK_RESULT_TEST answer\n  - button "复制"\n- textbox "给 DeepSeek 发送消息"\n  - paragraph: placeholder'
        self.assertEqual(split_latest_assistant(snapshot), "DEEPSEEK_RESULT_TEST answer")

    def test_extracts_current_deepseek_thought_then_final_block(self) -> None:
        snapshot = '- generic: 已思考（用时 1 秒）\n- paragraph: internal summary\n- paragraph:\n  - text: DEEPSEEK_RESULT_TEST\n  - text: final answer\n- textbox "给 DeepSeek 发送消息"'
        self.assertEqual(split_latest_assistant(snapshot), "DEEPSEEK_RESULT_TEST final answer")


if __name__ == "__main__":
    unittest.main()

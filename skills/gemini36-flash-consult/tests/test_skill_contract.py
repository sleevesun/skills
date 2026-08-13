#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR / "scripts"))
from extract_gemini_reply import split_latest_assistant  # noqa: E402
from gemini_state import extended_thinking_is_confirmed, model_is_confirmed  # noqa: E402


class SkillContractTests(unittest.TestCase):
    def test_chrome_is_default_and_opencli_is_not_a_fallback(self) -> None:
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Use the Codex Chrome plugin for every consultation", skill)
        self.assertIn("This Skill intentionally has no OpenCLI fallback", skill)
        self.assertIn("3.6 Flash", skill)
        self.assertIn("扩展思考", skill)

    def test_required_public_files_exist(self) -> None:
        for relative in (
            "agents/openai.yaml",
            "references/chrome-workflow.md",
            "references/context-packet-template.md",
            "scripts/build_attachment_bundle.py",
            "scripts/check_packet_safety.py",
            "scripts/extract_gemini_reply.py",
            "scripts/gemini_state.py",
            "evals/evals.json",
        ):
            self.assertTrue((SKILL_DIR / relative).is_file(), relative)

    def test_no_personal_absolute_paths(self) -> None:
        for path in SKILL_DIR.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                text = path.read_text(encoding="utf-8", errors="ignore")
                for forbidden in ("/" + "Users/me/", "/" + "Users/xianer/"):
                    self.assertNotIn(forbidden, text, str(path))

    def test_evals_route_normal_requests_to_chrome(self) -> None:
        payload = json.loads((SKILL_DIR / "evals/evals.json").read_text(encoding="utf-8"))
        for case in payload["evals"]:
            self.assertIn("Chrome", case["expected_output"])
            self.assertIn("3.6 Flash", case["expected_output"])

    def test_chrome_workflow_has_atomic_upload_and_verified_composer(self) -> None:
        workflow = (SKILL_DIR / "references/chrome-workflow.md").read_text(encoding="utf-8")
        for required in (
            "one `node_repl js` invocation",
            'waitForEvent("filechooser",',
            "chooser.setFiles",
            "innerText()",
            "Never click Send with an empty or unverified packet",
        ):
            self.assertIn(required, workflow)

    def test_chrome_workflow_blocks_duplicate_send_after_ambiguous_reset(self) -> None:
        workflow = (SKILL_DIR / "references/chrome-workflow.md").read_text(encoding="utf-8")
        for state in ("`NOT_SENT`", "`SENT`", "`UNKNOWN`"):
            self.assertIn(state, workflow)
        self.assertIn("Never create a fresh consultation or click Send again", workflow)
        self.assertIn("mark the consultation incomplete instead of risking a duplicate", workflow)

    def test_mode_evidence_is_visible_and_selected(self) -> None:
        menu = """
        - menuitem \"已选中 3.6 Flash 全方位帮助\" [selected]
        - menuitem \"扩展思考 擅长解决复杂问题\" [selected]
        """
        self.assertTrue(model_is_confirmed(menu))
        self.assertTrue(extended_thinking_is_confirmed(menu))

    def test_bare_flash_is_not_extended_mode(self) -> None:
        menu = "- menuitem \"已选中 3.6 Flash\" [selected]\n- menuitem \"扩展思考\""
        self.assertTrue(model_is_confirmed(menu))
        self.assertFalse(extended_thinking_is_confirmed(menu, "Flash"))

    def test_mode_button_proves_extended_thinking(self) -> None:
        self.assertTrue(extended_thinking_is_confirmed("", "Flash\n扩展"))

    def test_extracts_chrome_snapshot_assistant_turn(self) -> None:
        snapshot = '- heading "Gemini 说" [level=2]\n  - paragraph: GEMINI36_FLASH_RESULT_TEST answer\n  - button "复制"\n- textbox "为 Gemini 输入提示"\n  - paragraph: Gemini 是一款 AI 工具'
        self.assertEqual(split_latest_assistant(snapshot), "GEMINI36_FLASH_RESULT_TEST answer")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Scan a Gemini 3.6 Flash context packet for executable credentials.

The scanner is intentionally light-touch: project, business, and product
context should remain available for useful review. Credential-like material
blocks by default; ordinary personal data is reported as a warning.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


HIGH_PATTERNS = [
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PRIVATE )?PRIVATE KEY-----")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{30,}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("authorization_header", re.compile(r"(?i)\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}")),
    ("cookie_header", re.compile(r"(?i)\bCookie\s*:\s*[^\n]{20,}")),
    ("password_assignment", re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['\"]?[^\s'\"]{8,}")),
]

WARN_PATTERNS = [
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("phone_cn", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("id_card_cn", re.compile(r"\b\d{17}[\dXx]\b")),
    ("absolute_user_path", re.compile(r"/Users/[^\s`'\"<>]+")),
    ("private_url", re.compile(r"https?://(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+)[^\s`'\"<>]*")),
]


def compact_excerpt(text: str, start: int, end: int) -> str:
    left = max(0, start - 12)
    right = min(len(text), end + 12)
    snippet = text[left:right].replace("\n", "\\n")
    return snippet if len(snippet) <= 80 else snippet[:77] + "..."


def scan(text: str) -> dict:
    findings = []
    for severity, patterns in (("high", HIGH_PATTERNS), ("warn", WARN_PATTERNS)):
        for name, pattern in patterns:
            for match in pattern.finditer(text):
                findings.append(
                    {
                        "severity": severity,
                        "type": name,
                        "start": match.start(),
                        "end": match.end(),
                        "excerpt": compact_excerpt(text, match.start(), match.end()),
                    }
                )

    high_count = sum(item["severity"] == "high" for item in findings)
    warn_count = sum(item["severity"] == "warn" for item in findings)
    return {
        "ok": high_count == 0,
        "high_count": high_count,
        "warn_count": warn_count,
        "char_count": len(text),
        "findings": findings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", help="Path to packet Markdown, or '-' for stdin")
    parser.add_argument("--max-chars", type=int, default=15000)
    parser.add_argument("--fail-on-length", action="store_true")
    parser.add_argument("--allow-credentials", action="store_true")
    args = parser.parse_args()

    text = sys.stdin.read() if args.packet == "-" else Path(args.packet).read_text(encoding="utf-8")
    result = scan(text)
    if len(text) > args.max_chars:
        severity = "high" if args.fail_on_length else "warn"
        result["findings"].append(
            {
                "severity": severity,
                "type": "packet_too_long",
                "start": args.max_chars,
                "end": len(text),
                "excerpt": f"{len(text)} chars exceeds max {args.max_chars}",
            }
        )
        if severity == "high":
            result["high_count"] += 1
            result["ok"] = False
        else:
            result["warn_count"] += 1

    if args.allow_credentials:
        result["ok"] = True

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

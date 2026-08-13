---
name: gemini36-flash-consult
description: Use Gemini Web's 3.6 Flash with extended thinking as a verified second-opinion partner for difficult planning, architecture, debugging, product, content, risk-review, and Skill-design work. Use when the user asks for Gemini 3.6 Flash, Gemini extended thinking, a Gemini web review, or a file-grounded Gemini consultation. Operate through the Codex Chrome plugin, confirm both the 3.6 Flash model and the visible extended-thinking mode, and return only the completed final answer as advisory input to the local Agent.
---

# Gemini 3.6 Flash Consult

Ask Gemini Web to review a difficult problem with the evidence it needs, then bring the result back into the local Agent workflow. The local Agent owns verification, adoption, and final delivery. Gemini's visible answer is advisory; do not treat it as an authority or as a substitute for local checks.

## Routing contract

Use the Codex Chrome plugin for every consultation. Read and follow the installed `chrome:control-chrome` Skill before browser work, then read [Chrome workflow](references/chrome-workflow.md).

Use a fresh or agent-owned Gemini tab. Do not bind an OpenCLI command to that tab. OpenCLI and the Codex Chrome extension both use Chrome's debugger API, so an installed OpenCLI extension is not a reason to switch paths and can cause tab preemption if both tools target the same tab. This Skill intentionally has no OpenCLI fallback.

If Chrome is unavailable, Gemini is not logged in, or either required mode is missing, stop and report the exact gate that failed. Never imply that a Gemini consultation completed.

## Requirements

- The selected Chrome profile is logged into `gemini.google.com`.
- The model picker exposes the visible item `3.6 Flash`.
- The same picker exposes the visible item `扩展思考` (or its current localized equivalent).
- The selected mode can be verified from the mode button or another visible selected-state indicator. A bare `Flash` label is not enough.

The current Gemini Web UI presents the combination as `3.6 Flash` plus `扩展思考`; after selection the mode button has been observed as `Flash 扩展`. Treat those labels as semantic evidence, not permanent DOM or internal IDs.

## Hard gates

### Model and thinking truthfulness

Confirm all of the following immediately before sending:

1. The mode menu contains a unique `3.6 Flash` item, not only `3.5 Flash-Lite` or `3.1 Pro`.
2. The `3.6 Flash` item is selected, or the mode button otherwise states that 3.6 Flash is active.
3. The `扩展思考` item is selected, or the mode button visibly combines Flash with extended thinking (for example, `Flash 扩展`).

Reject a bare `Flash`, a stale menu snapshot, a hidden/internal model ID without visible confirmation, or a response that was generated before the required mode was verified.

### Artifact truthfulness

Gemini Web cannot read a local path by itself. Upload the actual file, paste its contents, or build a text bundle. Never claim Gemini inspected a file when it received only a filename, path, or summary.

### Credential hygiene

Do not send executable credentials: tokens, cookies, passwords, API keys, private keys, OAuth headers, browser profiles, or session dumps. Ordinary user-owned business and project context may be included when it materially improves the judgment.

Run the bundled scanner before submission:

```bash
SKILL_DIR="<path-to-installed-gemini36-flash-consult>"
python3 "$SKILL_DIR/scripts/check_packet_safety.py" packet.md
```

## Workflow

1. Write the local Agent's best judgment before consulting Gemini. Identify the decision, success standard, evidence, constraints, options, risks, attempts, and unknowns.
2. Build a restorable context packet using [the template](references/context-packet-template.md). Separate facts, local judgment, and unknowns.
3. Select the smallest evidence set that still contains the truth. Use actual attachments when structure, formatting, source layout, logs, images, documents, or implementation details matter.
4. Run the safety scanner. Remove credential-like material; keep useful project context.
5. Execute the [Chrome workflow](references/chrome-workflow.md). Keep each file-chooser lifecycle inside one browser invocation, reacquire the composer after uploads, and verify the complete draft before sending.
6. Confirm `3.6 Flash` plus extended thinking immediately before Send. Record the model evidence, mode evidence, timestamp, context strategy, attachment names, sentinel, and dispatch state.
7. Wait for the complete Gemini turn. A preamble, visible thinking indicator, or missing sentinel while the page is generating means “not ready.” Continue or recover the same conversation; do not submit a duplicate request when Send was clicked or its outcome is uncertain.
8. Extract the latest complete assistant turn, verify the sentinel, compare it with local evidence, and decide what to adopt, reject, or modify. Extract only the visible final answer; do not request or reproduce hidden chain-of-thought.

## Context assembly

Include:

- Exact decision or problem
- Success standard and user intent
- Relevant background and constraints
- Local judgment before consultation
- Evidence and actual artifacts
- Attempts and verbatim errors
- Meaningful options and tradeoffs
- Risks and unknowns
- Requested output: critique, decision, architecture, plan, checklist, or revision

For difficult work, prefer a structured 8,000–15,000-character packet over a short prompt that removes causal details. Ask for a concise reasoning brief—assumptions, decision frame, evidence weighting, strongest counterargument, tradeoffs, and recommendation—without requesting hidden chain-of-thought.

## Attachments

Use attachments when the answer depends on local Skills, repositories, source files, screenshots, documents, spreadsheets, slides, PDFs, datasets, logs, or rendered output.

When a directory contains many text files, build one reviewable bundle:

```bash
SKILL_DIR="<path-to-installed-gemini36-flash-consult>"
python3 "$SKILL_DIR/scripts/build_attachment_bundle.py" \
  /path/to/artifact-or-directory \
  -o /tmp/gemini36-flash-attachment-bundle.md
```

List every attachment in the packet. Upload original human-readable files first; use a generated Markdown bundle when there are too many files or archives are rejected. Exclude caches, dependencies, build output, `.git`, secrets, and irrelevant binaries.

## Completion contract

A consultation is complete only when all are true:

- `3.6 Flash` selection was verified.
- Extended thinking selection was verified.
- The prompt's distinctive prefix and sentinel were verified in the composer's rendered text, and every required attachment was visibly present before sending.
- Send was clicked once and the dispatch state is known or safely recovered.
- Gemini stopped generating.
- The complete latest assistant turn was extracted.
- The expected `GEMINI36_FLASH_RESULT_...` sentinel appears in that assistant turn.

## Local integration

Return:

```markdown
## Gemini 3.6 Flash Consultation Result
- Status: completed | failed | skipped
- Model confirmed: yes | no
- Extended thinking confirmed: yes | no
- Sentinel verified: yes | no
- Browser path: Codex Chrome

## What Gemini 3.6 Flash Said
<concise summary>

## Local Adoption Decision
- Adopt:
- Reject:
- Modify:
- Reason:

## Final Answer
<the local Agent's verified recommendation or deliverable>
```

## Failure handling

- **Chrome unavailable:** stop and report the missing Chrome connection. Do not silently use OpenCLI.
- **Debugger conflict or tab preemption:** create a fresh agent-owned tab and retry the preparation step once. Do not target a tab in an `OpenCLI Browser` group. If the conflict occurs after Send, follow `NOT_SENT` / `SENT` / `UNKNOWN` recovery and never duplicate the request.
- **Not logged in:** ask the user to sign in to Gemini Web in the selected Chrome profile.
- **3.6 Flash unavailable:** stop without silently selecting 3.5 Flash-Lite, 3.1 Pro, or another model.
- **Extended thinking unavailable:** stop without silently treating base Flash as extended thinking.
- **Attachment failed:** retry through Chrome's real file chooser, paste small content, or use one Markdown bundle. Do not claim the file was received.
- **Composer remains empty:** reacquire the composer, verify its rendered text, and stop rather than sending an empty or unverified packet.
- **Chrome resets around Send:** retry preparation only when Send was definitely not clicked. When it was clicked or the outcome is uncertain, recover the existing Gemini conversation and never submit a duplicate.
- **Still generating:** keep waiting in the same conversation and inspect targeted completion signals; extended thinking can take longer than base Flash.
- **Missing sentinel after completion:** extract the complete latest assistant turn once more. Mark the consultation incomplete when the final answer still lacks the sentinel or appears truncated.
- **Low-quality answer:** use only supported parts. The local Agent retains final judgment.

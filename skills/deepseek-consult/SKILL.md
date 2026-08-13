---
name: deepseek-consult
description: Use DeepSeek Web as a verified second-opinion partner for difficult planning, architecture, debugging, product, content, research, risk-review, and Skill-design work. Trigger whenever the user asks for DeepSeek, 深度思考, 智能搜索/联网搜索, 专家模式, a DeepSeek web review, or a file-grounded DeepSeek consultation. Use the Codex Chrome plugin, route automatically between 快速模式 with 深度思考/智能搜索 and 专家模式, verify the active controls, and return only a completed visible answer as advisory input to the local Agent.
---

# DeepSeek Consult

Ask DeepSeek Web to review a difficult problem with the evidence it needs, then bring the result back into the local Agent workflow. The local Agent owns verification, adoption, and final delivery. Treat DeepSeek's answer as advisory, not as an authority.

## Routing contract

Use the Codex Chrome plugin for every consultation. Read and follow the installed `chrome:control-chrome` Skill before browser work, then read [Chrome workflow](references/chrome-workflow.md).

The default route is **快速模式 + 深度思考 + 智能搜索**. It is the only route that can currently combine reasoning, web freshness, and file uploads in the observed web UI. Use **专家模式** only for pure reasoning when no web search, current facts, or uploaded files are needed, or when the user explicitly accepts those limitations.

Do not use OpenCLI for this Skill. OpenCLI and the Codex Chrome extension can compete for Chrome's debugger API. Keep every DeepSeek tab fresh or agent-owned and isolated from any OpenCLI-owned tab.

If Chrome is unavailable, DeepSeek is not logged in, a required mode is missing, or a requested capability is unsupported by the selected mode, stop and report the exact gate. Never silently substitute another mode or imply that a consultation completed.

## Automatic mode policy

Classify the task before opening the mode picker:

### `FAST_THINK_SEARCH` (default)

Use 快速模式 with 深度思考 enabled and 智能搜索 enabled when any of these apply:

- the user asks for current, latest, factual, market, policy, product, schedule, or web research;
- the answer may depend on facts after the model's knowledge boundary;
- the user requests联网搜索/智能搜索;
- local files, screenshots, documents, source code, or other attachments are required;
- the task is a broad second opinion where fresh counterevidence is useful.

### `FAST_THINK`

Use 快速模式 with 深度思考 enabled and 智能搜索 disabled when the user wants reasoning over supplied context and explicitly does not want web search. Keep uploads available.

### `EXPERT`

Use 专家模式 only when the task is self-contained, does not need web search or uploads, and the extra resource budget is worth the tradeoff. The current UI states `擅长复杂问题，资源紧张，不支持搜索和文件上传`. If the user asks for Expert while also asking for search or files, prefer FAST_THINK_SEARCH and explain the conflict briefly.

Do not infer that Expert mode is “better” for every task. It is a specialist pure-reasoning route, not a superset of the fast route.

## Requirements and hard gates

- The selected Chrome profile is logged into `chat.deepseek.com`.
- The visible mode picker exposes `快速模式`, `专家模式`, and (when applicable) `识图模式`.
- The selected radio is verified with its checked state.
- For a fast route, the `深度思考` and `智能搜索` toggles are verified with `aria-pressed=true` or an equivalent selected-state signal. Do not claim a feature is enabled from its label alone.
- For an Expert route, the visible limitation text is recorded and no search or upload is attempted.
- Search is considered used only when the completed answer shows visible search/tool evidence or source references; an enabled toggle alone is not proof that search ran.

### Artifact truthfulness

DeepSeek Web cannot read a local path by itself. Upload the actual file, paste its contents, or build a text bundle. Never claim DeepSeek inspected a file when it received only a filename, path, or summary. Expert mode cannot accept uploads in the current UI; route to fast mode when artifacts matter.

### Credential hygiene

Do not send executable credentials: tokens, cookies, passwords, API keys, private keys, OAuth headers, browser profiles, or session dumps. Ordinary user-owned business and project context may be included when it materially improves the judgment.

Run the bundled scanner before submission:

```bash
SKILL_DIR="<path-to-installed-deepseek-consult>"
python3 "$SKILL_DIR/scripts/check_packet_safety.py" packet.md
```

## Workflow

1. Write the local Agent's best judgment before consulting DeepSeek. Identify the decision, success standard, evidence, constraints, options, risks, attempts, and unknowns.
2. Build a restorable context packet using [the template](references/context-packet-template.md). Separate facts, local judgment, and unknowns.
3. Select the smallest evidence set that still contains the truth. Use actual attachments whenever structure, formatting, source layout, logs, screenshots, or implementation details matter.
4. Run the safety scanner. Remove credential-like material; keep useful project context.
5. Apply the automatic mode policy and execute [Chrome workflow](references/chrome-workflow.md). Reacquire the composer after mode or upload changes.
6. Confirm the selected radio and every required toggle immediately before Send. Record the mode route, toggle evidence, timestamp, context strategy, attachment names, sentinel, and dispatch state.
7. Wait for the complete DeepSeek turn. A thinking/search preamble or missing sentinel while the page is generating means “not ready.” Continue or recover the same conversation; do not submit a duplicate when Send was clicked or its outcome is uncertain.
8. Extract the latest complete visible answer, verify the sentinel and any requested search evidence, compare it with local evidence, and decide what to adopt, reject, or modify. Do not request or reproduce hidden chain-of-thought.

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

Use attachments in fast mode when the answer depends on local Skills, repositories, source files, screenshots, documents, spreadsheets, slides, PDFs, datasets, logs, or rendered output.

When a directory contains many text files, build one reviewable bundle:

```bash
SKILL_DIR="<path-to-installed-deepseek-consult>"
python3 "$SKILL_DIR/scripts/build_attachment_bundle.py" \
  /path/to/artifact-or-directory \
  -o /tmp/deepseek-attachment-bundle.md
```

List every attachment in the packet. Exclude caches, dependencies, build output, `.git`, secrets, and irrelevant binaries.

## Completion contract

A consultation is complete only when all are true:

- The chosen radio mode was verified.
- Every requested fast-mode toggle was verified, or Expert's limitations were explicitly accepted.
- The prompt prefix and `DEEPSEEK_RESULT_...` sentinel were visible in the composer.
- Every required attachment was visibly present before sending.
- Send was clicked once and the dispatch state is known or safely recovered.
- DeepSeek stopped generating.
- The complete latest assistant turn was extracted.
- The sentinel appears inside that assistant turn; if search was requested, visible search/source evidence is also present.

## Local integration

Return:

```markdown
## DeepSeek Consultation Result
- Status: completed | failed | skipped
- Mode: FAST_THINK_SEARCH | FAST_THINK | EXPERT
- Deep thinking confirmed: yes | no | n/a
- Smart search confirmed: yes | no | n/a
- Attachments confirmed: yes | no | n/a
- Sentinel verified: yes | no
- Browser path: Codex Chrome

## What DeepSeek Said
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
- **Debugger conflict or tab preemption:** create a fresh agent-owned tab and retry preparation once. If the conflict occurs after Send, follow `NOT_SENT` / `SENT` / `UNKNOWN` recovery and never duplicate the request.
- **Not logged in:** ask the user to sign in to DeepSeek Web in the selected Chrome profile.
- **Expert requested with search/files:** prefer FAST_THINK_SEARCH and state why, unless the user explicitly accepts an incomplete capability set.
- **Toggle state unverifiable:** stop; a visible label without selected-state evidence is not enough.
- **Attachment failed:** retry through Chrome's real file chooser or use one Markdown bundle. Do not claim the file was received.
- **Composer remains empty:** reacquire it and verify the rendered text; never send an empty or unverified packet.
- **Chrome resets around Send:** retry preparation only when Send was definitely not clicked. When it was clicked or the outcome is uncertain, recover the existing conversation and never submit a duplicate.
- **Still thinking/searching:** keep waiting in the same conversation and inspect targeted completion signals.
- **Search toggle enabled but no source evidence:** report that search could not be verified; do not present the answer as web-grounded.
- **Missing sentinel after completion:** extract the complete latest assistant turn once more; otherwise mark the consultation incomplete.
- **Low-quality answer:** use only supported parts. The local Agent retains final judgment.

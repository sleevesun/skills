# Gemini 3.6 Flash Chrome Workflow

Use this as the execution path for every Gemini 3.6 Flash consultation. The workflow is deliberately model- and mode-verifying: a response from base Flash, 3.5 Flash-Lite, or 3.1 Pro is not a successful consultation.

## Contents

- Connect to Chrome
- Confirm authentication, model, and extended thinking
- Upload required files
- Insert and verify the context packet
- Send once and recover safely
- Extract and verify

## 1. Connect to Chrome

1. Read the installed `chrome:control-chrome` Skill completely.
2. Discover the `node_repl js` tool when it is not already callable.
3. Initialize the browser runtime from the Chrome plugin's own absolute `scripts/browser-client.mjs` path.
4. Select the Chrome binding with `agent.browsers.get("chrome")` and read its complete documentation before interacting.
5. Reuse an existing Gemini tab only when it is listed by `browser.tabs.list()` as an agent-owned tab. Otherwise create a fresh tab and navigate directly to `https://gemini.google.com/app`.
6. Never use a tab in an `OpenCLI Browser` group or a tab bound to an OpenCLI session. Both OpenCLI and the Codex Chrome extension use Chrome's debugger API.

Do not inspect cookies, local storage, passwords, profiles, or session stores. Browser discovery must remain read-only. Do not use a standalone Playwright connection or a second browser-control server for this workflow.

Treat a browser-kernel reset as loss of every prior JavaScript binding and unresolved promise. Reinitialize the runtime and reacquire `agent`, `chrome`, `tab`, and fresh locators. Never carry an unresolved file-chooser or browser promise into a later invocation.

## 2. Confirm authentication, model, and extended thinking

Take one fresh DOM snapshot after navigation. Confirm that a signed-in Gemini profile is visible and that the composer with a placeholder such as `为 Gemini 输入提示` or `Enter a prompt` is available. Do not send anything while the page is still on a sign-in screen.

Open the mode picker using locator ground truth from the latest snapshot. Before every click:

1. Build a stable locator from the latest snapshot.
2. Call `count()` unless uniqueness is self-evident.
3. Click only when exactly one element matches.
4. Take a targeted observation after the UI changes.

The current Chinese UI has been observed with locators equivalent to:

```js
const modeButton = tab.playwright.getByRole("button", {
  name: /打开模式选择器.*模式为.*Flash|mode picker.*Flash/i,
});
const flash36Item = tab.playwright.getByRole("menuitem", {
  name: /3\.6 Flash/i,
});
const extendedThinkingItem = tab.playwright.getByRole("menuitem", {
  name: /扩展思考|extended thinking/i,
});
```

Do not assume the current `data-mode-id` or `data-test-id` is stable. Prefer the visible role/name. If localization changes, derive an equivalent semantic locator from the latest snapshot and record the visible evidence.

Select and verify in this order:

1. Open the mode picker and verify a unique `3.6 Flash` menu item is present. If the menu only shows `3.5 Flash-Lite`, `3.1 Pro`, or another model, stop.
2. If `3.6 Flash` is not selected, click that item once. Reopen the picker if selecting the model closes it.
3. Verify the model selection from the selected class, check icon/aria label, or visible mode button. A visible bare `Flash` is not sufficient if the model family is unknown.
4. Open the picker again if needed and click the unique `扩展思考` / `extended thinking` item once when it is not already selected.
5. Verify the mode button or selected menu state visibly combines Flash and extended thinking. The current UI has shown `Flash` followed by `扩展`, while the menu item reads `扩展思考`.

If the UI offers only an unlabeled toggle or a hidden internal mode ID, do not infer that it is extended thinking. Stop and report that the mode could not be verified.

## 3. Upload required files

Use attachments when structure, formatting, source layout, logs, screenshots, documents, or rendered output materially affects the answer. Read the Chrome plugin's file-upload documentation before uploading.

Use the real file chooser. Keep promise creation, the menu click, `await`, and `setFiles` inside one `node_repl js` invocation:

```js
const chooserPromise = tab.playwright.waitForEvent("filechooser", { timeoutMs: 15000 });

// Build this locator from a fresh snapshot. The visible label may be localized.
const addButton = tab.playwright.getByRole("button", {
  name: /添加|上传|文件|照片|attach|file/i,
});
if (await addButton.count() !== 1) throw new Error("Expected one Gemini attachment control");
await addButton.click();

const fileMenuItem = tab.playwright.getByText(
  /添加照片和文件|上传文件|Upload files|Add files/i,
  { exact: false },
);
if (await fileMenuItem.count() !== 1) throw new Error("Expected one Gemini file menu item");
await fileMenuItem.click();

const chooser = await chooserPromise;
await chooser.setFiles(["/path/to/file.md"]);
```

Reacquire the composer after each upload and verify every required filename or attachment card is visible. If multiple uploads are unstable, combine text sources with `scripts/build_attachment_bundle.py` and upload one Markdown file. Do not use OpenCLI for uploads.

## 4. Insert and verify the context packet

Run `scripts/check_packet_safety.py` locally before touching the composer. Use the Chrome plugin's supported text-entry method once to insert the complete packet.

The current UI exposes a textbox similar to:

```js
const composer = tab.playwright.getByRole("textbox", {
  name: /为 Gemini 输入提示|Enter a prompt|Type a message/i,
});
if (await composer.count() !== 1) throw new Error("Expected one Gemini composer");
await composer.fill(packet);
```

Reacquire the composer and read `innerText()` (or the supported value/text property) from a fresh locator. Require both a distinctive packet prefix and the unique `GEMINI36_FLASH_RESULT_...` sentinel. An attachment card, filename, or local path is not composer text.

If the composer is empty or the sentinel is missing, inspect a fresh snapshot once and use the supported text-entry action again only when the first action definitely failed. Do not loop through fill, type, and paste. Never click Send with an empty or unverified packet.

Immediately before Send, verify all of these again:

- the model evidence says `3.6 Flash`;
- the mode evidence says extended thinking;
- the packet prefix and sentinel are rendered in the composer;
- every required attachment is visible;
- the send control is enabled and unique.

## 5. Send once and recover safely

Track `dispatch_state` locally:

- `NOT_SENT`: Send has definitely not been clicked.
- `SENT`: the click completed and a fresh observation shows the user turn, an emptied composer, or active generation.
- `UNKNOWN`: the browser resets, disconnects, or times out during or after the click before submission evidence is observed.

Click Send exactly once. Set `SENT` only after observing submission evidence; use `UNKNOWN` for every ambiguous click outcome.

When Chrome resets in `NOT_SENT`, reconnect, re-confirm the model and extended thinking, and rebuild the draft in an existing or fresh Gemini tab. When the state is `SENT` or `UNKNOWN`, recover the existing Gemini conversation from fresh tab inventory and its URL, then wait or extract. Never create a fresh consultation or click Send again in `SENT` or `UNKNOWN`. If the original conversation cannot be identified uniquely, mark the consultation incomplete instead of risking a duplicate.

Extended thinking can take longer than base Flash. Poll the same conversation with targeted snapshots. Treat these as active-generation signals:

- a visible stop control with a label such as `停止回答`, `停止生成`, `Stop`, or `Stop generating`;
- visible `正在思考`, `正在生成`, `Thinking`, or `Generating` status;
- an incomplete latest Gemini answer while the stop control remains.

Do not refresh, retry, or send “continue” while generation remains active.

## 6. Extract and verify

After generation stops, take a fresh snapshot and identify the latest assistant turn from the main conversation region. Read that turn only; do not treat the user's echoed sentinel as success. Use `scripts/extract_gemini_reply.py` when a saved conversation extract needs deterministic parsing.

Normalize escaped underscores and verify `GEMINI36_FLASH_RESULT_...` appears inside the latest assistant turn. If it is absent, re-read the complete latest assistant turn once. Mark the consultation incomplete when the final answer still lacks the sentinel, appears truncated, or is only a thinking/progress preamble.

Record:

- visible model selection evidence;
- visible extended-thinking evidence;
- Chrome browser path;
- packet sentinel and timestamp;
- uploaded filenames;
- dispatch state and conversation URL when available;
- completion state;
- extracted visible final answer.

Finalize browser tabs after extraction. Keep a tab only when the user needs to continue from it.

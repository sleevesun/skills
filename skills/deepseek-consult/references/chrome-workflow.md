# DeepSeek Chrome Workflow

Use this as the execution path for every DeepSeek consultation. The workflow verifies the route and the individual controls because Expert mode is not a superset of Fast mode in the current web UI.

## Contents

- Connect to Chrome
- Confirm authentication and select a route
- Verify thinking/search controls
- Upload required files
- Insert and verify the context packet
- Send once and recover safely
- Extract and verify

## 1. Connect to Chrome

1. Read the installed `chrome:control-chrome` Skill completely.
2. Discover the `node_repl js` tool when it is not already callable.
3. Initialize the browser runtime from the Chrome plugin's own absolute `scripts/browser-client.mjs` path.
4. Select the Chrome binding with `agent.browsers.get("chrome")` and read its complete documentation before interacting.
5. Reuse an existing DeepSeek tab only when it is listed by `browser.tabs.list()` as an agent-owned tab. Otherwise create a fresh tab and navigate directly to `https://chat.deepseek.com/`.
6. Never use a tab in an `OpenCLI Browser` group or a tab bound to an OpenCLI session. Both tools use Chrome's debugger API.

Do not inspect cookies, local storage, passwords, profiles, or session stores. Browser discovery must remain read-only. Do not use a standalone Playwright connection or a second browser-control server.

Treat a browser-kernel reset as loss of every prior JavaScript binding and unresolved promise. Reinitialize the runtime and reacquire `agent`, `chrome`, `tab`, and fresh locators. Never carry an unresolved file-chooser or browser promise into a later invocation.

## 2. Confirm authentication and select a route

Take a fresh DOM snapshot after navigation. Confirm that a signed-in DeepSeek profile is visible and that the composer has a label such as `给 DeepSeek 发送消息` or `Send message`. Do not send anything while the page is on a sign-in screen.

The current Chinese UI exposes a `radiogroup` with:

- `快速模式`
- `专家模式`
- `识图模式`

Before every click:

1. Build a locator from the latest snapshot.
2. Call `count()` unless uniqueness is self-evident.
3. Click only when exactly one element matches.
4. Take a targeted observation after the UI changes.

Use semantic locators equivalent to:

```js
const fastRadio = tab.playwright.getByRole("radio", { name: /快速模式|Fast mode/i });
const expertRadio = tab.playwright.getByRole("radio", { name: /专家模式|Expert mode/i });
```

Select the route before preparing the packet:

- `FAST_THINK_SEARCH`: click `快速模式` when current facts, web research, or attachments are needed.
- `FAST_THINK`: click `快速模式` when the user explicitly does not want search but does want reasoning or files.
- `EXPERT`: click `专家模式` only for self-contained pure reasoning or when the user explicitly accepts its limitations.

Verify the chosen radio using `aria-checked=true` or the equivalent checked state. Never infer the active mode from nearby helper text alone.

## 3. Verify thinking and search controls

In 快速模式, the current page shows visible labels equivalent to `深度思考` and `智能搜索`. They are custom toggle controls whose selected state is on an ancestor with `aria-pressed=true` and a selected class. A text label by itself is not proof.

Use fresh locators and inspect the control's parent/ancestor state:

```js
const thinkingLabel = tab.playwright.getByText("深度思考", { exact: true });
const searchLabel = tab.playwright.getByText("智能搜索", { exact: true });
if (await thinkingLabel.count() !== 1 || await searchLabel.count() !== 1) {
  throw new Error("Expected one DeepSeek thinking toggle and one search toggle");
}
const thinkingState = await thinkingLabel.evaluate((el) => ({
  ariaPressed: el.parentElement?.getAttribute("aria-pressed"),
  className: el.parentElement?.getAttribute("class"),
}));
```

If a required toggle is not selected, click its unique visible label once, reacquire it, and verify `aria-pressed=true`. The observed Fast-mode default for the current account has both toggles selected.

For `FAST_THINK_SEARCH`, require both controls selected. For `FAST_THINK`, require thinking selected and search explicitly unselected. If a state cannot be read, stop instead of guessing.

In Expert mode, verify the visible limitation text. The current UI states, in Chinese, `擅长复杂问题，资源紧张，不支持搜索和文件上传`. Do not look for or activate search/file controls after this message appears.

## 4. Upload required files

Only Fast mode can receive uploads in the current UI. If attachments are needed, route to `FAST_THINK_SEARCH` or `FAST_THINK` before uploading.

Use the real file chooser and keep promise creation, the menu click, `await`, and `setFiles` inside one `node_repl js` invocation:

```js
const chooserPromise = tab.playwright.waitForEvent("filechooser", { timeoutMs: 15000 });

// Build this locator from a fresh snapshot. The current plus/tool button may
// have no accessible name, so use its stable test id or DOM relation from the snapshot.
const uploadAndToolsButton = /* unique composer tools button from snapshot */;
if (await uploadAndToolsButton.count() !== 1) throw new Error("Expected one DeepSeek composer tools button");
await uploadAndToolsButton.click();

const fileMenuItem = /* unique visible file-upload item from the fresh menu snapshot */;
if (await fileMenuItem.count() !== 1) throw new Error("Expected one DeepSeek file menu item");
await fileMenuItem.click();

const chooser = await chooserPromise;
await chooser.setFiles(["/path/to/file.md"]);
```

Reacquire the composer after uploading and verify every required filename or attachment card. If multiple uploads are unstable, use `scripts/build_attachment_bundle.py` and upload one Markdown bundle. Never upload through OpenCLI and never claim a file was received from a path alone.

## 5. Insert and verify the context packet

Run `scripts/check_packet_safety.py` locally before touching the composer. The current composer is exposed as:

```js
const composer = tab.playwright.getByRole("textbox", {
  name: /给 DeepSeek 发送消息|Send message|Type a message/i,
});
if (await composer.count() !== 1) throw new Error("Expected one DeepSeek composer");
await composer.fill(packet);
```

Reacquire the composer and read its rendered value. DeepSeek currently renders the composer as a `<textarea>`, so `innerText()` can be empty even when the draft is present; prefer `value`/`inputValue()` and use `innerText()` only for contenteditable variants. Require both the packet prefix and the unique `DEEPSEEK_RESULT_...` sentinel. An attachment card, filename, or local path is not composer text.

If the composer is empty or the sentinel is missing, inspect a fresh snapshot once and retry the supported text-entry action only when the first action definitely failed. Never loop through fill, type, and paste. Do not click Send with an empty or unverified packet.

Immediately before Send, verify again:

- the selected radio is the planned route;
- thinking/search toggles match the route, or Expert's limitation was accepted;
- the packet prefix and sentinel are rendered;
- required attachments are visible;
- the send control is unique and enabled.

The current send control is an unnamed element with a stable semantic class pattern such as `ds-button--primary ds-button--filled ds-button--circle`. When the snapshot exposes no accessible name, enumerate the small set of composer-region buttons, inspect their class/role, and click the unique primary filled button. Do not click an arbitrary blank button or rely on a volatile hash suffix.

## 6. Send once and recover safely

Track `dispatch_state` locally:

- `NOT_SENT`: Send has definitely not been clicked.
- `SENT`: the click completed and a fresh observation shows the user turn, an emptied composer, or active generation.
- `UNKNOWN`: the browser resets, disconnects, or times out during or after the click before submission evidence is observed.

Click Send exactly once. Set `SENT` only after observing submission evidence; use `UNKNOWN` for every ambiguous click outcome.

When Chrome resets in `NOT_SENT`, reconnect, re-confirm the route and controls, and rebuild the draft in an existing or fresh DeepSeek tab. When the state is `SENT` or `UNKNOWN`, first recover the existing conversation from fresh tab inventory and its URL. An initially `UNKNOWN` click may be reclassified as `NOT_SENT` only when a fresh snapshot proves all three: the user turn is absent, the composer still contains the complete unchanged draft, and no generation/search state is active. Only then may preparation be retried once. If any submission evidence exists, never create a fresh consultation or click Send again; keep `SENT`/`UNKNOWN`, wait or extract. If the original conversation cannot be identified uniquely, mark the consultation incomplete instead of risking a duplicate.

Treat these as active-generation/search signals:

- visible stop controls such as `停止生成` or `Stop generating`;
- visible `深度思考中`, `正在思考`, `正在搜索`, `搜索中`, `Thinking`, or `Searching`;
- an incomplete latest answer while a stop/search control remains;
- search cards or source retrieval still expanding.

Do not refresh, retry, or send “continue” while generation or search remains active. Search and thinking can increase latency.

## 7. Extract and verify

After generation and search stop, take a fresh snapshot and identify the latest assistant turn from the conversation region. The current UI may show a `已思考（用时…）` summary followed by paragraph blocks rather than a `DeepSeek 说` heading; select the final paragraph block containing the sentinel and exclude the thought summary. Read that turn only; do not treat the user's echoed sentinel as success. Use `scripts/extract_deepseek_reply.py` when a saved transcript or DOM snapshot needs deterministic parsing.

Normalize escaped underscores and verify `DEEPSEEK_RESULT_...` appears inside the latest assistant turn. When the route was `FAST_THINK_SEARCH` and search was requested, also verify visible citations, source cards, or a search/tool completion marker. If either proof is missing, mark the consultation incomplete rather than presenting it as grounded.

Record:

- selected radio and route;
- thinking/search toggle evidence or Expert limitation;
- Chrome browser path;
- packet sentinel and timestamp;
- uploaded filenames;
- dispatch state and conversation URL when available;
- search evidence;
- completion state;
- extracted visible final answer.

Finalize browser tabs after extraction. Keep a tab only when the user needs to continue from it.

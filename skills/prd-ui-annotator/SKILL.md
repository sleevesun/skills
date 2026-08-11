---
name: prd-ui-annotator
description: "PRD 标注技能，用于把需求文档转成页面上的编号标注和可拖拽富提示，并支持增量更新现有 UI 注释。"
---

# PRD UI Annotator

Map PRD requirements onto UI pages as module-level numbered badges and detailed Markdown tooltips. The result must let developers understand the relevant PRD requirements from the page without rereading the original PRD.

## Required Inputs

- A PRD Markdown file, normally named `prd.md`, `PRD.md`, or similar.
- A page implementation to annotate, such as React, Vue, or static HTML.
- A clear user intent:
  - **Workflow A: 初始化标注** for new pages/documents.
  - **Workflow B: 标注内容更新** for existing annotations.

If the user intent is unclear, ask exactly: `请问您是需要执行【Workflow A: 初始化标注】（针对新页面/新文档），还是执行【Workflow B: 标注内容更新】（针对已有标注的增量修改）？`

## Codex Implementation Contract

- Before editing, inspect the project stack, existing annotation code, PRD path, and page files.
- Maintain a machine-readable mapping file named `prd-annotations.json` near the annotated page or in a clear project docs/config folder.
- Use `prd-annotations.json` as the stable source of truth for requirement id, module name, target selector/component, source PRD section, full Markdown content, and status.
- Write the requirement number back into the PRD at the start of the corresponding source requirement using `[N]`.
- Do not place multiple badges on the same component or tightly coupled module.
- Preserve all original PRD details inside the tooltip content. Do not summarize away business rules, preconditions, exceptions, permissions, or edge cases.
- Do not invent requirements. If PRD text or page mapping is ambiguous, ask before annotating.

## Workflow A: 初始化标注

1. **Discover**
   - Locate the PRD file and target page.
   - Identify framework and styling conventions.
   - Check for existing annotation components, tooltip libraries, portals, z-index tokens, or `prd-annotations.json`.

2. **Aggregate Requirements**
   - Parse PRD requirements into UI modules.
   - Merge related requirements into one marker per module.
   - Examples:
     - Row actions: edit/delete/view/permission rules belong in one "操作" marker.
     - Filter area: inputs, selects, query/reset logic belong in one filter marker.
     - Tabs/container: all switching and visibility logic belong in one tabs marker.
   - Assign continuous numeric ids from `1` to `999`.

3. **Create Mapping**
   - Generate or update `prd-annotations.json`.
   - Each item must include:
     - `id`
     - `moduleName`
     - `target`
     - `sourcePrdHeading`
     - `sourcePrdExcerpt`
     - `tooltipMarkdown`
     - `status`
   - Keep full Markdown structure in `tooltipMarkdown`, including bold, italic, nested lists, ordered lists, and blockquotes.

4. **Implement UI Annotation Layer**
   - Prefer a reusable annotation component rather than hardcoding each tooltip.
   - Use absolute positioning or a portal/body mount when the target container uses `overflow: hidden`.
   - Ensure annotations do not change the original layout, dimensions, spacing, or business behavior.
   - Render Markdown deeply inside tooltips.

5. **Write Back to PRD**
   - Insert `[N]` at the start of each mapped requirement's source description.
   - The page badge number and PRD number must match exactly.
   - Do not duplicate numbers if they already exist.

## Workflow B: 标注内容更新

1. Read existing `prd-annotations.json`, current PRD, and annotated page code.
2. Identify added, modified, removed, and unchanged requirement mappings.
3. Apply only affected changes:
   - Added: create a new continuous id, mapping entry, badge target, and PRD number.
   - Modified: update only `tooltipMarkdown` and source excerpt unless the component moved.
   - Removed: remove mapping entry, badge rendering, and stale PRD numbering if safe.
4. **Style Lock**: do not change badge colors, sizes, tooltip background, offsets, z-index, drag behavior, or close behavior unless the user explicitly asks.

## Required Visual & Interaction Specs

Badge:

```css
display: inline-block;
vertical-align: top;
background: rgb(250, 173, 20);
color: #fff;
font-size: 10px;
font-weight: 700;
line-height: 14px;
padding: 0 4px;
border-radius: 2px;
border: 0;
cursor: pointer;
position: absolute;
top: -8px;
right: -4px;
z-index: 9998;
```

Tooltip:

```css
background: #f0efef;
border-radius: 4px;
width: 450px;
z-index: 9999;
line-height: 1.6;
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
```

Interaction:

- Hovering a badge opens its tooltip immediately.
- A tooltip can only be closed by its top-right `X` button.
- The same requirement id can have only one open tooltip.
- Multiple different ids may be open at once.
- Tooltip content and dragging must stop event propagation.
- Tooltip supports free mouse dragging.
- Tooltip defaults to the badge's lower-left with 8px spacing, then flips/repositions to stay inside the viewport.

Tooltip content structure:

- Header: badge-styled requirement id + `需求描述：[模块名称]`
- Divider: thin light-gray line under the header.
- Body: rendered Markdown preserving paragraphs, bold, italic, nested lists, ordered lists, and blockquotes.
- Status colors: when status colors are mentioned, prefix text with a matching colored dot.

## Self-Check Before Final Response

- Confirm whether Workflow A or Workflow B was executed.
- Confirm each module/component has at most one badge.
- Confirm tooltip content can replace reading the original PRD for the mapped module.
- Confirm hover, drag, close-by-X, event isolation, and viewport avoidance are implemented.
- Confirm visual parameters match the required specs and style lock was preserved during updates.
- Confirm `prd-annotations.json` exists and PRD numbering matches page badges.
- Run available checks or a targeted build/test when feasible.

## Final Response

Report:

- Workflow executed.
- PRD file updated.
- Mapping file path.
- Page/component files changed.
- Validation performed.
- Any ambiguous requirements left unmapped.

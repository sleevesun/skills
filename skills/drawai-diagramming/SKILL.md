---
name: drawai-diagramming
description: "Use this skill whenever the user wants to create, refactor, restyle, compare, validate, or export draw.io / DrawAI diagrams. Trigger for requests mentioning drawio, draw.io, DrawAI, 架构图, 流程图, 状态流转图, 角色职责图, 页面逻辑图, or defects such as misaligned text, overflowing labels, overlapping connector segments, angled arrow entry, awkward connectors, or overlapping shapes. Use it for converting dense product requirements into polished multi-page diagrams and for matching a user-edited diagram's structure without copying its business content."
---

# DrawAI / draw.io Diagramming

Use this skill to turn product, workflow, or architecture content into clear draw.io diagrams through the `mcp__drawio` MCP. The goal is not merely to generate boxes and arrows; the goal is to produce diagrams that feel like they belong in a product or architecture document: grouped, scannable, semantically colored, and easy for the user to edit later.

This skill defines **diagramming method, layout grammar, visual style, composition, and quality rules**. It must not hard-code the business actors, page names, modules, systems, or process steps. Those must be derived from the user's actual business materials.

## Core Principles

1. Separate **content decisions** from **visual decisions**.
   - Content decisions include which roles, systems, pages, states, events, modules, data objects, and exceptions appear.
   - Visual decisions include page sizing, grouping, spacing, colors, line routing, labels, legends, and editability.
   - This skill may prescribe visual decisions, but content decisions must come from the current PRD, demo, code, source document, or user instructions.

2. Separate **content independence** from **style reference**.
   - When the user provides a reference `.drawio`, borrow its layout grammar, visual hierarchy, grouping style, page structure, color system, and edge routing.
   - Do not reuse its business entities, labels, roles, module names, or domain assumptions unless the user explicitly asks.

3. Prefer **document diagrams** over canvas sketches.
   - Use stable page sizes, clean alignment, and predictable node dimensions.
   - Keep diagrams readable when exported as `.drawio`, `.png`, or pasted into a PRD.

4. Make diagrams easy to edit manually.
   - Group related lanes, modules, page areas, or architecture blocks with `style="group"` when the user is likely to move the whole section later.
   - Use consistent IDs and human-readable page names.
   - Avoid decorative complexity that makes manual editing painful.

5. Preserve the user's latest intent.
   - If the user says a previous diagram was too rigid, stop reusing that business structure as a template.
   - If the user has hand-edited a generated diagram, treat the edited file as the strongest signal for layout, grouping, spacing, and routing preferences.

6. Keep one editable source of truth.
   - Treat the `.drawio` file as the only editable diagram source.
   - Export SVG and PNG from that source; do not maintain a separately hand-authored SVG with different geometry.
   - Regenerate exports after every geometry, text, or routing change.

## Standard Workflow

### 1. Inspect Inputs

Before drawing, inspect the available business materials:

- PRD, product方案,需求池,流程设计,字段口径,集成方案,验收标准。
- Current demo code, screen annotations, screenshots, or browser state when relevant.
- Existing `.drawio` files if the user asks to modify or learn from them.

Extract content from the materials:

- Real actors and responsibility areas.
- Actual systems and external dependencies.
- Actual pages, modules, states, events, and decisions.
- Actual data objects and integration points.
- Actual exceptions, rollback paths, and retry paths.

Do not invent fixed actors such as HRBP,审批人,系统,外部系统 unless they exist in the current business. Do not invent fixed architecture layers such as frontend/service/data unless the current system actually benefits from that view.

If the user provides `.drawio` files, inspect them before drawing:

- Page count and page names.
- Page sizes and whether `page="0"` or `page="1"` is used.
- Top-level node count, edge count, and whether groups are used.
- Repeated shape styles: `fillColor`, `strokeColor`, `fontSize`, `rounded`, `rhombus`, `dashed`.
- Layout patterns: horizontal lanes, vertical columns, stacked modules, bottom data layer, side external systems.
- Edge routing: orthogonal edges, labels, dashed rollback/optional paths, explicit waypoints.

When comparing the user's edited version with a previous version, report differences in this structure:

```markdown
## 差异总结

### 结构层
- ...

### 布局层
- ...

### 连线层
- ...

### 视觉层
- ...

### 可复用规则
- ...
```

### 2. Decide Diagram Pages From Business Questions

Choose pages based on what the current business needs to explain. Page types below are **options**, not defaults:

- `业务流程图`: Use when the PRD needs to explain cross-role or cross-system workflow.
- `审批流程图`: Use when approval routing, return, and current-node responsibility are central.
- `状态流转图`: Use when lifecycle status, retry, rollback, or terminal states matter.
- `系统架构图`: Use when engineering boundaries, services, integrations, and data dependencies matter.
- `数据流图`: Use when the reader needs to understand data creation, transformation, writes, and sync.
- `页面关系图`: Use when product navigation and page-level capabilities matter.
- `角色权限图`: Use when visibility, operation rights, or data masking matter.
- `异常处理图`: Use when failure handling, compensation, or retry logic is complex.

Rules:

- Do not always default to two pages.
- Do not force page names like `业务流程图` and `系统架构图` if the material needs something else.
- Use as few pages as can explain the requirement clearly, and add pages only when they remove real ambiguity.
- Name pages after the actual question they answer.

### 2.1 Mandatory Swimlane Rules For Process Diagrams

When drawing any `流程图`, `业务流程图`, `审批流程图`, or other process-style diagram, use a swimlane structure by default unless the user explicitly requests another form.

Swimlane structure must make three dimensions visible:

- Role / responsibility: derive lanes from real actors, departments, systems, or responsibility owners in the source material.
- Stage / phase: derive phase headers from the actual process lifecycle, such as initiation, review, execution, settlement, sync, archive, exception handling, or other business-specific phases.
- Online vs offline: clearly distinguish system/online steps from manual/offline steps.

Layout requirements:

- Prefer horizontal role lanes with vertical stage columns for cross-role workflows; use vertical role lanes with horizontal stage bands only when the source material or reference diagram clearly fits that better.
- Put role names in lane headers and stage names in phase headers. Do not hide either dimension in tiny labels.
- Keep online system steps as normal white or role-colored nodes; mark offline/manual/non-system steps with grey fill or a visible `线下` tag.
- Mark online steps with an `线上` tag or place them under an online-specific system lane when the distinction may otherwise be unclear.
- If the process mixes online and offline handoffs, include a small legend explaining `线上`, `线下`, `外部`, and `退回/异常` styles.
- Use groups for each role lane and, when practical, each stage column so the user can move roles or phases cleanly in draw.io.
- Do not collapse roles into generic `系统` or `业务方` lanes when the source material names specific owners.
- Do not collapse stages into one long sequence when the business has clear lifecycle phases.

### 3. Compose Diagrams From Actual Business Structure

#### Business/process diagrams

Use this visual grammar:

- Page size: usually `pageWidth="900"` and `pageHeight="650"` for PRD diagrams; expand only when content density requires it.
- Choose lanes or columns from actual actors, systems, responsibility areas, lifecycle phases, or page modules.
- For process diagrams, default to swimlanes that show both role/responsibility lanes and stage/phase columns.
- Use colored lane headers and white action nodes.
- Use grey nodes for offline, external, manual, or non-system steps, and label them as `线下` when online/offline distinction matters.
- Use visible `线上` / `线下` tags, a legend, or separate online/system lanes so readers can immediately tell which work happens in-system and which work happens outside the system.
- Use a diamond (`rhombus`) only for real decisions, not ordinary process steps.
- Use a small legend when online/offline/external/rollback semantics matter.
- Keep a readable vertical rhythm: first actions near the top, decisions in the middle, outcomes or exceptions lower down.
- If a lane or phase belongs together, wrap it in a group so manual edits move cleanly.

Do not hard-code the number of lanes, actor names, node order, or decision points. For example, a finance process may use `申请人/预算负责人/财务系统/银行`; an HR process may use `HRBP/审批人/Payroll/考勤`; a consumer product may use `用户/客户端/推荐服务/支付平台`. The source material decides.

#### Architecture diagrams

Use this visual grammar:

- Page size: usually `pageWidth="900"` and `pageHeight="650"`; use larger sizes for dense enterprise architecture.
- Use broad containers with `verticalAlign=top`.
- Containers should reflect actual system boundaries, ownership, or runtime layers.
- Put child capabilities inside each container as white rounded rectangles.
- Place data/rules near the bottom when they are shared foundations.
- Place external systems at the side when they are dependencies rather than owned capabilities.
- Keep architecture diagrams spacious enough to explain dependencies, not narrate every click.

Suggested semantic layer colors can be reused, but layer names and count must adapt to the business:

- Blue for user-facing surfaces, portals, apps, or actor-facing pages.
- Green for owned business services or core domain capabilities.
- Orange for automation, calculation, orchestration, scheduled jobs, or integration workers.
- Purple for data, rules, configuration, policy, or master data.
- Grey for external systems, third-party services, offline work, or out-of-scope dependencies.

Do not force fixed containers such as `用户与前台`, `业务服务`, `自动化与触达`, `外部系统`, or `数据与规则`. Use them only when they match the actual system.

#### State diagrams

- States must come from the actual PRD or code.
- Use color to distinguish normal, pending, success, failure, rejected, and terminal states.
- Label transitions with real triggering events.
- Keep retry and rollback paths visually distinct, usually dashed red/orange.
- Do not add generic states unless they are required by the business.

#### Role/permission diagrams

- Roles must come from the actual permission model.
- Show what each role can operate and what sensitive data it can see.
- Prefer matrix/table-like layouts for permission clarity.
- Highlight data masking or restricted visibility when it is a key requirement.

### 4. Mandatory Geometry and Text Contract

Apply these rules to every diagram unless the user supplies a stronger reference rule.

#### Alignment and padding

- Give every text-bearing vertex an explicit horizontal and vertical alignment. Never rely on draw.io defaults.
- Center ordinary nodes with:

```text
align=center;verticalAlign=middle;whiteSpace=wrap;html=1;
spacingLeft=10;spacingRight=10;spacingTop=6;spacingBottom=6;
```

- Give section titles and lane headers an explicit alignment appropriate to their role. A top-aligned container label must still declare `align` and `verticalAlign`.
- Keep node text at least 10 px from left and right borders and 6 px from top and bottom borders.

#### Line breaking and node sizing

- Insert explicit `&#xa;` or `<br>` line breaks for Chinese labels. Do not depend on automatic wrapping to rescue an undersized node.
- Use these default text budgets:
  - Process or state node: at most 12 Chinese characters per line and at most 2 lines.
  - Decision node: at most 8 Chinese characters per line and at most 2 lines.
  - Note or rule node: at most 18 Chinese characters per line and at most 3 lines.
- Shorten or split content when it exceeds the budget; do not reduce body text below 11 px.
- Size each node from the final line count. For 12 px text, use at least `lineCount × 18 + 20` px height.
- Keep title, subtitle, edge-label, and legend text fully inside their allocated rectangles at 100% export scale.

#### Spacing and collision clearance

- Use the grid and keep sibling nodes at least 24 px apart.
- Keep at least 24 px inner padding between every side of a container boundary and its child nodes.
- In the same container, keep the outer inset of repeated child nodes consistent on the left, right, top, and bottom; matching insets should differ by no more than 2 px.
- Never let a child node hug one side of its parent. Check the right and bottom clearances explicitly, because those gaps are easiest to lose when resizing a container.
- Reserve at least 20 px routing gutters between lanes, stage columns, and node rows.
- Do not allow sibling node rectangles, text bounds, edge labels, or legends to overlap.
- Do not allow child nodes to extend beyond their parent group or container.
- If a page cannot satisfy these clearances, enlarge the page or split the content; never compress everything into a smaller font.

### 5. Color and Style Palette

Use restrained semantic colors:

```text
Blue:   #EAF3FF / #4C84C4  user-facing surfaces, participant-facing pages
Green:  #EAF7EA / #58A65C  owned services, normal success, business capability
Purple: #F3EEFF / #8061C6  data, rules, configuration, policy, HR/control roles
Orange: #FFF1E8 / #D97835  automation, calculation, integration, key change
Yellow: #FFF4D6 / #C99200  decision, warning, pending, attention
Grey:   #F7F7F7 or #EFEFEF / #777777  external, offline, out-of-scope, manual
White:  #FFFFFF             normal process node or child capability
Red:    #C74B4B             rejection, failure, rollback, blocking error
```

Default node styles:

```text
Section header / container:
rounded=1;arcSize=8;whiteSpace=wrap;html=1;fontSize=14;fontStyle=1

Normal process node:
rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FFFFFF;fontSize=12;align=center;verticalAlign=middle;spacingLeft=10;spacingRight=10;spacingTop=6;spacingBottom=6

Decision node:
rhombus;whiteSpace=wrap;html=1;fillColor=#FFF4D6;strokeColor=#C99200;fontSize=12;fontStyle=1;align=center;verticalAlign=middle;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6

Offline/external node:
rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#EFEFEF;strokeColor=#777777;fontSize=12;align=center;verticalAlign=middle;spacingLeft=10;spacingRight=10;spacingTop=6;spacingBottom=6

Orthogonal edge:
endArrow=classic;html=1;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;rounded=0;fontSize=11

Rollback / failure / optional edge:
endArrow=classic;html=1;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;rounded=0;dashed=1;fontSize=11
```

#### Corner radius

- Keep rectangle corner radii restrained. For rounded draw.io rectangles, use `arcSize=8` by default and never exceed `arcSize=10`.
- Apply the same `arcSize` to peer nodes and repeated cards; do not mix visibly different corner radii within one semantic group.
- Large containers should still use a subtle radius. Do not increase `arcSize` merely because the shape is larger.

### 6. Edge Routing Rules

Good edge routing is often what separates a usable diagram from an AI sketch.

- Use orthogonal edges by default.
- Give every edge explicit source and target ports with `exitX`, `exitY`, `entryX`, and `entryY`.
- Add labels to edges when they clarify state transitions: `提交`, `退回`, `通过`, `审批通过`, `写入失败`, `重试成功`.
- Use dashed red edges for rollback, rejection, or failure.
- Use dashed grey edges for optional, external, or downstream dependencies.
- Add explicit waypoints for every non-straight route, including cross-lane, cross-column, rollback, branch, merge, and long-distance edges.
- Route edges through the reserved gutters, never through a node, node label, lane header, or legend.
- Keep the main path to three bends or fewer whenever possible.
- Choose the shortest clear orthogonal route that preserves separation and reading order. Do not send a connector around a distant side of the diagram solely to avoid another connector.
- A connector's total orthogonal length should ordinarily stay within 1.5 times the direct Manhattan distance between its source and target ports. If it exceeds that ratio, first adjust ports, routing gutters, or nearby node placement.
- Avoid tiny visual stubs: each routed segment should normally be at least 20 px. Avoid unnecessarily long approach segments as well; keep the first and final approach segments between 20 and 60 px when the layout allows.
- Assign a separate routing channel to every connector. Distinct connectors must not share any collinear segment; touching at one endpoint is allowed, sharing a route is not.
- Separate parallel edge segments by at least 12 px instead of stacking them on one path.
- When several connectors enter the same node, give them different target ports such as `entryX=0.25`, `0.5`, and `0.75`; do not merge them into one final segment.
- Do not reuse the same node port for an incoming connector and an outgoing connector when their first or last segments would overlap.
- Put edge labels on clear horizontal or vertical segments and keep at least 8 px clearance from node borders.
- Prefer edge directions that match the chosen layout:
  - left-to-right for main handoff.
  - top-to-bottom for sequence within a lane/module.
  - bottom data layer connections should drop down cleanly.
- Make every arrow meet the target boundary at 90 degrees. The final segment and port must follow this contract:

| Target side | Port | Required final approach |
| --- | --- | --- |
| Top | `entryY=0` | Vertical, moving downward into the node |
| Bottom | `entryY=1` | Vertical, moving upward into the node |
| Left | `entryX=0` | Horizontal, moving rightward into the node |
| Right | `entryX=1` | Horizontal, moving leftward into the node |

- Keep the final approach segment at least 20 px long so the arrowhead is visibly perpendicular to the target.
- Never place the last waypoint on the target border. The last waypoint must remain outside the target, leaving the final perpendicular segment for the arrowhead.

### 7. Draw.io MCP Usage

Use `mcp__drawio` tools when available.

Recommended flow:

1. Call `start_session` when creating or live-editing a diagram.
2. Use `create_new_diagram` with a complete `<mxfile>` when building a fresh multi-page diagram.
3. Use `get_diagram` before `edit_diagram` when modifying an existing session; this avoids losing manual user edits.
4. Use `add_page` instead of `create_new_diagram` when the user wants another page without replacing existing pages.
5. Export the final diagram with `export_diagram` to a stable project path.

Do not call `create_new_diagram` on an existing user-edited session unless the user clearly wants to replace the whole document.

If the draw.io MCP or desktop CLI is unavailable and the diagram uses basic uncompressed mxGraph shapes, use `scripts/export_basic_drawio_svg.py` to create a deterministic SVG preview from the `.drawio` source. Treat this as a fallback, verify the preview visually, and do not hand-edit the exported SVG.

### 8. Mandatory Quality Gate

Do not finalize a diagram after XML creation alone.

1. Run the structural validator:

```bash
python3 scripts/validate_drawio_layout.py path/to/file.drawio
```

2. Export every page to SVG or PNG from the `.drawio` source.
3. Inspect every exported page at 100% scale and verify:
   - all text is centered or intentionally aligned;
   - no text is clipped or outside its container;
   - no connector crosses a node or its text;
   - no two connectors overlap or share a collinear route segment;
   - every arrowhead enters the target boundary at 90 degrees;
   - connector bends are simple and directional, without avoidable detours or tiny stubs;
   - no nodes, labels, legends, or containers collide;
   - rounded rectangles use a consistent `arcSize` no greater than 10;
   - child nodes keep consistent inner clearance from every side of their container;
   - the main reading order is obvious without tracing tiny labels.
4. Correct the `.drawio` source, regenerate every export, and repeat the validator and visual inspection until all pages pass.

Before delivery, also confirm:

- Page names answer real questions from the current business.
- Every page has a clear title.
- The chosen pages, roles, modules, systems, and states are derived from the source materials.
- Main flow can be read without following tiny labels.
- Color encodes responsibility, layer, state, or exception semantics, not decoration.
- Offline, external, rollback, and automation semantics are visually distinct.
- Groups are used for columns/modules that the user may move later.
- Lines do not overlap one another or cross nodes, labels, or legends.
- Connectors use the shortest clear route; no connector is made conspicuously long merely to avoid overlap.
- Multiple incoming edges use distinct ports and independent final approach segments.
- Arrowheads are perpendicular to the side of the target shape they enter.
- Rounded rectangles use subtle, consistent corner radii with `arcSize <= 10`.
- Repeated child nodes keep consistent padding from all sides of their parent container.
- The exported `.drawio` file exists and has the expected page count.
- SVG and PNG exports were regenerated from that exact `.drawio` state.
- If a reference diagram was used, the final answer states that only form/style was borrowed, not business content.

## Example Response Shape

When done, summarize concisely:

```markdown
已完成 draw.io 图示重构。

- 输出文件：...
- 页面：...
- 内容来源：基于当前 PRD / Demo / 业务材料抽取角色、流程、状态和系统模块。
- 表达方式：沿用分组、语义色、正交连线、异常路径和可编辑节点等图示规范；未套用固定业务结构。
- 验证：文件已导出，页数为 N。
```

---
name: excalidraw-diagramming
description: "Create, edit, restyle, validate, and export editable Excalidraw diagrams. Requires the diagram-design Codex plugin to be loaded in the current task. Use for .excalidraw files, converting Mermaid or text flows to Excalidraw, product and business flowcharts, architecture diagrams, decision trees, state diagrams, and requests about Excalidraw colors, shapes, connectors, spacing, visual consistency, or export quality."
---

# Excalidraw Diagramming

Create diagrams that are readable in product documents, easy to edit, and visually consistent. Treat color, shape, position, and line style as semantic information rather than decoration.

## Required Dependency: Diagram Design

Before inspecting inputs or creating, editing, restyling, or exporting a diagram:

1. Inspect the active skill catalog for `diagram-design`, including the namespaced entry `diagram-design:diagram-design`.
2. If the skill is not present in the active catalog or its `SKILL.md` cannot be read, stop before changing or producing a diagram. Tell the user that this skill requires Diagram Design. If the plugin is not installed and enabled, provide the installation commands below. If it is already installed and enabled, tell the user to start a new Codex task instead of reinstalling it:

```bash
codex plugin marketplace add cathrynlavery/diagram-design
codex plugin add diagram-design@diagram-design
```

After installation, tell the user to start a new Codex task. Do not bypass this check by reading a versioned plugin cache path. A plugin installed on disk but absent from the current task's skill catalog is not loaded for that task.

3. Read Diagram Design's `SKILL.md` completely. Follow its routing instructions to load `style-guide.md`, the selected `type-*.md`, and only the semantic, primitive, import, or animation references triggered by the task.
4. Use Diagram Design as the primary source for diagram-type selection, semantic-pattern selection, content deletion, complexity budgets, brand tokens, visual hierarchy, focal emphasis, layout grammar, and universal anti-patterns.
5. Keep this skill authoritative for Excalidraw JSON structure, native element capabilities, hand-drawn rendering constraints, editability, `.excalidraw` source-of-truth requirements, export behavior, and Excalidraw-specific validation.
6. Resolve conflicts in this order: explicit user requirements; Excalidraw format, editability, readability, and validation constraints; representable Diagram Design rules; the existing default rules in this skill.
7. Preserve `.excalidraw` as the editable deliverable. Do not switch to standalone HTML or SVG merely because Diagram Design is installed.

When Diagram Design is loaded but has no applicable rule for an Excalidraw-specific detail, use the native rules below for that detail. Never claim Diagram Design was applied unless it was loaded and read in the current task.

## Standard workflow

1. Read the PRD, source text, existing diagram, or user-edited file.
2. Identify the single question the diagram must answer.
3. Choose the smallest diagram type that answers it: flow, decision tree, state flow, architecture, data flow, or relationship diagram.
4. Lay out the main path before adding branches, notes, and exceptions.
5. Create the editable `.excalidraw` source.
6. Export an SVG with the same base name; add PNG only when requested or needed for preview compatibility.
7. Validate the files and inspect the export at 100% scale.

Do not invent business roles, states, systems, or exceptions that are absent from the source material.

## Semantic color standard

Use the palette below consistently. The same meaning must use the same color within and across diagrams.

| Meaning | Fill | Stroke | Use |
| --- | --- | --- | --- |
| Input / business request / system entry | `#E7F5FF` | `#1971C2` | Process start, request, source event, external input |
| Configuration / rule / policy | `#F3F0FF` | `#7048E8` | Configuration, control rule, policy data, baseline selection |
| Decision / condition | `#FFF9DB` | `#F08C00` | Real yes/no or multi-branch decisions only |
| Success / pass / completed system action | `#EBFBEE` | `#2B8A3E` | Successful outcome, normal continuation, completed notification |
| Manual action / pending attention | `#FFF4E6` | `#E67700` | Administrator action, manual handling, pending follow-up |
| Block / failure / exception | `#FFF5F5` | `#C92A2A` | Rejection, blocking result, failure, rollback |
| Neutral / unchanged / no action | `#F8F9FA` | `#868E96` | Existing logic, no-op result, end state, neutral dependency |
| Note / boundary / explanation | `#F8F9FA` | `#ADB5BD` | Non-flow note with dashed outline |
| Ordinary process action | `#FFFFFF` | `#495057` | Action that does not need additional semantic emphasis |

Rules:

- Use no more than four semantic colors on a normal page, excluding grey and white.
- Do not assign different colors merely to make peer nodes look varied.
- Never rely on color alone. Pair it with a clear label, shape, or line style.
- Keep text dark and neutral; do not color body text to match the border.
- Use red only for genuine blocking or failure states.
- Use orange for human action or attention, not as a second failure color.
- Add a compact legend when a diagram uses three or more semantic colors and may be read outside its source document.

## Base visual style

- Use a white canvas, solid fills, 100% opacity, and Excalidraw's default light hand-drawn texture unless the source document has a stronger visual standard.
- Use 2 px strokes for ordinary nodes and connectors; use 1 px strokes only for large containers or secondary notes.
- Keep process-node corner radius visually at 10 px or less. Avoid pill-like rectangles unless the shape represents a start or terminal state.
- Use the standard arrowhead for directed flow. Use a line without an arrowhead only for static association, grouping, or annotation.
- Use a bidirectional arrow only for a genuine two-way exchange, and label what is exchanged.
- Avoid decorative shadows, gradients, emoji, and mixed icon styles unless they carry information required by the diagram.

## Shape grammar

| Shape | Meaning |
| --- | --- |
| Rounded rectangle | Process action, system action, configuration, state, or result |
| Diamond | A real decision with two or more outcomes |
| Pill or ellipse | Start or terminal state only when it improves recognition |
| Dashed rectangle | Note, scope boundary, assumption, or explanation outside the execution path |
| Large light container | System, role, stage, or responsibility grouping |
| Cylinder | Persistent data store only |

Rules:

- Use rounded process rectangles with a visual radius of 10 px or less. When editing raw Excalidraw JSON, use the available roundness setting that produces this result and verify it in the export.
- Do not use a diamond for an ordinary action.
- Do not place an execution arrow through a note box.
- Keep peer nodes the same size when they serve the same role.
- Give child nodes consistent padding from every side of a container; target at least 24 px and keep matching margins within 2 px.

## Layout standard

- Prefer left-to-right for handoffs and top-to-bottom for chronological sequences.
- Keep the main path visually dominant and near the center.
- Place secondary or exception branches below the main path unless the source material requires otherwise.
- Align node centers to a 10 px grid.
- Keep 40–80 px between neighboring nodes and at least 24 px internal padding.
- Keep the page compact. Remove large empty regions before export.
- If a flow becomes too wide or tall to read in a PRD, split it by business question instead of shrinking the text.
- Use containers or frames only when they clarify ownership, stage, system, or scope.

## Connector standard

- Use solid arrows for normal execution.
- Use dashed red arrows for rollback or failure.
- Use dashed grey arrows for optional, external, or informational dependencies.
- Connect arrows to the nearest logical side of a node and make the final approach perpendicular to that side.
- Route each connector independently. Do not overlap collinear segments or reuse one route as a shared cable.
- Use the shortest clear route that preserves reading order; do not create long detours merely to avoid another line.
- Keep the main path to three bends or fewer.
- Avoid tiny stubs. Keep visible segments at least 20 px when space allows.
- Separate parallel segments by at least 12 px.
- Keep arrows out of nodes, text, labels, titles, legends, and note boxes.
- Put `是 / 否` or transition labels close to the relevant decision branch, not midway across the page.
- Prefer the positive or normal branch to continue rightward or downward; place rejection or exception branches below.

When connectors conflict, resolve them in this order:

1. Move the source or target port.
2. Reorder neighboring nodes.
3. Increase the routing gutter.
4. Add one short orthogonal bend.
5. Split the diagram if the structure remains tangled.

## Text standard

- Use one font family consistently. Prefer Excalidraw's default hand-drawn font (`fontFamily = 1`) unless a stronger reference exists.
- Recommended sizes: title 28, subtitle 16, node 18, edge label 16.
- Do not use essential text below 16 px in a diagram intended for a PRD.
- Keep process nodes to two lines when possible and rule nodes to three lines.
- Insert explicit line breaks. Do not rely on automatic wrapping.
- Keep approximately 12 Chinese characters or fewer per line for ordinary nodes.
- Center action and decision text. Left-align longer notes when that improves scanning.
- Keep at least 20 px between text and the node border.
- Shorten the wording or enlarge the node when text does not fit; never solve clipping by shrinking the font excessively.

## Flow expression rules

### Process flow

- Start with the triggering event.
- Show only meaningful actions and decisions.
- End with explicit success, block, no-action, or handoff outcomes.
- If the process continues under existing rules, label the node as “沿用现有规则” instead of redrawing unrelated detail.

### Decision tree

- Phrase the diamond as a question.
- Label every outgoing branch.
- Make branch outcomes mutually exclusive and collectively understandable.
- Avoid chaining multiple diamonds when one decision can be expressed clearly.

### Architecture or responsibility view

- Group by actual system, responsibility, or runtime boundary.
- Use color for semantic layers, not for every component.
- Put shared configuration or data foundations near the bottom and external dependencies at the side.

### Notes and boundaries

- Keep notes outside the execution path.
- Use a dashed grey border and neutral fill.
- Notes must explain an exception, scope boundary, or key rule; do not repeat nearby node text.

## Editable source and export contract

- Treat `.excalidraw` as the editable source of truth.
- Keep source and export together in an `assets/` directory.
- Use matching names, for example `冻结基线校验流程.excalidraw` and `冻结基线校验流程.svg`.
- Regenerate the SVG after changing text, geometry, colors, or connectors.
- Do not maintain an independently edited SVG that can drift from the Excalidraw source.
- Link the SVG in Markdown and provide a nearby link to the editable `.excalidraw` source.
- Preserve human-readable element IDs where practical.

## Quality gate

Before delivery:

1. Validate the source JSON:

```bash
jq empty path/to/diagram.excalidraw
```

2. Validate the SVG:

```bash
xmllint --noout path/to/diagram.svg
```

3. Inspect the export and confirm:

- all text is visible and intentionally aligned;
- no text touches or crosses a border;
- peer nodes use consistent dimensions and padding;
- colors match the semantic palette;
- diamonds contain decisions only;
- every branch is labeled where needed;
- connectors do not overlap, cross nodes, or take avoidable detours;
- arrowheads enter target shapes cleanly;
- notes are visually separate from the execution path;
- the reading order is obvious without explanation;
- the diagram remains readable when embedded at normal PRD width;
- source and export contain the same content.

4. Check Markdown links and whitespace before delivery.

Do not finalize after JSON or SVG validation alone. Visual inspection is mandatory.

---
name: visual-qa-workflow
title: Visual QA & Iterative Polish Workflow
description: Step-by-step verification loop using get_screenshot, check_ui_states, and targeted node edits to catch and fix layout, clipping, alignment, and state issues.
tags: [qa, screenshot, review, states, verification]
---

# Visual QA & Iterative Polish Workflow

Never consider a design edit complete until you visually inspect the rendered result via `get_screenshot`.

## Step 1: Discover Screens
Call `list_frames` to get the exact `id`, `name`, and dimensions of every top-level screen in the open document.

## Step 2: Capture High-Resolution Screenshots
For each screen you created or modified, call:
```json
{ "name": "get_screenshot", "arguments": { "nodeId": "<screen-id>", "scale": 2 } }
```
- Use `scale: 2` for crisp text and icon inspection.
- If inspecting a specific component (e.g. a card or navbar), pass that component's `nodeId` directly.

## Step 3: Visual Defect Checklist
Inspect the screenshot carefully for:
1. **Text clipping / overflow:** Does any text spill outside its button, chip, or card? → Fix by setting `textGrowth: "fixed-width"` and `width: "fill_container"`, or widening the container.
2. **Overlapping siblings:** Are elements stacked on top of each other? → Check `layout` (`vertical` vs `horizontal` vs `none`) and `gap`.
3. **Misaligned icons:** Are icons centered inside circular/pill buttons? → Ensure parent button has `layout: "horizontal"`, `justifyContent: "center"`, `alignItems: "center"`.
4. **Floating badges / overlays:** Are discount pills or heart buttons pushing product images aside? → Parent container must use `layout: "none"` or the overlay badge must have `layoutPosition: "absolute"`.
5. **Contrast & readability:** Is muted text readable on its surface in both Light and Dark themes?
6. **Consistent spacing:** Are paddings and gaps symmetric and aligned to the 8px grid?

## Step 4: Check Five UI States Coverage
Call `check_ui_states` to see which screens are missing `Empty`, `Loading`, `Error`, or `Partial` states.
If needed, call `suggest_missing_states({ screenName })` to generate templates and insert them with `add_node`.

## Step 5: Fix & Re-Verify
Apply targeted fixes via `update_node` / `add_node` / `delete_node`, then call `get_screenshot` again to confirm every defect is resolved.


---
name: design-to-code-handoff
title: Design-to-Code Handoff Workflow
description: How to inspect an open .pen document via OpenPenViewer MCP and translate tokens, Auto Layout frames, components, and typography into clean production code (React/Tailwind, Jetpack Compose, Flutter).
tags: [handoff, codegen, react, tailwind, compose, tokens]
---

# Design-to-Code Handoff Workflow

Use this skill when turning a `.pen` design open in OpenPenViewer into production UI code.

## 1. Gather Design Context via MCP
1. Call `list_frames` to inventory all screens and their IDs.
2. Call `get_document` (or `read_node` on the target screen ID) to inspect the exact node tree, spacing, typography, and `variables`.
3. Call `get_screenshot({ nodeId, scale: 2 })` so you have the visual ground truth alongside the JSON tree.
4. Optionally call `export_design_doc({ projectName, locale: "en" })` for a structured component and token summary.

## 2. Translate Design Tokens First
Before writing component markup, map `doc.variables` into your target token layer:
- **Web / Tailwind / CSS:** CSS custom properties in `:root` (and `[data-theme="dark"]` if `themes` has Light/Dark).
- **Android Jetpack Compose:** `MaterialTheme.colorScheme` (`primary`, `surface`, `surfaceContainer`, `onSurface`, `outline`).

## 3. Exact Layout Mapping

| `.pen` Property | CSS / Tailwind | Jetpack Compose |
| :--- | :--- | :--- |
| `layout: "vertical"` | `flex flex-col` | `Column` |
| `layout: "horizontal"` | `flex flex-row` | `Row` |
| `layout: "none"` | `relative` (children `absolute`) | `Box` |
| `gap: 12` | `gap-3` (`12px`) | `Arrangement.spacedBy(12.dp)` |
| `padding: [12, 16]` | `py-3 px-4` | `Modifier.padding(vertical = 12.dp, horizontal = 16.dp)` |
| `width: "fill_container"` | `w-full flex-1` | `Modifier.fillMaxWidth()` / `weight(1f)` |
| `justifyContent: "space_between"` | `justify-between` | `Arrangement.SpaceBetween` |
| `justifyContent: "space_around"` | `justify-evenly` | `Arrangement.SpaceEvenly` |
| `alignItems: "center"` | `items-center` | `Alignment.CenterVertically` / `CenterHorizontally` |
| `cornerRadius: 16` | `rounded-2xl` | `RoundedCornerShape(16.dp)` |

## 4. Component Extraction & Verification
- Look for `reusable: true` frames and `ref` instances — extract them into clean reusable components (e.g., `ProductCard`, `SearchBar`, `BottomNavBar`) rather than duplicating markup.
- Compare your rendered app side-by-side against `get_screenshot` to verify typography weights, padding, border radii, and icon alignment.


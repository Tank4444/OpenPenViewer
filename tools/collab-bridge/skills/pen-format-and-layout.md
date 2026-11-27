---
name: pen-format-and-layout
title: .pen Format, Auto Layout & Design Tokens
description: Complete specification of the OpenPenViewer .pen JSON schema, Auto Layout (flex) rules, $variable tokens, icon_font usage, and common layout pitfalls.
tags: [pen, format, layout, flex, variables, icons]
---

# .pen Format, Auto Layout & Design Tokens

Use this skill whenever you read, create, or edit `.pen` nodes via OpenPenViewer MCP (`add_node`, `update_node`, `delete_node`, `set_variable`).

## 1. Supported Node Types

| `type` | Purpose | Key Properties |
| :--- | :--- | :--- |
| `frame` | Container / screen / card / button | `width`, `height`, `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, `fill`, `stroke`, `cornerRadius`, `clip`, `children`, `reusable` |
| `text` | Text layer | `content`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, `textGrowth`, `fill` |
| `rectangle` | Simple shape / divider / backdrop | `width`, `height`, `fill`, `stroke`, `cornerRadius`, `effect` |
| `ellipse` | Circle / avatar / badge dot | `width`, `height`, `fill`, `stroke` |
| `icon_font` | Vector icon | `iconFontFamily` (`"lucide"` or `"Material Symbols Rounded"`), `iconFontName`, `width`, `height`, `fill` |
| `path` | Custom SVG vector path | `geometry` (SVG `d` path), `width`, `height`, `fill`, `stroke` |
| `image` | Raster image | `url`, `width`, `height`, `cornerRadius` |
| `line` | Hairline / divider | `width`, `height`, `stroke` |
| `ref` | Instance of a `reusable: true` component | `ref` (component ID), `descendants` (override map) |

## 2. Auto Layout (Flex) Rules

OpenPenViewer computes flex layout on every `frame`:

- `layout`: `"vertical"` | `"horizontal"` | `"none"`.
  - **CRITICAL:** If `layout` is **omitted** on a `frame` that has `children`, the layout engine defaults to **`"horizontal"`**!
  - Whenever you want free absolute `(x, y)` positioning inside a frame (e.g., badges over an image, floating buttons, overlays), you **MUST** set `layout: "none"` on the parent frame **OR** set `layoutPosition: "absolute"` on the floating child.
- `width` / `height`:
  - Fixed number: `412`, `48`, `24`
  - `"fill_container"` — stretches to fill available space inside a flex parent.
  - `"fit_content"` — shrinks to wrap children.
- `padding`:
  - Single number: `16` (all sides)
  - 2-tuple: `[vertical, horizontal]` (e.g. `[12, 16]`)
  - 4-tuple: `[top, right, bottom, left]` (e.g. `[8, 12, 16, 12]`)
- `gap`: spacing between flex children in pixels (`number`).
- `justifyContent`: `"start"` | `"center"` | `"end"` | `"space_between"` | `"space_around"`
- `alignItems`: `"start"` | `"center"` | `"end"`

## 3. Text Sizing & Wrapping

- For single-line labels / buttons: omit `textGrowth` or use `textGrowth: "auto"`.
- For multi-line paragraphs inside a flex column: set `textGrowth: "fixed-width"` AND `width: "fill_container"` (or an explicit pixel width) so lines wrap cleanly without overflowing the screen.

## 4. Variables (`$token`) & Themes

- Define variables using `set_variable({ name: "primary", type: "color", value: "#4F46E5" })`.
- Reference them anywhere in `fill` or `stroke.fill` with `"$primary"` (or `"$surface"`, `"$text-primary"`).
- Always prefer semantic variables over raw hardcoded hex codes when the document already defines `doc.variables`.

## 5. Icons (`icon_font`)

- Prefer `iconFontFamily: "lucide"` (e.g. `search`, `shopping-bag`, `heart`, `plus`, `trash-2`, `home`, `user`, `sliders-horizontal`, `star`, `arrow-left`).
- Always specify explicit square dimensions (`width: 20, height: 20` or `24 × 24`) and `fill: "#..."` (or `"$on-surface"`).

## 6. Minimal Valid Frame Example

```json
{
  "type": "frame",
  "id": "btn-primary",
  "name": "Primary Button",
  "width": "fill_container",
  "height": 48,
  "layout": "horizontal",
  "justifyContent": "center",
  "alignItems": "center",
  "gap": 8,
  "padding": [0, 20],
  "cornerRadius": 12,
  "fill": "#4F46E5",
  "children": [
    {
      "type": "text",
      "id": "btn-primary-label",
      "content": "Continue",
      "fontFamily": "Inter",
      "fontSize": 15,
      "fontWeight": "600",
      "fill": "#FFFFFF"
    }
  ]
}
```


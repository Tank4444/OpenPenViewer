---
name: figma-export-ready
title: Figma (.fig) Export Compatibility Guidelines
description: Authoring rules for .pen documents so that exporting to Figma (.fig) via OpenPenViewer produces a 1-to-1 layout with zero geometry drift and 100% vector icons.
tags: [figma, fig, export, compatibility, vectors]
---

# Figma (.fig) Export Compatibility Guidelines

Follow these rules when creating or editing `.pen` files that will be exported to `.fig` (Figma) via OpenPenViewer.

## 1. Layout Fidelity
- **Explicit `layout: "none"`:** Always set `layout: "none"` on frames that position children with explicit `(x, y)` coordinates (e.g., image containers with overlay badges). Never leave `layout` omitted on non-flex containers.
- **Absolute children inside Auto Layout:** Use `layoutPosition: "absolute"` + explicit `x`, `y` when placing a floating badge or FAB inside a flex frame.
- **Supported `justifyContent` values:** `start`, `center`, `end`, `space_between`, `space_around` (maps cleanly to Figma `SPACE_EVENLY`).
- **4-sided padding:** `[top, right, bottom, left]` is fully preserved in `.fig` (`stackVerticalPadding`, `stackHorizontalPadding`, `stackPaddingRight`, `stackPaddingBottom`).

## 2. 100% Vector Icons in Figma
OpenPenViewer exports `icon_font` nodes as transparent `w × h` wrapper `FRAME`s containing a centered `VECTOR` child so Auto Layout slots never shrink or shift sibling elements.
- Prefer **Lucide** icon names (`iconFontFamily: "lucide"`) or standard **Material Symbols** names (`search`, `home`, `favorite`, `shopping_bag`, `shopping_cart`, `person`, `delete`, `add`, `remove`, `star`, `arrow_back`, `tune`, `swap_vert`, `storefront`, `alternate_email`, `verified_user`, `replay`, `wifi`, `battery_full`, `signal_cellular_4_bar`).
- Avoid obscure custom icon glyphs that have no Lucide vector mapping, as they fall back to `TEXT` layers in Figma.

## 3. Strokes, Fills & Corners
- **Strokes:** Prefer a single numeric `thickness` (e.g., `thickness: 1`). Partial side thickness objects (`{ top: 1, bottom: 2 }`) are flattened to the maximum side thickness in `.fig`.
- **Corner Radius:** Prefer a single numeric `cornerRadius` (e.g., `12` or `999` for pills).
- **Fills:** Solid hex colors (`#RRGGBB` / `#RRGGBBAA`) and `linear` / `radial` gradients export cleanly. Avoid `mesh_gradient` if strict Figma parity is required.
- **Text:** Use standard web/Figma fonts (`Inter`, `Roboto`, `Plus Jakarta Sans`, `SF Pro`) and standard `textAlign` (`left`, `center`, `right`, `justified`).


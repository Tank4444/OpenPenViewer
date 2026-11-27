---
name: ui-design-system
title: UI Design System & Screen Architecture
description: Practical guidelines for designing crisp, modern Mobile, Web, and Dashboard screens in OpenPenViewer using 8px spacing, typography hierarchy, contrast, and reusable patterns.
tags: [design, ui, typography, spacing, mobile, web, dashboard]
---

# UI Design System & Screen Architecture

Read this skill before creating new screens or redesigning existing UI in OpenPenViewer.

## 1. Standard Artboard Dimensions

Place multiple screens side-by-side horizontally with `60–80px` gap between artboards (`x = index * (width + 80), y = 0`):

- **Mobile (Android M3):** `412 × 915`, `cornerRadius: 28`, `clip: true`
- **Mobile (iOS):** `390 × 844`, `cornerRadius: 32`, `clip: true`
- **Desktop Web / SaaS:** `1440 × 900`, `clip: true`
- **Dashboard:** `1440 × 960` (240px sidebar + fluid main content)

## 2. 8px Spatial System

- Use multiples of `4px` / `8px` for all `padding`, `gap`, and heights: `4, 8, 12, 16, 20, 24, 32, 48`.
- Outer screen horizontal margin: `16px–20px` (Mobile), `32px–64px` (Desktop).
- Card internal padding: `16px` (compact) or `20px–24px` (comfortable).
- Minimum touch target height for interactive controls: `44px–48px`.

## 3. Typography Hierarchy

Stick to 1 clean sans-serif family (`Inter`, `Roboto`, or `Plus Jakarta Sans`) with clear contrast between levels:

| Role | `fontSize` | `fontWeight` | Typical Use |
| :--- | :---: | :---: | :--- |
| Display / Hero | `28–36` | `700` | Splash / landing headlines |
| Screen Title | `22–24` | `700` | Top app bar / section headers |
| Card Title | `16–18` | `600` | Product / widget titles |
| Body | `14–15` | `400` | Descriptions, form values |
| Caption / Meta | `12–13` | `500` | Badges, timestamps, helper text |

## 4. Color & Contrast (WCAG AA)

- Maintain a strict 3-layer surface hierarchy:
  - **Light:** Background `#F8FAFC` → Card `#FFFFFF` → Subtle container `#F1F5F9`, Border `#E2E8F0`, Primary text `#0F172A`, Muted `#64748B`.
  - **Dark:** Background `#0F1117` → Card `#161922` → Subtle container `#1E2230`, Border `#2A3042`, Primary text `#F1F5F9`, Muted `#94A3B8`.
- Use **one** primary brand accent (e.g., Indigo `#4F46E5` / `#6366F1`) for primary CTAs and active states; reserve semantic colors (`#16A34A` success, `#EF4444` error, `#F59E0B` warning) strictly for status.

## 5. Screen Composition Checklist

1. **Top Navigation / Status Bar** — clear title, back/action icons aligned `alignItems: "center"`, `justifyContent: "space_between"`.
2. **Primary Content** — clean vertical flex (`layout: "vertical"`, `gap: 16`, `padding: [16, 20]`).
3. **Cards & Lists** — consistent `cornerRadius` (`12–16px`), subtle `1px` border or soft shadow, never overcrowded.
4. **Bottom Navigation / CTA Footer** — pinned cleanly at the bottom (`height: 64–80`), using `justifyContent: "space_around"` for 3–5 tabs.
5. **Always verify visually** using `visual-qa-workflow` (`get_screenshot`) after building!


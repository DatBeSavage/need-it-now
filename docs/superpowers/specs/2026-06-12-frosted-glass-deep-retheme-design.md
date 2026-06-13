# Design: "Frosted Glass Deep" re-theme

**Date:** 2026-06-12
**Status:** Approved (visualizer pick: "Frosted Glass Deep", refined through
"Electric Night Market"; user chose full replacement of the light theme)

## Problem

The site is clean but visually generic. The owner wants a distinctive,
eye-catching identity. The picked direction: near-black base with blue/green
neon haze, frosted translucent surfaces, glowing green prices, glow-gradient
CTAs, glowing ⚡ brand mark.

## Decision

Full replacement — dark IS the brand. No light theme, no toggle. Approach:
token-first re-theme (every existing token NAME keeps resolving; values flip
to dark) plus an audited component pass over `main.css` for hardcoded light
values. No JS changes; HTML changes limited to a `theme-color` meta per page.

## Reference (from the visualizer mockup)

- Base `#0a0d14`; haze = radial blue glow top-left (`rgba(24,119,242,.32)`),
  radial green glow bottom-right (`rgba(22,163,74,.28)`), fixed attachment.
- Frosted panels: `rgba(255,255,255,.07)` fills, `rgba(255,255,255,.14)`
  borders, `backdrop-filter: blur(12-14px)`, deep `rgba(0,0,0,.35)` shadows.
- Prices: `#4dff9a` with `text-shadow: 0 0 10px rgba(22,163,74,.5)`.
- Badges: translucent brand tints with matching translucent borders, accent
  text `#7fc0ff` / `#4dff9a`.
- CTA: blue→green gradient with a green glow shadow.
- Brand ⚡: blue glow text-shadow.

## 1. Token layer (`assets/css/tokens.css`)

| Token | New value |
|---|---|
| `--bg` | `#0a0d14` |
| `--surface` | `rgba(255,255,255,.07)` (frosted) |
| `--surface-2` | `rgba(255,255,255,.05)` |
| `--surface-3` | `rgba(255,255,255,.10)` |
| `--surface-solid` (new) | `#11161f` — overlays where translucency stacks badly (toasts, dialogs, native selects) |
| `--border` / `--border-2` | `rgba(255,255,255,.10)` / `rgba(255,255,255,.18)` |
| `--ink` / `--ink-2` / `--muted` | `#e8edf5` / `#aebccf` / `#8fa0b8` |
| `--blue-600/700/800` | unchanged (button fills) |
| `--blue-400` (new) | `#3b9bff` — accent text on dark |
| `--green-400` (new) | `#4dff9a` — price/accent text on dark |
| `--blue-050` / `--blue-100` | `rgba(24,119,242,.18)` / `rgba(24,119,242,.32)` |
| `--green-050` / `--green-100` | `rgba(22,163,74,.16)` / `rgba(22,163,74,.30)` |
| `--danger` | `#ff5c4d` (brightened for dark contrast) |
| `--glow-blue` (new) | `0 0 14px rgba(24,119,242,.45)` |
| `--glow-green` (new) | `0 0 14px rgba(22,163,74,.45)` |
| `--grad-media` | `radial-gradient(circle at 50% 40%, rgba(60,120,255,.25), rgba(12,16,24,.5))` |
| `--shadow-sm/md/lg` | deepened to black-based (`rgba(0,0,0,.25–.5)`) |
| `--shadow-blue/green` | become glow shadows (keep names) |
| `--ring` | `0 0 0 3px rgba(24,119,242,.35)` |

`--gold`, type scale, spacing, radii, layout vars unchanged.

## 2. Component pass (`assets/css/main.css`)

Audit method: grep `#fff`, `rgba(255,`, and remaining light hexes; convert
each occurrence to tokens or dark equivalents. Known inventory:

- **Body haze:** replace the two light radial washes with the neon haze
  (values above), keep `background-attachment: fixed`.
- **Nav:** `rgba(255,255,255,.82)` → `rgba(13,17,26,.7)` (keep blur);
  `.brand__mark`/⚡ gets `text-shadow: var(--glow-blue)`. Mobile solid-nav
  override and the bottom tab bar (`rgba(255,255,255,.92)`) → dark frosted.
- **Filter bar** (`.controls` `rgba(255,255,255,.85)`) → `rgba(17,22,31,.75)`
  + blur (hero element of the mockup).
- **Prices** (`.price`): `color: var(--green-400); text-shadow: var(--glow-green)`.
- **Buttons:** gradient fills stay; `.btn--ghost` frosted (`--surface-3` fill,
  light text); `:focus-visible` outlines stay visible on dark.
- **Cards** (`.listing`, `.card`, `.step`, `.float-card` `rgba(255,255,255,.86)`,
  `.owner-card`, `.thread`, chat panel, modal): token-driven — verify each;
  `.listing:hover` adds brighter border + subtle glow.
- **Toast:** `background: var(--ink)` would invert badly → explicit
  `background: var(--surface-solid); border: 1px solid var(--border-2);
  color: var(--ink)`; error variant keeps a dark red (`#7f1d1d` → keep, it
  works on dark); success/error icon colors unchanged (they were picked for
  dark pills already).
- **Skeletons:** base `--surface-2` already; shimmer highlight
  `rgba(255,255,255,.65)` → `rgba(255,255,255,.12)`.
- **Banners** (`.banner`, `.banner--ok`): translucent tint fills via redefined
  tokens; hardcoded `#cfe1fd`/`#c7ead4` borders → translucent brand borders.
- **Badges/chips:** automatic via redefined tint tokens; badge text colors
  switch from `--blue-700`/`--green-700` (too dark on dark) to
  `--blue-400`/`--green-400` in the badge rules.
- **Forms:** `.input/.select/.textarea` + searchbox/locfield/distfield —
  frosted fills, light text; `select option` readable via `--surface-solid`;
  `.form-error--ok`/`.zip-hint--ok` → `--green-400`.
- **Chat bubbles:** `.bub--them` frosted; `.bub--me` keeps blue fill;
  timestamps `--muted`.
- **Misc:** `::selection` (light blue bg → `rgba(24,119,242,.4)` + light
  text), `.empty`, `.foot`, admin rows, guidelines page, hero `::before`
  washes, step number chips, CTA card gradient
  (`linear-gradient(135deg, var(--blue-050), var(--green-050))` now resolves
  translucent — verify it reads well), lightbox (already dark, unchanged).

**Blur budget (performance):** `backdrop-filter` ONLY on nav, bottom tab bar,
filter bar, and modal backdrops. Cards/threads/inputs use translucent fills
WITHOUT blur — visually equivalent over the fixed haze, far cheaper on mobile
GPUs. Remove the mockup's per-card blur intent deliberately.

## 3. HTML touch

Add `<meta name="theme-color" content="#0a0d14" />` to the `<head>` of all 10
pages (root `index.html` + 9 in `pages/`).

## 4. Accessibility

- Contrast (on `#0a0d14`): ink ≈ 15:1, ink-2 ≈ 7:1, muted ≈ 5.4:1,
  green-400 ≈ 10:1, blue-400 ≈ 6:1 — AA+.
- Focus rings: redefined `--ring` is visible on dark; `:focus-visible`
  outline colors checked per component.
- `prefers-reduced-motion` blocks already exist and are unaffected.

## 5. Testing (manual, via preview — subagent-run with screenshots)

Cache-bust CSS, then sweep at desktop and 390px: landing (hero, float cards,
steps, CTA card, footer), feed (skeletons → cards → empty state, filter bar,
chips), listing detail (gallery, thumbs, lightbox, owner card, actions), post
form (fields, photo thumbs), login/register/reset, messages + chat panel
(bubbles, deal bar, rating stars), profile, admin (tables, settings),
guidelines. Interactions: all 3 toast variants, confirm dialog (danger),
report modal, nav badge, view-transition between pages (no white flash —
`html { background: var(--bg) }` flips automatically). Zero console errors.

## Out of scope

Retention features (favorites, live "just posted" ticker, new-since-last-visit
markers) — separate brainstorm/spec after this ships. No logo/asset redesign.
No light theme.

# Frosted Glass Deep Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light theme with the "Frosted Glass Deep" dark identity — near-black base, blue/green neon haze, frosted surfaces, glowing prices/CTAs — across all 10 pages.

**Architecture:** Token-first: `tokens.css` is rewritten (same token NAMES, dark values, a few new tokens) so most components restyle automatically; then an audited pass over `main.css` converts every hardcoded light value (exact inventory below, plus a final grep sweep with a classification rule). One 1-line HTML touch per page (`theme-color` meta). No JS changes.

**Tech Stack:** Plain CSS custom properties; no build step.

**Spec:** `docs/superpowers/specs/2026-06-12-frosted-glass-deep-retheme-design.md`

**Verification note (IMPORTANT):** The preview browser caches files hard. Before every visual check: `await Promise.all(["/assets/css/tokens.css","/assets/css/main.css"].map(u => fetch(u,{cache:"reload"})))` then `location.reload()`. Preview runs on port 5500 (`preview_list` → serverId). Screenshots are the test artifacts.

**Classification rule for any color not explicitly listed:** white/near-white text **on a colored or dark fill** (buttons, brand mark, avatar initials, chips.active, lightbox controls, toast icons, bub--me) = KEEP. A **light surface/background/border** (white-ish fills, pale tint borders, pale hexes like `#fff6e6`) = CONVERT to the nearest token or the explicit value given here. When genuinely unsure: frosted surface (`var(--surface)`/`--surface-3`), light text (`var(--ink)`), translucent border (`var(--border)`).

---

### Task 1: Rewrite `assets/css/tokens.css`

**Files:**
- Modify: `assets/css/tokens.css` (full replacement)

- [ ] **Step 1: Replace the entire file with:**

```css
/* Need-It-Now — design tokens ("Frosted Glass Deep" dark theme)
   Near-black base + neon blue/green haze + frosted translucent surfaces.
   Edit these variables to re-theme the whole site. */
:root {
  /* Brand: trust blue (identity) + money green (prices/CTAs) */
  --blue-600: #1877f2;   /* primary fills */
  --blue-700: #1568d8;   /* primary hover (deeper) */
  --blue-800: #0f4fa8;   /* gradient end / pressed */
  --blue-400: #3b9bff;   /* accent TEXT on dark */
  --blue-050: rgba(24,119,242,.18);  /* tints / badges */
  --blue-100: rgba(24,119,242,.32);  /* stronger tint / selection */

  --green-600: #16a34a;  /* money accent / sell fills */
  --green-700: #15803d;  /* hover */
  --green-400: #4dff9a;  /* price/accent TEXT on dark */
  --green-050: rgba(22,163,74,.16); /* tint */
  --green-100: rgba(22,163,74,.30);

  /* Neutrals — near-black base, frosted translucent surfaces */
  --bg:        #0a0d14;  /* app background */
  --surface:   rgba(255,255,255,.07);  /* cards, nav panels */
  --surface-2: rgba(255,255,255,.05);  /* subtle fills */
  --surface-3: rgba(255,255,255,.10);  /* deeper fill / ghost buttons */
  --surface-solid: #11161f; /* solid overlays: toasts, dialogs, select menus */
  --border:    rgba(255,255,255,.10);
  --border-2:  rgba(255,255,255,.18);

  --ink:       #e8edf5;  /* primary text */
  --ink-2:     #aebccf;  /* secondary text */
  --muted:     #8fa0b8;  /* meta text */

  --danger:    #ff5c4d;  /* brightened for dark contrast */
  --gold:      #f5a623;  /* stars */

  /* Gradients (depth + brand) */
  --grad-brand: linear-gradient(135deg, var(--blue-600), var(--green-600));
  --grad-blue:  linear-gradient(135deg, #2f86f6, var(--blue-700));
  --grad-green: linear-gradient(135deg, #1cb257, var(--green-700));
  --grad-media: radial-gradient(circle at 50% 40%, rgba(60,120,255,.25), rgba(12,16,24,.5));

  /* Neon glows (the signature) */
  --glow-blue:  0 0 14px rgba(24,119,242,.45);
  --glow-green: 0 0 14px rgba(22,163,74,.45);

  /* Type */
  --font-display: "Sora", system-ui, sans-serif;
  --font-body: "Manrope", system-ui, sans-serif;

  /* Fluid modular type scale — sizes flex with the viewport */
  --fs-xs:  0.78rem;
  --fs-sm:  0.875rem;
  --fs-base: 1rem;
  --fs-md:  1.15rem;
  --fs-lg:  clamp(1.3rem, 1.12rem + 0.9vw, 1.45rem);
  --fs-xl:  clamp(1.55rem, 1.25rem + 1.5vw, 1.95rem);
  --fs-2xl: clamp(1.95rem, 1.45rem + 2.5vw, 2.6rem);
  --fs-3xl: clamp(2.4rem, 1.55rem + 4.2vw, 4rem);

  /* Spacing scale (4px base) */
  --sp-1: 0.25rem;
  --sp-2: 0.5rem;
  --sp-3: 0.75rem;
  --sp-4: 1rem;
  --sp-5: 1.5rem;
  --sp-6: 2rem;
  --sp-7: 3rem;
  --sp-8: 4.5rem;

  /* Radius */
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 20px;
  --r-pill: 999px;

  /* Depth on dark */
  --shadow-sm: 0 1px 2px rgba(0,0,0,.25), 0 1px 3px rgba(0,0,0,.2);
  --shadow-md: 0 6px 16px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.25);
  --shadow-lg: 0 24px 50px rgba(0,0,0,.5), 0 8px 18px rgba(0,0,0,.3);
  --shadow-blue:  0 0 18px rgba(24,119,242,.40);
  --shadow-green: 0 0 18px rgba(22,163,74,.38);
  --ring: 0 0 0 3px rgba(24,119,242,.35);

  --maxw: 1140px;
  --nav-h: 62px;
  --bottomnav-h: 60px;
}
```

- [ ] **Step 2: Verify in the preview**

Cache-bust + reload the feed. Expected: the site goes dark immediately (most surfaces flip via tokens). It will look HALF-DONE — light leftovers in nav/controls/banners are expected until Tasks 2–4. Confirm text is light, cards are translucent dark, no console errors. Screenshot for the record.

- [ ] **Step 3: Commit**

```bash
git add assets/css/tokens.css
git commit -m "feat(theme): dark token layer — Frosted Glass Deep palette, glows, frosted surfaces"
```

### Task 2: main.css pass A — base chrome (body, hero, nav, controls)

**Files:**
- Modify: `assets/css/main.css` (exact line refs are pre-rewrite positions; locate by content)

- [ ] **Step 1: Body neon haze.** In the `body { ... }` rule, replace the two radial-gradient lines:

```css
    radial-gradient(55% 45% at 100% 0%, rgba(22,163,74,.06), transparent 60%),
    radial-gradient(60% 50% at 0% 0%, rgba(24,119,242,.07), transparent 60%),
```
with:
```css
    radial-gradient(circle at 22% 0%, rgba(24,119,242,.25), transparent 52%),
    radial-gradient(circle at 92% 100%, rgba(22,163,74,.20), transparent 52%),
```
(`background-attachment: fixed` stays.)

- [ ] **Step 2: Hero washes.** In `.hero::before`, change `rgba(22,163,74,.16)` → `rgba(22,163,74,.30)` and `rgba(24,119,242,.18)` → `rgba(24,119,242,.32)`.

- [ ] **Step 3: Nav glass.** Line ~44: `background: rgba(255,255,255,.82);` → `background: rgba(13,17,26,.70);`

- [ ] **Step 4: Brand glow.** In `.brand__mark { ... }` change `box-shadow: var(--shadow-sm);` → `box-shadow: var(--shadow-sm), var(--glow-blue);`. Then change the brand text colors:

```css
.brand b { color: var(--blue-400); }
.brand b + b { color: var(--green-400); }
```
(replacing the existing two rules that use `--blue-600`/`--green-600`).

- [ ] **Step 5: Active nav link.** `.nav__links a.active { color: var(--blue-600); background: var(--blue-050); }` → `color: var(--blue-400);` (background token now resolves translucent — keep).

- [ ] **Step 6: Filter bar glass.** In `.controls { ... }` (~line 259): `background: rgba(255,255,255,.85);` → `background: rgba(17,22,31,.75);`

- [ ] **Step 7: Mobile chrome.** In the `@media (max-width: 760px)` block:
  - `.nav { background: var(--surface); ... }` (the solid-top-bar override) → `background: rgba(13,17,26,.92);` (keep the backdrop-filter:none lines — translucent-without-blur smears, so near-solid).
  - `.nav__links { ... background: rgba(255,255,255,.92); ... }` (~line 608) → `background: rgba(13,17,26,.88);`

- [ ] **Step 8: Verify**

Cache-bust + reload feed and index. Expected: dark glassy nav with glowing ⚡, brighter brand words, dark frosted filter bar, neon haze corners on the body. preview_resize to 390: bottom tab bar dark. Screenshots both widths. No console errors.

- [ ] **Step 9: Commit**

```bash
git add assets/css/main.css
git commit -m "feat(theme): dark chrome — neon haze, glass nav/controls, glowing brand"
```

### Task 3: main.css pass B — content components

**Files:**
- Modify: `assets/css/main.css`

- [ ] **Step 1: Prices glow.** `.price { font-family: var(--font-display); font-weight: 800; color: var(--green-700); }` → `color: var(--green-400); text-shadow: var(--glow-green);`

- [ ] **Step 2: Badges.** Replace:
```css
.badge--sell { background: var(--green-050); color: var(--green-700); }
.badge--buy  { background: var(--blue-050); color: var(--blue-700); }
```
with:
```css
.badge--sell { background: var(--green-050); color: var(--green-400); border: 1px solid rgba(77,255,154,.35); }
.badge--buy  { background: var(--blue-050); color: var(--blue-400); border: 1px solid rgba(95,176,255,.35); }
```

- [ ] **Step 3: Star badge.** In `.star-badge { ... }` (~line 517): `background: #fff6e6;` → `background: rgba(245,166,35,.16);` and set its text `color: var(--gold);` (replace any darker color it sets). If `.star-badge--new` has its own light tint, convert to `background: var(--blue-050); color: var(--blue-400);`.

- [ ] **Step 4: Listing hover glow.** `.listing:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: var(--border-2); }` → `box-shadow: var(--shadow-lg), 0 0 22px rgba(24,119,242,.18); border-color: rgba(95,176,255,.35);` (keep the transform).

- [ ] **Step 5: Float cards (landing hero).** `.float-card { ... background: rgba(255,255,255,.86); ... }` (~line 177) → `background: rgba(17,22,31,.78);`

- [ ] **Step 6: Banners.** (~lines 351–354):
```css
  background: var(--blue-050); border: 1px solid #cfe1fd; color: var(--blue-700);
```
→ `border: 1px solid rgba(95,176,255,.35); color: var(--blue-400);` (background token already translucent), and
```css
.banner--ok { background: var(--green-050); border-color: #c7ead4; color: var(--green-700); }
```
→ `border-color: rgba(77,255,154,.35); color: var(--green-400);`

- [ ] **Step 7: Skeleton shimmer.** (~line 342): `rgba(255,255,255,.65)` → `rgba(255,255,255,.12)`.

- [ ] **Step 8: Form feedback colors.** `.form-error--ok`, `.zip-hint--ok`: `color: var(--green-700)` → `color: var(--green-400)`. Leave `.form-error`/`--bad` on `var(--danger)` (already brightened).

- [ ] **Step 9: Native select menus.** Add after the `.input, .select, .textarea` block:
```css
.select option, .distfield__select option { background: var(--surface-solid); color: var(--ink); }
```

- [ ] **Step 10: Verify**

Cache-bust + reload: feed (badges bordered + glowing prices + hover glow), index (float cards dark, banners on feed after `?posted` simulation not needed — check the logged-out banner if present), register page (zip hint colors). Screenshots. No console errors.

- [ ] **Step 11: Commit**

```bash
git add assets/css/main.css
git commit -m "feat(theme): dark content pass — glowing prices, bordered badges, frosted cards"
```

### Task 4: main.css pass C — overlays + final audit sweep

**Files:**
- Modify: `assets/css/main.css`

- [ ] **Step 1: Toast on dark.** In `.toast { ... }` (~line 389): `background: var(--ink); color: #fff;` → `background: var(--surface-solid); color: var(--ink); border: 1px solid var(--border-2);`. Keep `.toast--error { background: #7f1d1d; }` but add `border-color: rgba(255,92,77,.45);`. Toast icons/action/x rules stay (they were designed for a dark pill).

- [ ] **Step 2: The other `var(--ink)`-background button.** ~Line 501 there is a rule with `background: var(--ink); color: #fff;` (a small × button — identify its selector by reading). Change to `background: rgba(8,10,16,.72); color: #fff;` so it stays a dark chip now that `--ink` is light.

- [ ] **Step 3: Modal backdrop.** `.modal-back { ... background: rgba(11,12,14,.5); ... }` → `background: rgba(4,6,10,.66);` (blur stays).

- [ ] **Step 4: Chat bubbles.** Find `.bub--them` (near `.bub--me` ~line 437). Ensure it uses `background: var(--surface-3); color: var(--ink);` (replace any light fill). `.bub--me` stays blue/white. Check `.bub__who`/`.bub__time` use `var(--muted)`-class colors; convert hardcoded greys.

- [ ] **Step 5: Region audit (threads / chat panel / admin / profile / post / guidelines / detail).** Read main.css end to end for the regions not explicitly covered (roughly lines 330–700: avatars, stars, threads, chat, deal bar, rating stars, report modal, admin rows/tabs, profile card, photo thumbs, detail/gallery). Apply the **classification rule** from the plan header to every remaining light value. Known certainties: lightbox rules are already dark — leave them; `.gallery__dot` tokens already resolve — leave.

- [ ] **Step 6: Final sweep grep.** Run:
```
rg -n "rgba\(255|#f[0-9a-e]|#e[0-9a-f]|#d[0-9a-f]|#c[0-9a-f]|white" assets/css/main.css
```
Classify every remaining hit per the rule (KEEP white-on-color; CONVERT light surfaces). The shimmer gradient's `transparent` stops and `#fff`-on-gradient buttons will dominate the KEEP list — that's expected.

- [ ] **Step 7: Verify**

Cache-bust + reload. Walk in the preview: feed → open chat panel (bubbles, input, deal bar) → messages page (threads) → admin page if reachable → post page (photo thumb ×) → toasts via console:
```js
const { toast } = await import("/assets/js/ui.js");
toast("info"); toast("ok", {type:"success"}); toast("bad", {type:"error"});
```
Expected: toasts readable (solid dark, light text, bordered), modals dim the page deeper, bubbles legible. Screenshots. No console errors.

- [ ] **Step 8: Commit**

```bash
git add assets/css/main.css
git commit -m "feat(theme): dark overlays + full audit sweep — toasts, modals, chat, leftovers"
```

### Task 5: theme-color metas

**Files:**
- Modify: `index.html` + all 9 files in `pages/` (login, register, reset, post, feed, listing, messages, profile, admin, guidelines — note that's 10 files total with index)

- [ ] **Step 1:** In each `<head>`, directly after the `<meta name="viewport" ...>` line, add:
```html
  <meta name="theme-color" content="#0a0d14" />
```

- [ ] **Step 2: Verify:** `rg -l "theme-color" index.html pages` → 10 files.

- [ ] **Step 3: Commit**

```bash
git add index.html pages
git commit -m "feat(theme): dark theme-color meta on all pages"
```

### Task 6: Full-site screenshot sweep + docs

**Files:**
- Modify: `assets/css/main.css` (bounded fixes only), `CLAUDE.md`

- [ ] **Step 1: Sweep.** Cache-bust everything (all CSS + reload). Screenshot at desktop AND 390px: index, feed (skeletons on throttle if easy, cards, empty state via a nonsense search), listing detail (gallery + lightbox open), post, login, register, reset, messages (+ chat panel open if a session exists), profile, admin (skip if not admin), guidelines. Interactions: 3 toast variants, confirm dialog (trigger via a delete attempt then cancel), report modal.

- [ ] **Step 2: Bounded fixes.** Authority is limited to contrast/visibility corrections (text unreadable, invisible borders, double-translucency mud). Anything structural → report back instead of fixing.

- [ ] **Step 3: CLAUDE.md.** Update the `tokens.css` bullet: replace `(blue primary, green money accent, neutrals, type + spacing scale, radius, shadows). Re-theme here.` with `("Frosted Glass Deep" dark theme: near-black bg + neon blue/green haze, frosted translucent surfaces, glow accents; blue primary, green money accent). Re-theme here.`

- [ ] **Step 4: Commit**

```bash
git add assets/css/main.css CLAUDE.md
git commit -m "feat(theme): sweep fixes + project-map note for the dark theme"
```

---

## Final verification

- [ ] Every page screenshot reviewed at both widths; no light-theme remnants, no unreadable text.
- [ ] `rg -n "rgba\(255,255,255,\.(8|9)" assets/css/main.css` → no matches (the old light chrome fills are gone).
- [ ] View-transition between pages shows no white flash (html background flips with the token).
- [ ] No console errors anywhere.

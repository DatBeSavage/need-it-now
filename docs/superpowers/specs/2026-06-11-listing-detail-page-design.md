# Design: Listing detail page

**Date:** 2026-06-11
**Status:** Approved (brainstorm with user)

## Problem

A feed card shows one cover photo and a 2-line truncated description. There is
no way to see a listing's other photos (up to 4 are stored) or its full
details. Clicking a card does nothing. Users need a dedicated view to inspect a
listing before acting on it.

## Decisions (from brainstorming)

- **Dedicated page** at `pages/listing.html?id=<uuid>` — shareable/linkable,
  works logged-out, matches the existing `profile.html?u=` / `post.html?id=`
  multi-page pattern. **Not** added to the nav (reached by clicking a card,
  exactly like `profile.html`).
- **Responsive gallery:** desktop = large cover + thumbnail strip + click-to-
  enlarge lightbox; mobile = swipeable carousel with dots.
- **Whole feed card is clickable** to open the detail, via the stretched-link
  pattern (the title is a real `<a>` whose `::after` overlay covers the card;
  existing nested buttons sit above it and keep working — no invalid
  anchor-wrapping-buttons markup).
- **Full action surface** on the detail page (chat/report for others' listings;
  edit/delete for your own).

## Scope

In: the detail page, its responsive gallery + lightbox, the data fetch, and the
feed card click integration. Out: editing photos on this page (that stays in
`post.html`), comments/Q&A, related-listings, maps.

## Files

- **`pages/listing.html`** (new) — standard nav chrome (same links as
  `feed.html`, none marked active), a `[data-listing]` mount point, and a
  lightbox mount. Loads `auth.js` (nav/notifications) and `listing.js` as
  modules. Uses `../assets/...` paths. Includes the Supabase + esm.sh preconnect
  hints (consistent with the other pages).
- **`assets/js/listing.js`** (new) — read `?id` from the query string, fetch via
  the API, render gallery/details/owner/actions, wire chat/report/edit/delete
  and the lightbox.
- **`assets/js/api.js`** — add `getListingDetail(id)` (see Data layer).
- **`assets/js/feed.js`** — make the whole card clickable (stretched link on the
  title; buttons + owner link raised above the overlay).
- **`assets/css/main.css`** — `.listing` stretched-link rules; detail page
  layout; responsive gallery (desktop thumb strip / mobile carousel + dots);
  lightbox.

## Data layer

`getListingDetail(id)` in `api.js`:
- Fetches the listing row (`getListing` already exists; reuse it).
- Returns `null` when: no row; or `listing.hidden` is true **and** the viewer is
  neither the owner nor an admin (so admin-hidden listings stay hidden; reuse
  `getProfile` + `amIAdmin`).
- Merges the owner's `avatar_path` → `owner_avatar`, `rating_avg` →
  `owner_rating`, `rating_count` → `owner_rating_count`, plus `bio`, by reusing
  `getProfileById(listing.user_id)` (skip when `user_id` is null — sample/seed
  listings).
- Returns a row shaped like a `nearby_listings` feed row, so it is directly
  compatible with `openChatForListing`, `avatarHTML`, and `starBadge`.

## The detail page

**Gallery** — `renderGallery(photos)` branches on
`window.matchMedia("(max-width: 760px)")` and re-renders on the breakpoint
`change` event (handles orientation/resize crossing the breakpoint):
- **Desktop:** `.gallery__main` shows the cover; `.gallery__thumbs` shows up to
  4 thumbnails (buttons, keyboard-focusable). Clicking/Enter on a thumb swaps
  the main image and marks it active. Clicking the main image opens the
  **lightbox**: a full-screen overlay (built on the existing `.modal-back`
  styling) showing the photo large, with prev/next controls when there is more
  than one photo, and Esc/backdrop to close (reuse the `escToClose` helper from
  `ui.js`).
- **Mobile:** `.gallery--carousel` is a horizontal CSS `scroll-snap` container,
  one full-width photo per slide (native swipe). `.gallery__dots` below sync to
  the scrolled slide (scroll listener or IntersectionObserver). No lightbox on
  mobile — the carousel is the full-bleed view.
- **1 photo:** show just the photo (no thumbs/dots/arrows). **0 photos:** the
  emoji/placeholder block (same fallback the card uses, `row.emoji || "📦"`).

**Details:** type badge (For sale / Looking to buy), price (`$N`, or
`Budget $N` for buy listings), full untruncated title + description, category
chip when present, `📍 City` (via `resolveZip(zip).city`, falling back to the
ZIP), "posted Nh ago" (a `timeAgo` like the feed's), and "N interested"
(`response_count`).

**Owner card:** avatar + name linking to `profile.html?u=<user_id>`, the star
rating badge (`starBadge`), and bio when present.

**Actions:**
- **Mine** (`listing.user_id === currentProfile.id`): Edit (link to
  `post.html?id=<id>`) + Delete (confirm dialog → `deleteListing` → success
  toast → navigate back to the feed).
- **Others':** "I'm interested" (sell) / "I have one" (buy) → `openChatForListing`
  + Report → `openReport`.
- **Sample/seed listings** (`user_id` null): the chat button surfaces the
  existing "this is a sample listing — post your own" notice (already handled
  inside `getOrCreateConversation`/`openChatForListing`).

## Data flow

`DOMContentLoaded` → read `id` from `URLSearchParams` (missing/invalid → render
the not-found state) → `getListingDetail(id)` (null → "This listing isn't
available" with a link back to the feed) → render details, owner, gallery, and
actions. `getProfile()` determines mine-vs-others; hidden/admin visibility is
resolved inside `getListingDetail`.

## Error handling & safety

- Missing/deleted listing, or hidden listing viewed by a non-owner → a friendly
  not-found panel with a link back to the feed (no console error).
- **Every stored field is HTML-escaped before going into markup** — title,
  description, photo URLs (via `listingPhotoUrl` then escape), avatar path — per
  the project's escape rule (`CLAUDE.md`: any URL built from a stored field MUST
  be escaped).
- Logged-out: the page renders fully; action buttons that require auth defer to
  the existing login-redirect inside `openChatForListing` / `openReport`.
- A photo that fails to load falls back to the placeholder rather than showing a
  broken-image icon (`onerror` handler).

## Testing

No test framework (static site). Manual verification via the local preview:
- **Desktop gallery:** thumbnail swap; lightbox open, prev/next, Esc, backdrop
  close.
- **Mobile gallery** (resize below 760px): carousel swipe; dots track the
  current slide; breakpoint re-render works both directions.
- **Actions:** mine shows Edit/Delete (delete confirms, removes, returns to
  feed); others' shows Interested/Report and they open the right modals.
- **Edge:** not-found (bad id), hidden listing as non-owner, logged-out view,
  0-photo and 1-photo listings.
- **Feed integration:** clicking a card body navigates to the detail; clicking
  Interested / Edit / Delete / Report / the owner link does **not** navigate.
- **XSS:** a listing whose title/description contains markup renders inert.

## Decomposition (for the implementation plan)

1. `api.getListingDetail` (fetch + owner merge + hidden guard).
2. `pages/listing.html` skeleton + nav chrome + preconnect.
3. `listing.js` — load `?id`, details + owner + location/time + not-found.
4. Responsive gallery (desktop strip / mobile carousel) + desktop lightbox.
5. Actions (mine: edit/delete; others: chat/report).
6. Feed card whole-clickable (stretched link).
7. CSS polish, responsive pass, escape audit.

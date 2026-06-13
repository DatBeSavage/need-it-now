# Design: Live "Show N new" pill + Favorites ❤

**Date:** 2026-06-12
**Status:** Approved (user picked: live updates as a feed-only pill; favorites
with a Saved chip on the feed; "new since last visit" markers deferred)

## Problem

Nothing pulls a browsing user back into the feed: new listings appear only on
manual refresh, and there is no way to keep listings you care about. Two
features: realtime awareness of fresh listings, and cross-device favorites.

---

## A. Live "just posted" pill (feed page only)

### Schema (`supabase/schema.sql`, idempotent)

Add `listings` to the `supabase_realtime` publication using the same do-block
pattern as `messages` (schema.sql "Realtime" section). Listings are
world-readable (`listings_select_all using (true)`), so INSERT events deliver
to all clients, including logged-out.

### API (`assets/js/api.js`)

`subscribeListings(onInsert)` — channel `"listings:new"`, postgres_changes
INSERT on `public.listings`, calls `onInsert(payload.new)`, returns an
unsubscribe function. Mirror of `subscribeMyMessages`.

### Feed behavior (`assets/js/feed.js`)

- Subscribe on feed-page load (any auth state). On an incoming row, IGNORE if:
  - `row.user_id === currentProfile.id` (your own post — the `?posted` flash
    already covers it), or
  - it fails the current type chip (`state.type` not "all"/equal — "saved"
    mode counts as suppressed display, see below), or
  - it fails the search text (case-insensitive substring against
    title+description when `state.q` non-empty), or
  - it fails the radius: haversine(current ZIP origin, row.lat/lng) >
    `state.radius`. Null coords (either side) count as IN radius — matching
    `nearby_listings`' null-distance semantics. Reuse the cached origin from
    the last `resolveZip(state.zip)` result (store it module-level at render
    time; if none yet, treat as in-radius).
- Matching rows increment `pendingNew`. A button pill renders under the
  controls bar: "Show 1 new listing" / "Show N new listings", wrapped in an
  `aria-live="polite"` container.
- Click → clear `pendingNew`, hide the pill, call `render()` (normal refetch;
  the RPC returns complete card shapes — no client-side row enrichment).
- While `state.type === "saved"` the pill is hidden; if `pendingNew > 0` when
  switching back to a non-saved chip, it reappears.
- Filter changes (chips/search/zip/radius) reset `pendingNew` to 0 (the
  buffer was evaluated against the old filters; the refetch they trigger
  shows fresh data anyway).
- Realtime failure: silent degrade — no pill, nothing breaks.

### Pill styling (`assets/css/main.css`)

`.fresh-pill`: pill-radius button, frosted dark fill (`--surface-solid` at
~.9 alpha or solid), `--border-2` border, `--blue-400` text, `--glow-blue`
shadow; positioned sticky just below the controls bar, centered; pop-in
transition; `prefers-reduced-motion` respected.

---

## B. Favorites ❤ + Saved view

### Schema (`supabase/schema.sql`, idempotent)

```sql
create table if not exists public.saves (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
```
RLS enabled; policies: select own (`user_id = auth.uid()`), insert own
(`with check (user_id = auth.uid() and not public.is_banned())`), delete own.
Explicit `grant select, insert, delete on public.saves to authenticated;`
(match the file's grant conventions). No counts, no triggers.

### API (`assets/js/api.js`)

- `mySaves()` → array of the caller's saved `listing_id`s; `[]` when logged
  out or on error (never throws into page render).
- `toggleSave(listingId, on)` → insert (`on` true) or delete (`on` false) the
  row; throws on error (callers roll back optimistic state).
- `savedListings()` → the caller's saves (newest first) with embedded
  listing + owner profile, mapped to the feed-row shape:
  `{...listing, owner_avatar, owner_rating, owner_rating_count,
  distance_mi: null}` (cards then show the ZIP — `cardHTML` already handles
  null distance). Hidden listings filtered out client-side. `[]` logged out.

### Feed (`assets/js/feed.js`, `pages/feed.html`, `assets/css/main.css`)

- **Heart overlay** on each card's media box, top-right: frosted dark circle,
  ♡ outline (unsaved) / ❤ red-tinted (saved), `aria-pressed` +
  `aria-label="Save listing"`; positioned above the stretched-link overlay
  (z-index 1) like the other in-card controls; small scale "pop" on toggle
  (reduced-motion: none). Not rendered on your own listings.
- Heart state: one `mySaves()` fetch on page load into a Set; hearts painted
  from it during `paintRows`; toggle is optimistic (flip UI + Set, then
  `toggleSave`; on error revert + error toast). Logged-out tap →
  `login.html?next=/pages/feed.html`.
- **"❤ Saved" chip** added after the two type chips in feed.html. Behavior in
  feed.js: clicking it with no session → login redirect; with a session →
  `state.type = "saved"`, URL gets `?type=saved` (whitelist "saved" in
  `readStateFromURL`), `render()` branches: saved mode calls `savedListings()`
  instead of `nearbyListings()` (ZIP/radius/search inputs left visible but
  inert for this mode), count text "N saved listing(s)", empty state
  "Nothing saved yet — tap the ♡ on a listing." Feed cache: `stateKey()`
  already includes type, so saved-mode caching just works.
- Unsaving while IN the Saved view removes the card optimistically (and from
  `lastRows`), with rollback on error.

### Detail page (`assets/js/listing.js`)

Heart button in `.detail__actions` for listings that are not yours: same
visual/behavioral contract (single `isSaved` check via `mySaves()` on load,
optimistic toggle, login redirect with `next` back to the listing URL).

---

## Edge cases

- Deleting a listing cascades its saves; hidden listings drop out of the
  Saved view silently.
- A save toggle racing a feed refetch is safe: hearts repaint from the Set,
  which is the source of truth between fetches.
- Multi-tab: saves sync on next load (no realtime on saves — YAGNI).

## USER ACTION (mid-build checkpoint)

Re-run `supabase/schema.sql` in the SQL Editor (fresh file from disk — adds
the `saves` table + the listings publication line). Verified by probing
`saves` from the preview (a select must not 404) and by the live pill E2E.

## Files

`supabase/schema.sql`, `assets/js/api.js`, `assets/js/feed.js`,
`assets/js/listing.js`, `pages/feed.html` (one chip line),
`assets/css/main.css` (pill + heart + saved-empty styles). No new pages or
modules. CLAUDE.md gets one line about saves/realtime listings.

## Testing (manual via preview)

- Pill: two accounts — B posts in A's radius → pill appears on A's feed
  within ~2s; click reveals it via refetch. B posts out-of-filter (wrong type
  while A filters, or far ZIP) → no pill. A posts → no pill for A. Filter
  change clears the pending count.
- Hearts: toggle on feed card and detail page; state agrees across both and
  with the Saved chip view; unsave inside Saved view removes the card;
  offline toggle rolls back with an error toast; logged-out taps redirect and
  return.
- `?type=saved` URL round-trip; saved empty state; no console errors
  anywhere; theme: pill and hearts read correctly on the dark theme at
  desktop + 390px.

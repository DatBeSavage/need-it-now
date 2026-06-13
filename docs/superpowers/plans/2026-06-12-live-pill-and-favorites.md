# Live Feed Pill + Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A realtime "Show N new listings" pill on the feed, plus cross-device favorites (photo-corner hearts, a "❤ Saved" chip view, and a save button on the detail page).

**Architecture:** One schema addition (a `saves` table with owner-only RLS + adding `listings` to the realtime publication). Four new api.js functions. feed.js gains a filter-aware realtime buffer whose pill triggers a plain refetch (no client-side row enrichment), a `savedSet` painted onto heart overlays, and a `saved` render mode that swaps `nearbyListings()` for `savedListings()`. listing.js gets a Save action button. All UI styled for the Frosted Glass Deep dark theme.

**Tech Stack:** Supabase realtime (postgres_changes) + REST, vanilla ES modules, CSS.

**Spec:** `docs/superpowers/specs/2026-06-12-live-pill-and-favorites-design.md`

**Verification note:** preview on port 5500 (`preview_list`); the browser caches modules hard — before every check: `await Promise.all(["/assets/js/api.js","/assets/js/feed.js","/assets/js/listing.js","/assets/css/main.css"].map(u => fetch(u,{cache:"reload"})))` then reload. Real listings exist near ZIP **70611**. Schema-dependent steps need the USER ACTION in Task 1 first — and per project memory, verify the schema actually applied by probing, never trust "I ran it".

---

### Task 1: Schema — saves table + listings publication

**Files:**
- Modify: `supabase/schema.sql` (append at end)

- [ ] **Step 1: Append exactly this to the end of `supabase/schema.sql`:**

```sql

-- ============================================================
-- Saves (favorites): each user's saved listings. Owner-only rows.
-- ============================================================
create table if not exists public.saves (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.saves enable row level security;
drop policy if exists "saves_select_own" on public.saves;
drop policy if exists "saves_insert_own" on public.saves;
drop policy if exists "saves_delete_own" on public.saves;
create policy "saves_select_own" on public.saves for select using (auth.uid() = user_id);
create policy "saves_insert_own" on public.saves for insert
  with check (auth.uid() = user_id and not public.is_banned());
create policy "saves_delete_own" on public.saves for delete using (auth.uid() = user_id);
grant select, insert, delete on public.saves to authenticated;

-- Realtime: new-listing INSERTs power the feed's "Show N new" pill.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listings'
  ) then execute 'alter publication supabase_realtime add table public.listings'; end if;
end $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): saves table (owner-only RLS) + listings realtime publication"
```

- [ ] **Step 3: USER ACTION checkpoint.** Ask the user to re-open `supabase/schema.sql` FRESH from disk and run the whole file in a NEW Supabase SQL Editor query. Do not verify Tasks 2+ against the live DB until confirmed.

- [ ] **Step 4: Probe (do not trust the confirmation).** From the preview console:
```js
(async () => {
  const api = await import("/assets/js/api.js?v=" + Date.now());
  const { error } = await api.supabase.from("saves").select("listing_id").limit(1);
  return JSON.stringify({ savesTableReachable: !error || error.code !== "42P01", err: error && error.message });
})()
```
Expected: `savesTableReachable: true` (logged-out returns zero rows, not a missing-table error). The publication is probed implicitly by Task 3's live test.

### Task 2: api.js — saves + realtime functions

**Files:**
- Modify: `assets/js/api.js` (insert after the `subscribeMyMessages` function, before `myConversations`)

- [ ] **Step 1: Insert exactly:**

```js

/* ---------------- Saves (favorites) + live feed ---------------- */
export async function mySaves() {
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase.from("saves").select("listing_id");
  if (error) return []; // hearts are optional — never break page render
  return (data || []).map(function (r) { return r.listing_id; });
}

export async function toggleSave(listingId, on) {
  const user = await getUser();
  if (!user) throw new Error("Please log in to save listings.");
  if (on) {
    const { error } = await supabase.from("saves").insert({ user_id: user.id, listing_id: listingId });
    if (error && error.code !== "23505") throw error; // duplicate save = already done
  } else {
    const { error } = await supabase.from("saves")
      .delete().eq("user_id", user.id).eq("listing_id", listingId);
    if (error) throw error;
  }
}

/* Saved listings, newest-saved first, shaped like feed rows. */
export async function savedListings() {
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("saves")
    .select("created_at, listing:listings(*, owner:profiles!listings_user_id_fkey(avatar_path, rating_avg, rating_count))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || [])
    .map(function (s) { return s.listing; })
    .filter(function (l) { return l && !l.hidden; })
    .map(function (l) {
      return Object.assign({}, l, {
        owner_avatar: l.owner ? l.owner.avatar_path : null,
        owner_rating: l.owner ? l.owner.rating_avg : 0,
        owner_rating_count: l.owner ? l.owner.rating_count : 0,
        distance_mi: null,
        owner: undefined,
      });
    });
}

/* Every listing INSERT (listings are world-readable). */
export function subscribeListings(onInsert) {
  const channel = supabase
    .channel("listings:new")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "listings" },
      function (payload) { onInsert(payload.new); })
    .subscribe();
  return function () { supabase.removeChannel(channel); };
}
```

- [ ] **Step 2: Verify exports** (cache-bust, then): all four are `"function"` via the usual `typeof` eval; `await api.mySaves()` returns `[]` logged-out without throwing.

- [ ] **Step 3: Commit**

```bash
git add assets/js/api.js
git commit -m "feat(api): mySaves/toggleSave/savedListings + subscribeListings"
```

### Task 3: Feed — realtime "Show N new" pill

**Files:**
- Modify: `assets/js/feed.js`
- Modify: `assets/css/main.css` (pill styles, after the `.skel` block)

- [ ] **Step 1: Imports.** Add `subscribeListings` to the api.js import in feed.js line 2 (it becomes `import { nearbyListings, getProfile, deleteListing, listingPhotoUrl, subscribeListings } from "./api.js";`).

- [ ] **Step 2: Module state + helpers.** Directly below `var deletedIds = {};` (feed.js:101) add:

```js
var pendingNew = 0, lastOrigin = null; // live "Show N new" pill state

function milesBetween(a, b) {
  var R = 3958.8, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.asin(Math.sqrt(s));
}

/* Would this just-posted row appear under the CURRENT filters? */
function matchesFilters(row) {
  if (state.type === "saved") return false; // pill is meaningless in the Saved view
  if (currentProfile && row.user_id === currentProfile.id) return false; // own post
  if ((state.type === "sell" || state.type === "buy") && row.type !== state.type) return false;
  if (state.q) {
    var q = state.q.toLowerCase();
    if ((row.title || "").toLowerCase().indexOf(q) === -1 &&
        (row.description || "").toLowerCase().indexOf(q) === -1) return false;
  }
  // Null coords on either side count as in-radius (same as the RPC's semantics).
  if (lastOrigin && row.lat != null && row.lng != null &&
      milesBetween(lastOrigin, row) > state.radius) return false;
  return true;
}

function freshPill() {
  var pill = document.getElementById("fresh-pill");
  if (!pill) {
    var holder = document.createElement("div");
    holder.className = "fresh-pill-holder";
    holder.setAttribute("aria-live", "polite");
    holder.innerHTML = '<button id="fresh-pill" class="fresh-pill" type="button" hidden></button>';
    var controls = document.getElementById("controls");
    controls.parentNode.insertBefore(holder, controls.nextSibling);
    pill = holder.querySelector("#fresh-pill");
    pill.addEventListener("click", function () { clearPill(); render(); });
  }
  return pill;
}
function updatePill() {
  var pill = freshPill();
  pill.textContent = "Show " + pendingNew + " new listing" + (pendingNew === 1 ? "" : "s");
  pill.hidden = pendingNew === 0;
}
function clearPill() { pendingNew = 0; updatePill(); }
```

- [ ] **Step 3: Remember the render origin.** In `render()`, right after `var origin = await resolveZip(state.zip);` (feed.js:143) add:

```js
  lastOrigin = origin;
```

- [ ] **Step 4: Reset the buffer on filter changes.**
  - In `scheduleRender` (feed.js:214-217), inside the timeout callback, before `writeStateToURL();` add `clearPill();`
  - In the chip click handler (feed.js:276-284), before `writeStateToURL();` add `clearPill();`

- [ ] **Step 5: Subscribe.** In the DOMContentLoaded handler (feed.js:302-312), after `render();` add:

```js
  subscribeListings(function (row) {
    if (!row || deletedIds[row.id]) return;
    if (!matchesFilters(row)) return;
    pendingNew++;
    updatePill();
  });
```

- [ ] **Step 6: Pill CSS** — in `assets/css/main.css`, after the skeleton block (`@media (prefers-reduced-motion: reduce) { .skel::after ... }`):

```css
/* Live "Show N new listings" pill */
.fresh-pill-holder {
  position: sticky; top: calc(var(--nav-h) + var(--sp-3)); z-index: 30;
  height: 0; display: flex; justify-content: center; overflow: visible;
}
.fresh-pill {
  border: 1px solid var(--border-2); background: var(--surface-solid); color: var(--blue-400);
  font: inherit; font-weight: 800; font-size: var(--fs-sm); padding: .55rem 1.1rem;
  border-radius: var(--r-pill); cursor: pointer;
  box-shadow: var(--shadow-md), var(--glow-blue);
  transition: transform .2s, opacity .2s;
}
.fresh-pill:hover { transform: translateY(-1px); }
.fresh-pill[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .fresh-pill { transition: none; } }
```

- [ ] **Step 7: Live verification (requires Task 1's USER ACTION done).** Two-client test in one page, exactly like the messaging E2E: load `/pages/feed.html?zip=70611&radius=50` (cache-busted). In the console, create an isolated client, sign up a throwaway account, and insert a listing near 70611:

```js
(async () => {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const cfg = await import("/assets/js/config.js");
  const c = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { storageKey: "sb-e2e-pill" } });
  const su = await c.auth.signUp({ email: "nin.e2e.pill." + Math.floor(Math.random()*1e8) + "@example.com", password: "test-pass-123", options: { data: { name: "Pill Tester", zip: "70611" } } });
  if (su.error) return "SIGNUP FAIL: " + su.error.message;
  const { error } = await c.from("listings").insert({ user_id: su.data.user.id, owner_name: "Pill Tester", type: "sell", title: "E2E Pill Test Item", description: "temp", price: 5, zip: "70611", lat: 30.322, lng: -93.2111, emoji: "🧪" });
  if (error) return "INSERT FAIL: " + error.message;
  await new Promise(r => setTimeout(r, 2500));
  const pill = document.getElementById("fresh-pill");
  return JSON.stringify({ pillVisible: !!pill && !pill.hidden, pillText: pill && pill.textContent });
})()
```
Expected: `pillVisible: true`, text "Show 1 new listing". Click the pill (`document.getElementById("fresh-pill").click()`), wait ~2s: the E2E item appears in the grid and the pill hides. Negative test: change the type chip to the OTHER type and insert another listing of the first type → no pill. CLEANUP: delete both test listings via the same client (`c.from("listings").delete().eq("user_id", su.data.user.id)`). No console errors.

- [ ] **Step 8: Commit**

```bash
git add assets/js/feed.js assets/css/main.css
git commit -m "feat: realtime 'Show N new listings' pill on the feed"
```

### Task 4: Feed hearts

**Files:**
- Modify: `assets/js/feed.js`
- Modify: `assets/css/main.css` (heart styles + `.listing__media` positioning)

- [ ] **Step 1: Imports.** Add `mySaves, toggleSave` to the feed.js api.js import.

- [ ] **Step 2: Saved-set state.** Below the `var pendingNew = 0, lastOrigin = null;` line add:

```js
var savedSet = {}; // listing_id -> 1 for the logged-in user's saves
```

In DOMContentLoaded, after `try { currentProfile = await getProfile(); } catch ...` add:

```js
  if (currentProfile) {
    try { (await mySaves()).forEach(function (id) { savedSet[id] = 1; }); } catch (e) { /* hearts optional */ }
  }
```

- [ ] **Step 3: Heart in `cardHTML`.** In the media div (feed.js:53-57), change to:

```js
      '<div class="listing__media">' +
        (row.photos && row.photos.length
          ? '<img class="listing__photo" src="' + escapeHTML(listingPhotoUrl(row.photos[0])) + '" alt="" loading="lazy" />'
          : (row.emoji || "📦")) +
        ((row.user_id && !isMine(row))
          ? '<button type="button" class="save-heart' + (savedSet[row.id] ? " is-saved" : "") +
            '" data-save="' + row.id + '" aria-pressed="' + (savedSet[row.id] ? "true" : "false") +
            '" aria-label="Save listing">' + (savedSet[row.id] ? "❤" : "♡") + "</button>"
          : "") +
      "</div>" +
```

- [ ] **Step 4: Wire hearts in `paintRows`.** After the `[data-report]` forEach block add:

```js
  grid.querySelectorAll("[data-save]").forEach(function (btn) {
    btn.addEventListener("click", function () { toggleHeart(btn); });
  });
```

- [ ] **Step 5: Toggle handler.** Add below `confirmDelete`:

```js
var SAVED_EMPTY = '<div class="empty"><div class="em">🤍</div>' +
  "<p>Nothing saved yet — tap the ♡ on a listing to keep it here.</p></div>";

async function toggleHeart(btn) {
  var id = btn.getAttribute("data-save");
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  var on = !savedSet[id];
  if (on) savedSet[id] = 1; else delete savedSet[id];
  btn.classList.toggle("is-saved", on);
  btn.textContent = on ? "❤" : "♡";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (!on && state.type === "saved") {
    var card = btn.closest(".listing");
    if (card) card.remove();
    lastRows = lastRows.filter(function (r) { return r.id !== id; });
    var grid = document.getElementById("listings");
    if (grid && !grid.querySelector(".listing")) paintRows(lastRows, SAVED_EMPTY);
  }
  try { await toggleSave(id, on); }
  catch (e) {
    if (on) delete savedSet[id]; else savedSet[id] = 1;
    toast("Couldn't update saved listings.", { type: "error" });
    render(); // repaint the truth
  }
}
```

(`paintRows`'s second argument arrives in Task 5 Step 2 — Tasks 4 and 5 land together in review but commit separately; if executing strictly in order, the `SAVED_EMPTY` argument is simply ignored until Task 5 adds the parameter. JavaScript tolerates the extra argument — no breakage.)

- [ ] **Step 6: CSS** — after the `.fresh-pill` block:

```css
/* Save hearts on cards */
.listing__media { position: relative; }
.save-heart {
  position: absolute; top: 8px; right: 8px; z-index: 1;
  width: 36px; height: 36px; border-radius: var(--r-pill);
  border: 1px solid var(--border-2); background: rgba(8,10,16,.6); color: #fff;
  font-size: 17px; line-height: 1; cursor: pointer;
  display: grid; place-items: center; transition: transform .15s;
}
.save-heart:hover { transform: scale(1.08); }
.save-heart.is-saved { color: #ff5c7a; border-color: rgba(255,92,122,.45); }
.save-heart:active { transform: scale(1.18); }
@media (prefers-reduced-motion: reduce) { .save-heart, .save-heart:active, .save-heart:hover { transition: none; transform: none; } }
```

(Important: `.listing__media { position: relative; }` is added as a NEW rule next to the heart styles — do not edit the original media rule. The heart's z-index 1 sits above the stretched-link overlay at z-index 0, like the other in-card controls.)

- [ ] **Step 7: Verify.** Cache-bust + reload `feed.html?zip=70611&radius=50` logged-out: hearts visible on others' cards (♡), clicking one navigates to login. (Logged-in toggle verification happens in Task 6's E2E.) Heart does NOT trigger card navigation (click it — URL must stay on feed... it redirects to login when logged out, which proves the click was captured by the heart, not the stretched link). Screenshot a card with the heart.

- [ ] **Step 8: Commit**

```bash
git add assets/js/feed.js assets/css/main.css
git commit -m "feat: save hearts on feed cards (optimistic, login-gated)"
```

### Task 5: "❤ Saved" chip + saved render mode

**Files:**
- Modify: `pages/feed.html` (one line)
- Modify: `assets/js/feed.js`

- [ ] **Step 1: Chip.** In feed.html's chips row, after the "Looking to buy" chip line, add:

```html
        <button class="chip" data-filter="saved">❤ Saved</button>
```

- [ ] **Step 2: `paintRows` empty-state parameter.** Change the function signature and empty branch (feed.js:103-110):

```js
function paintRows(rows, emptyHTML) {
  var grid = document.getElementById("listings");
  if (!rows.length) {
    grid.innerHTML = emptyHTML ||
      '<div class="empty"><div class="em">🔍</div>' +
      "<p>Nothing here yet. Try widening your radius or clearing filters — " +
      'or <a href="post.html" style="color:var(--blue-600);font-weight:700">post what you need</a>.</p></div>';
    return;
  }
```
(Rest of the function unchanged.)

- [ ] **Step 3: Imports.** Add `savedListings` to the feed.js api.js import.

- [ ] **Step 4: Saved branch in `render()`.** Insert AFTER the `if (!grid.dataset.loaded) { ... }` block and BEFORE `var origin = await resolveZip(state.zip);`:

```js
  if (state.type === "saved") {
    var sRows;
    try { sRows = await savedListings(); }
    catch (e) {
      if (token !== renderToken) return;
      grid.innerHTML = '<div class="empty"><div class="em">⚠️</div>' +
        "<p>Couldn't load saved listings. Check your connection and try again.</p></div>";
      if (count) count.textContent = "";
      return;
    }
    if (token !== renderToken) return;
    sRows = sRows.filter(function (r) { return !deletedIds[r.id]; });
    lastRows = sRows;
    grid.dataset.loaded = "1";
    if (count) count.textContent = sRows.length + " saved listing" + (sRows.length === 1 ? "" : "s");
    paintRows(sRows, SAVED_EMPTY);
    writeFeedCache(sRows, count ? count.textContent : "");
    return;
  }
```

- [ ] **Step 5: URL whitelist.** In `readStateFromURL` change the type line to:

```js
  if (["sell", "buy", "saved"].indexOf(p.get("type")) !== -1) state.type = p.get("type");
```

- [ ] **Step 6: Login gate on the chip.** In the chip click handler, as the FIRST lines of the listener body:

```js
      if (chip.getAttribute("data-filter") === "saved" && !currentProfile) {
        go("pages/login.html?next=" + encodeURIComponent("/pages/feed.html?type=saved"));
        return;
      }
```

- [ ] **Step 7: Verify (logged-out parts).** Cache-bust + reload feed: fourth chip renders; clicking it logged-out redirects to login with the next param. Deep-link `feed.html?type=saved` logged-out: shows the saved-empty state ("Nothing saved yet") without errors — acceptable per spec. URL round-trip: select another chip → `?type=` updates.

- [ ] **Step 8: Commit**

```bash
git add pages/feed.html assets/js/feed.js
git commit -m "feat: Saved chip — saved-listings view on the feed"
```

### Task 6: Detail-page Save button + docs + full E2E

**Files:**
- Modify: `assets/js/listing.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Imports.** In listing.js, add `mySaves, toggleSave` to the api.js import list.

- [ ] **Step 2: Save button in `renderActions`.** In the others-branch (after the `var label = ...` line), change the innerHTML assignment to include a Save button between respond and report:

```js
  var label = row.type === "sell" ? "I'm interested" : "I have one";
  mount.innerHTML = '<button class="btn btn--primary" data-respond>' + label + "</button>" +
    (row.user_id ? '<button class="btn btn--ghost" data-save aria-pressed="false">♡ Save</button>' : "") +
    (row.user_id ? '<button class="btn btn--ghost" data-report>Report</button>' : "");
```

Then, after the existing report wiring, add:

```js
  var saveBtn = mount.querySelector("[data-save]");
  if (saveBtn) {
    var saved = false;
    var setSaved = function (on) {
      saved = on;
      saveBtn.textContent = on ? "❤ Saved" : "♡ Save";
      saveBtn.setAttribute("aria-pressed", on ? "true" : "false");
    };
    if (currentProfile) {
      mySaves().then(function (ids) { if (ids.indexOf(row.id) !== -1) setSaved(true); })
        .catch(function () { /* hearts optional */ });
    }
    saveBtn.addEventListener("click", async function () {
      if (!currentProfile) {
        go("pages/login.html?next=" + encodeURIComponent("/pages/listing.html?id=" + row.id));
        return;
      }
      setSaved(!saved);
      try { await toggleSave(row.id, saved); }
      catch (e) { setSaved(!saved); toast("Couldn't update saved listings.", { type: "error" }); }
    });
  }
```

- [ ] **Step 3: CLAUDE.md.** In the Backend/Supabase section, after the read-markers sentence in the write-protection bullet area, add a bullet:

```markdown
- **Saves (favorites)**: `saves` table (user_id+listing_id, owner-only RLS);
  hearts on feed cards + detail page, "❤ Saved" chip on the feed. `listings`
  is in the realtime publication — new posts surface as the feed's
  "Show N new" pill.
```

- [ ] **Step 4: Full logged-in E2E (controller may run this part).** Using a throwaway account in the preview (sign up via the page, e2e pattern): heart a listing on the feed (♡→❤ instantly, no error toast), open its detail page (button reads "❤ Saved"), un-save there, back to feed (heart cleared after reload), re-save, click the "❤ Saved" chip (the listing shows, count "1 saved listing"), un-heart inside the Saved view (card disappears, empty state appears), offline toggle (DevTools offline → heart reverts + error toast). Clean up: delete the test account's saves (un-save), sign out.

- [ ] **Step 5: Commit**

```bash
git add assets/js/listing.js CLAUDE.md
git commit -m "feat: save button on listing detail + project-map note"
```

---

## Final verification

- [ ] Pill E2E passed (Task 3 Step 7) including the negative-filter case, and test listings were cleaned up.
- [ ] Hearts state agrees across feed, detail, and the Saved view.
- [ ] `?type=saved` URL round-trip; saved-empty state; login gates on chip/heart/save-button.
- [ ] Dark-theme check at desktop + 390px: pill and hearts legible, screenshots taken.
- [ ] No console errors on feed/detail in any mode.

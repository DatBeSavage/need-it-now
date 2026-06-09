# Phase 3 — Reputation (eBay-style stars) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a conversation is marked "dealt", both parties can leave a one-time 1–5★ rating + comment; ratings aggregate onto each profile and show on profiles, listing cards, and the chat.

**Architecture:** New `ratings` table (one per rater per conversation) with RLS that only permits rating the *other* participant of a *dealt* conversation. A trigger keeps `profiles.rating_avg`/`rating_count` in sync. `nearby_listings` gains `owner_rating`/`owner_rating_count`. A shared `stars.js` renders the stars; chat gets a deal/rate bar; profiles and cards show the score.

**Tech Stack:** Static HTML/CSS/JS (ES modules), `@supabase/supabase-js@2`, Supabase Postgres + Auth.

**Verification model:** No JS test runner. Backend via live REST (curl + real JWT); UI in the preview with two browser profiles. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`. The `conversations.dealt_at` column and `conversations_update_party` policy already exist (from Phase 1).

---

## File structure
- **Modify** `supabase/schema.sql` — `ratings` table + RLS; `profiles.rating_avg`/`rating_count`; `recompute_rating` trigger; drop/recreate `nearby_listings` with `owner_rating`/`owner_rating_count`.
- **Modify** `assets/js/api.js` — `markDealt`, `createRating`, `getMyRating`, `ratingsForUser`; extend `getProfile` + `getProfileById` to include rating fields.
- **Create** `assets/js/stars.js` — `starsHTML` (full) + `starBadge` (compact).
- **Modify** `assets/js/chat.js` — a deal/rate bar in the chat modal.
- **Modify** `assets/js/profile.js` — rating in the slot + a reviews list.
- **Modify** `assets/js/feed.js` — compact owner rating on cards.
- **Modify** `assets/css/main.css` — stars, deal bar, rate form, reviews.

---

## Task 1: Schema — ratings, aggregate, RPC

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Add the rating columns to `profiles`** (next to avatar_path/bio)

```sql
alter table public.profiles add column if not exists rating_avg numeric(3,2) not null default 0;
alter table public.profiles add column if not exists rating_count int not null default 0;
```

- [ ] **Step 2: Add the `ratings` table + RLS + trigger** (append a new section, after the messages/conversations block)

```sql
-- ============================================================
-- Reputation: ratings  (Phase 3)
-- ============================================================
create table if not exists public.ratings (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  rater_id        uuid not null references public.profiles (id) on delete cascade,
  ratee_id        uuid not null references public.profiles (id) on delete cascade,
  stars           int  not null check (stars between 1 and 5),
  comment         text not null default '',
  created_at      timestamptz not null default now(),
  unique (conversation_id, rater_id)
);
create index if not exists ratings_ratee_idx on public.ratings (ratee_id, created_at desc);

alter table public.ratings enable row level security;

drop policy if exists "ratings_select_all"   on public.ratings;
drop policy if exists "ratings_insert_party" on public.ratings;
create policy "ratings_select_all" on public.ratings for select using (true);
create policy "ratings_insert_party" on public.ratings for insert with check (
  rater_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.dealt_at is not null
      and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
      and ratee_id = case when c.buyer_id = auth.uid() then c.owner_id else c.buyer_id end
  )
);

-- Keep profiles.rating_avg / rating_count in sync.
create or replace function public.recompute_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  target := coalesce(new.ratee_id, old.ratee_id);
  update public.profiles p set
    rating_count = (select count(*) from public.ratings r where r.ratee_id = target),
    rating_avg   = coalesce((select round(avg(r.stars)::numeric, 2) from public.ratings r where r.ratee_id = target), 0)
  where p.id = target;
  return null;
end; $$;
drop trigger if exists trg_recompute_rating on public.ratings;
create trigger trg_recompute_rating
  after insert or update or delete on public.ratings
  for each row execute function public.recompute_rating();
```

- [ ] **Step 3: Recreate `nearby_listings` with two rating columns**

Drop and recreate (return type changes again). Replace the current `nearby_listings` (the one returning `owner_avatar`) with:

```sql
drop function if exists public.nearby_listings(
  double precision, double precision, double precision, text, text);

create or replace function public.nearby_listings(
  origin_lat   double precision,
  origin_lng   double precision,
  radius_mi    double precision default 25,
  type_filter  text default 'all',
  q            text default ''
)
returns table (
  id uuid, user_id uuid, owner_name text, type text, title text, description text,
  price integer, category text, emoji text, zip text, lat double precision,
  lng double precision, response_count integer, created_at timestamptz,
  owner_avatar text, owner_rating numeric, owner_rating_count int, distance_mi double precision
)
language sql stable as $$
  select *
  from (
    select
      l.id, l.user_id, l.owner_name, l.type, l.title, l.description,
      l.price, l.category, l.emoji, l.zip, l.lat, l.lng,
      l.response_count, l.created_at,
      p.avatar_path as owner_avatar,
      p.rating_avg  as owner_rating,
      p.rating_count as owner_rating_count,
      case
        when l.lat is null or l.lng is null
          or origin_lat is null or origin_lng is null then null
        else 3958.8 * 2 * asin(sqrt(
          power(sin(radians(l.lat - origin_lat) / 2), 2)
          + cos(radians(origin_lat)) * cos(radians(l.lat))
          * power(sin(radians(l.lng - origin_lng) / 2), 2)
        ))
      end as distance_mi
    from public.listings l
    left join public.profiles p on p.id = l.user_id
    where (type_filter = 'all' or l.type = type_filter)
      and (
        coalesce(q, '') = ''
        or l.title ilike '%' || q || '%'
        or l.description ilike '%' || q || '%'
      )
  ) sub
  where sub.distance_mi is null or sub.distance_mi <= radius_mi
  order by sub.distance_mi asc nulls last, sub.created_at desc;
$$;

grant execute on function public.nearby_listings(
  double precision, double precision, double precision, text, text
) to anon, authenticated;
```

> Column order: `owner_avatar, owner_rating, owner_rating_count, distance_mi` — identical in the `returns table` and the inner select.

- [ ] **Step 4: User runs the updated `schema.sql`** (manual checkpoint). Expected "Success. No rows returned."

- [ ] **Step 5: Verify via REST** — two real accounts who already have a conversation (the buyer `neednow.verify917@gmail.com` and an owner account). Full flow:

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uidf () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
# owner posts a listing, buyer opens a conversation + sends a message
OT=$(tok neednow.owner01@gmail.com); OID=$(uidf "$OT")   # create this account first if needed (signup)
BT=$(tok neednow.verify917@gmail.com); BID=$(uidf "$BT")
LID=$(curl -s "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"user_id\":\"$OID\",\"owner_name\":\"Owner One\",\"type\":\"sell\",\"title\":\"Rate test\",\"description\":\"x\",\"price\":5,\"zip\":\"78701\",\"lat\":30.27,\"lng\":-97.74}" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
CID=$(curl -s "$BASE/rest/v1/conversations" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"listing_id\":\"$LID\",\"buyer_id\":\"$BID\",\"owner_id\":\"$OID\"}" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
# 1) rating BEFORE dealt is rejected
curl -s -o /dev/null -w "1) rate-before-dealt (want 4xx): HTTP %{http_code}\n" "$BASE/rest/v1/ratings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"conversation_id\":\"$CID\",\"rater_id\":\"$BID\",\"ratee_id\":\"$OID\",\"stars\":5}"
# 2) mark dealt (buyer is a participant)
curl -s -o /dev/null -w "2) mark dealt: HTTP %{http_code}\n" -X PATCH "$BASE/rest/v1/conversations?id=eq.$CID" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"dealt_at\":\"now()\"}"
# 3) buyer rates the owner
curl -s -o /dev/null -w "3) rate owner: HTTP %{http_code}\n" "$BASE/rest/v1/ratings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"conversation_id\":\"$CID\",\"rater_id\":\"$BID\",\"ratee_id\":\"$OID\",\"stars\":5,\"comment\":\"Great seller\"}"
# 4) aggregate updated on owner profile
echo -n "4) owner aggregate: "; curl -s "$BASE/rest/v1/profiles?id=eq.$OID&select=rating_avg,rating_count" -H "apikey: $KEY" -H "Authorization: Bearer $BT"; echo ""
# 5) cannot rate twice
curl -s -o /dev/null -w "5) double rate (want 409): HTTP %{http_code}\n" "$BASE/rest/v1/ratings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"conversation_id\":\"$CID\",\"rater_id\":\"$BID\",\"ratee_id\":\"$OID\",\"stars\":3}"
# 6) cannot rate yourself / wrong ratee
curl -s -o /dev/null -w "6) rate wrong ratee (want 4xx): HTTP %{http_code}\n" "$BASE/rest/v1/ratings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"conversation_id\":\"$CID\",\"rater_id\":\"$BID\",\"ratee_id\":\"$BID\",\"stars\":5}"
# cleanup
curl -s -o /dev/null -X DELETE "$BASE/rest/v1/listings?id=eq.$LID" -H "apikey: $KEY" -H "Authorization: Bearer $OT"
```

Expected: 1) 4xx (not dealt), 2) 204, 3) 201, 4) `rating_avg":5.00,"rating_count":1`, 5) 409 (unique), 6) 4xx (ratee must be the other party). Cleanup cascades the conversation + rating.

---

## Task 2: Rating API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Extend `getProfile`'s return** — add the two fields after `avatarUrl`:

```js
    rating_avg: (data && Number(data.rating_avg)) || 0,
    rating_count: (data && data.rating_count) || 0,
```

- [ ] **Step 2: Extend `getProfileById`'s select** to include the ratings:

```js
    .select("id,name,zip,bio,avatar_path,created_at,rating_avg,rating_count")
```

- [ ] **Step 3: Append rating functions** (after the Profiles & avatars section)

```js
/* ---------------- Reputation ---------------- */
export async function markDealt(conversationId) {
  const { data, error } = await supabase.from("conversations")
    .update({ dealt_at: new Date().toISOString() })
    .eq("id", conversationId).select("dealt_at").single();
  if (error) throw error;
  return data;
}

export async function getMyRating(conversationId) {
  const profile = await getProfile();
  if (!profile) return null;
  const { data } = await supabase.from("ratings")
    .select("stars,comment").eq("conversation_id", conversationId)
    .eq("rater_id", profile.id).maybeSingle();
  return data || null;
}

export async function createRating({ conversationId, rateeId, stars, comment }) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  const { error } = await supabase.from("ratings").insert({
    conversation_id: conversationId, rater_id: profile.id, ratee_id: rateeId,
    stars: stars, comment: (comment || "").trim(),
  });
  if (error) throw error;
}

export async function ratingsForUser(userId) {
  const { data, error } = await supabase.from("ratings")
    .select("stars,comment,created_at,rater:profiles!ratings_rater_id_fkey(name,avatar_path)")
    .eq("ratee_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 4: Verify** — preview console, logged in: `const m = await import("../assets/js/api.js"); console.log(await m.getProfile())` now shows `rating_avg`/`rating_count`. `await m.ratingsForUser((await m.getProfile()).id)` returns an array (no embed error; FK is `ratings_rater_id_fkey`).

---

## Task 3: Stars helper

**Files:** Create `assets/js/stars.js`

- [ ] **Step 1: Create `stars.js`**

```js
// Need-It-Now — star rating rendering.
export function starsHTML(avg, count, size) {
  size = size || "md";
  count = count || 0;
  if (!count) {
    return '<span class="stars stars--' + size + ' stars--empty">No ratings yet</span>';
  }
  var filled = Math.round(Number(avg));
  var s = "";
  for (var i = 1; i <= 5; i++) {
    s += '<span class="star' + (i <= filled ? " star--on" : "") + '">★</span>';
  }
  return '<span class="stars stars--' + size + '">' + s +
    '<span class="stars__num">' + Number(avg).toFixed(1) + " (" + count + ")</span></span>";
}

// Compact one-liner for tight spots (listing cards). Empty string if unrated.
export function starBadge(avg, count) {
  if (!count) return "";
  return '<span class="star-badge">★ ' + Number(avg).toFixed(1) + " (" + count + ")</span>";
}
```

- [ ] **Step 2: Verify** — `(await import("../assets/js/stars.js")).starsHTML(4.5, 12)` returns markup with four `star--on`; `starBadge(0,0)` returns `""`.

---

## Task 4: Chat deal/rate bar

**Files:** Modify `assets/js/chat.js`

- [ ] **Step 1: Imports** — add:

```js
import { getOrCreateConversation, getMessages, sendMessage, subscribeMessages, getProfile,
         markDealt, getMyRating, createRating } from "./api.js";
```

(Extends the existing `api.js` import; keep `avatarHTML` and `auth.js` imports.)

- [ ] **Step 2: Add a deal bar to the modal** — in `modal()`, insert between the log and the form:

```js
      '<div class="deal" data-deal></div>' +
```

- [ ] **Step 3: Render the deal/rate bar** — add these functions above `openPanel`:

```js
async function renderDeal(m, conv) {
  var bar = m.querySelector("[data-deal]");
  if (!conv || !conv.id) { bar.innerHTML = ""; return; }
  var otherId = conv.buyer_id === meId ? conv.owner_id : conv.buyer_id;
  if (!conv.dealt_at) {
    bar.innerHTML = '<span class="muted">Made a deal?</span>' +
      '<button class="btn btn--ghost btn--sm" data-mark>Mark as dealt</button>';
    bar.querySelector("[data-mark]").onclick = async function () {
      try { var d = await markDealt(conv.id); conv.dealt_at = d.dealt_at; renderDeal(m, conv); }
      catch (e) { toast("Couldn't mark as dealt."); }
    };
    return;
  }
  var mine = await getMyRating(conv.id);
  if (mine) {
    bar.innerHTML = '<span class="muted">You rated</span><span class="deal__rated">' +
      "★".repeat(mine.stars) + "</span>";
    return;
  }
  bar.innerHTML = '<span class="muted">Deal done —</span>' +
    '<button class="btn btn--ghost btn--sm" data-rate>Leave a rating</button>';
  bar.querySelector("[data-rate]").onclick = function () { showRateForm(m, conv, otherId); };
}

function showRateForm(m, conv, otherId) {
  var bar = m.querySelector("[data-deal]");
  var picked = 0;
  bar.innerHTML = '<div class="rate">' +
    '<div class="rate__stars" data-stars>' +
      [1, 2, 3, 4, 5].map(function (i) {
        return '<button type="button" class="star" data-v="' + i + '">★</button>';
      }).join("") + "</div>" +
    '<input class="input rate__msg" data-msg placeholder="Add a comment (optional)" maxlength="200" />' +
    '<button class="btn btn--primary btn--sm" data-submit>Submit</button></div>';
  var starsEl = bar.querySelector("[data-stars]");
  starsEl.querySelectorAll(".star").forEach(function (b) {
    b.onclick = function () {
      picked = +b.getAttribute("data-v");
      starsEl.querySelectorAll(".star").forEach(function (x) {
        x.classList.toggle("star--on", +x.getAttribute("data-v") <= picked);
      });
    };
  });
  bar.querySelector("[data-submit]").onclick = async function () {
    if (!picked) { toast("Pick a star rating."); return; }
    try {
      await createRating({ conversationId: conv.id, rateeId: otherId, stars: picked,
        comment: bar.querySelector("[data-msg]").value });
      toast("Thanks for the rating!");
      renderDeal(m, conv);
    } catch (e) { toast((e && e.message) || "Couldn't submit rating."); }
  };
}
```

- [ ] **Step 4: Call `renderDeal` when a conversation is in play** — in `openPanel`, after the `if (conv) { … listen(log, conv.id); }` block, add:

```js
  renderDeal(m, conv);
```

And inside the form `onsubmit`, right after the lazy-create line `conv = await getOrCreateConversation(opts.listing); listen(log, conv.id);`, add:

```js
        renderDeal(m, conv);
```

(So the bar appears once a brand-new conversation exists.)

- [ ] **Step 5: Verify** in the preview (two profiles): open an existing thread → "Mark as dealt" → bar switches to "Leave a rating" → pick stars + comment → Submit → bar shows "You rated ★★★★★". The other party, opening the same thread, can also mark/rate independently. Re-opening shows the rated state.

---

## Task 5: Ratings on the profile page

**Files:** Modify `assets/js/profile.js`

- [ ] **Step 1: Imports** — add:

```js
import { getProfile, getProfileById, updateProfile, uploadAvatar, listingsByUser, ratingsForUser } from "./api.js";
import { starsHTML } from "./stars.js";
import { avatarHTML } from "./avatar.js";
```

(Extend the existing `api.js` import line; keep the others.)

- [ ] **Step 2: Replace `renderPublic` entirely** with this version (fills the rating slot, adds a reviews section):

```js
async function renderPublic(root, p) {
  var coord = await resolveZip(p.zip);
  var loc = coord ? coord.city : (p.zip || "");
  root.innerHTML =
    '<div class="profile-head card">' +
      avatarHTML(p, "lg") +
      '<div><h1 class="profile-name">' + esc(p.name) + "</h1>" +
        '<p class="muted">' + esc(loc) + (loc ? " · " : "") + "Member since " + monthYear(p.created_at) + "</p>" +
        (p.bio ? '<p class="profile-bio">' + esc(p.bio) + "</p>" : "") +
        '<div class="profile-rating">' + starsHTML(p.rating_avg, p.rating_count, "md") + "</div>" +
      "</div>" +
    "</div>" +
    '<h2 class="profile-sub">Listings</h2><div class="minis" data-listings></div>' +
    '<h2 class="profile-sub">Reviews</h2><div class="reviews" data-reviews></div>';
  renderListings(root.querySelector("[data-listings]"), p.id, false);
  renderReviews(root.querySelector("[data-reviews]"), p.id);
}
```

- [ ] **Step 3: Add the `renderReviews` helper** (near `renderListings`)

```js
async function renderReviews(box, userId) {
  var rows = [];
  try { rows = await ratingsForUser(userId); } catch (e) { /* leave empty */ }
  if (!rows.length) { box.innerHTML = '<p class="muted">No reviews yet.</p>'; return; }
  box.innerHTML = rows.map(function (r) {
    var who = (r.rater && r.rater.name) || "Neighbor";
    return '<div class="review">' +
      avatarHTML({ name: who, avatar_path: r.rater && r.rater.avatar_path }, "sm") +
      '<div class="review__body"><div class="review__top"><strong>' + esc(who) + "</strong>" +
        '<span class="review__stars">' + "★".repeat(r.stars) + "</span></div>" +
        (r.comment ? '<p class="review__text">' + esc(r.comment) + "</p>" : "") +
      "</div></div>";
  }).join("");
}
```

- [ ] **Step 4: Show your own score on the edit view** — in `renderOwn`, change the heading line to include the score:

```js
    '<h1 class="profile-name" style="margin-bottom:var(--sp-2)">Your profile</h1>' +
    '<div class="profile-rating" style="margin-bottom:var(--sp-4)">' + starsHTML(me.rating_avg, me.rating_count, "md") + "</div>" +
```

- [ ] **Step 5: Verify** — a user who has received a rating shows ★ + count on their public profile and a Reviews list with the rater's avatar/name/stars/comment; an unrated user shows "No ratings yet" / "No reviews yet."

---

## Task 6: Owner rating on listing cards

**Files:** Modify `assets/js/feed.js`

- [ ] **Step 1: Import** — add:

```js
import { starBadge } from "./stars.js";
```

- [ ] **Step 2: Show the badge by the owner name** — in `cardHTML`, inside the owner cell IIFE, append the badge to `inner`:

```js
            var inner = avatarHTML(person, "sm") + "<span>" + escapeHTML(row.owner_name) + "</span>" +
              starBadge(row.owner_rating, row.owner_rating_count);
```

- [ ] **Step 3: Verify** — listing cards whose owner has ratings show `★ 4.8 (12)` next to the name; owners with no ratings (and demo listings) show no badge.

---

## Task 7: Styles

**Files:** Modify `assets/css/main.css`

- [ ] **Step 1: Append rating styles**

```css
/* ---- Stars / ratings ---- */
.stars { display: inline-flex; align-items: center; gap: 1px; }
.stars .star { color: var(--border-2); line-height: 1; }
.stars .star--on { color: #f5a623; }
.stars--sm { font-size: var(--fs-sm); }
.stars--md { font-size: var(--fs-md); }
.stars__num { margin-left: var(--sp-2); color: var(--muted); font-size: var(--fs-sm); font-weight: 600; }
.stars--empty { color: var(--muted); font-size: var(--fs-sm); }
.star-badge { margin-left: var(--sp-2); color: #b07400; font-weight: 700; font-size: var(--fs-xs);
  background: #fff6e6; border-radius: var(--r-pill); padding: 1px 8px; white-space: nowrap; }
.profile-rating { margin-top: var(--sp-2); }

/* deal / rate bar in chat */
.deal { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap;
  padding: var(--sp-2) var(--sp-3); border-top: 1px solid var(--border); background: var(--surface-2);
  font-size: var(--fs-sm); }
.deal:empty { display: none; }
.deal__rated { color: #f5a623; letter-spacing: 1px; }
.rate { display: flex; align-items: center; gap: var(--sp-2); width: 100%; flex-wrap: wrap; }
.rate__stars { display: inline-flex; }
.rate__stars .star { background: none; border: 0; cursor: pointer; font-size: 1.25rem;
  color: var(--border-2); line-height: 1; padding: 0 1px; }
.rate__stars .star--on { color: #f5a623; }
.rate__msg { flex: 1; min-width: 140px; padding: .4rem .6rem; }

/* reviews list on profile */
.reviews { display: flex; flex-direction: column; gap: var(--sp-3); }
.review { display: flex; gap: var(--sp-3); }
.review__top { display: flex; align-items: center; gap: var(--sp-2); }
.review__stars { color: #f5a623; letter-spacing: 1px; font-size: var(--fs-sm); }
.review__text { color: var(--ink-2); margin-top: 2px; max-width: 60ch; }
```

- [ ] **Step 2: Verify** — stars are gold/empty correctly; the deal bar sits above the chat input and hides when empty; the star picker highlights on click; the card badge and reviews list read cleanly on desktop and a 375px viewport.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/stars.js assets/js/chat.js \
        assets/js/profile.js assets/js/feed.js assets/css/main.css docs/superpowers/
git commit -m "feat: reputation — mark-as-dealt + star ratings on profiles and cards"
```

---

## Notes for the implementer
- `conversations.dealt_at` + `conversations_update_party` already exist (Phase 1), so `markDealt` is a plain update.
- The ratings embed FK is `ratings_rater_id_fkey` (default name for `rater_id references profiles`).
- RLS does the real enforcement (dealt + correct ratee + one-per-convo); the UI just guides.
- `starBadge` returns `""` for unrated owners, so cards stay clean.
- Don't pre-resolve `Date.now()` concerns — this is app code, not a Workflow script; `new Date().toISOString()` in `markDealt` is fine.

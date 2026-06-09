# Admin Increment C — User Management (bans) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can ban (suspend) a user — DB-enforced so the user can't post, start chats, send messages, or rate — and unban them, from the Users tab.

**Architecture:** A locked-down `banned_users` table + a `security definer` `is_banned()` helper added to the `with check` of the four participation insert policies. Admin-only API + Users-tab buttons.

**Tech Stack:** Static HTML/CSS/JS (ES modules), Supabase Postgres + Auth (RLS).

**Verification model:** No JS test runner. RLS via live REST (admin + banned non-admin tokens); UI in the preview. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`. Admin: `neednow.verify917@gmail.com`; ban target: `neednow.third01@gmail.com` (password `test123456`).

---

## File structure
- **Modify** `supabase/schema.sql` — `banned_users` + `is_banned()` + policies + recreate `listings_insert_own` with ban check; add `and not public.is_banned()` to the conversations/messages/ratings insert checks.
- **Modify** `assets/js/api.js` — `banUser`, `unbanUser`, `adminListBanned`.
- **Modify** `assets/js/admin.js` — Users tab Ban/Unban + Banned badge.
- **Modify** `assets/css/main.css` — `.status--banned`.

---

## Task 1: Schema — ban identity + enforcement

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Add the ban block** immediately AFTER the admins block (right after the line `-- NO insert/update/delete policies: only the SQL Editor (service role) can add admins.`):

```sql

-- ============================================================
-- Ban identity  (Admin Increment C)
-- ============================================================
create table if not exists public.banned_users (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_banned()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.banned_users where user_id = auth.uid());
$$;

alter table public.banned_users enable row level security;
drop policy if exists "banned_select_admin" on public.banned_users;
drop policy if exists "banned_insert_admin" on public.banned_users;
drop policy if exists "banned_delete_admin" on public.banned_users;
create policy "banned_select_admin" on public.banned_users for select using (public.is_admin());
create policy "banned_insert_admin" on public.banned_users for insert with check (public.is_admin());
create policy "banned_delete_admin" on public.banned_users for delete using (public.is_admin());

-- Re-create the listings insert policy WITH the ban check (its original definition
-- sits earlier in the file, before is_banned() exists).
drop policy if exists "listings_insert_own" on public.listings;
create policy "listings_insert_own" on public.listings for insert
  with check (auth.uid() = user_id and not public.is_banned());
```

- [ ] **Step 2: Ban-check on conversation inserts** — replace the existing `conversations_insert_buyer` `with check (...)` body in place:

Find:
```sql
  with check (
    auth.uid() = buyer_id
    and buyer_id <> owner_id
    and owner_id = (select l.user_id from public.listings l where l.id = listing_id)
  );
```
Replace with:
```sql
  with check (
    auth.uid() = buyer_id
    and buyer_id <> owner_id
    and owner_id = (select l.user_id from public.listings l where l.id = listing_id)
    and not public.is_banned()
  );
```

- [ ] **Step 3: Ban-check on message inserts** — in `messages_insert_party`, add the ban check. Find:
```sql
  with check (
    sender_id = auth.uid()
    and exists (
```
Replace with:
```sql
  with check (
    sender_id = auth.uid()
    and not public.is_banned()
    and exists (
```

- [ ] **Step 4: Ban-check on rating inserts** — in `ratings_insert_party`, find:
```sql
create policy "ratings_insert_party" on public.ratings for insert with check (
  rater_id = auth.uid()
  and exists (
```
Replace with:
```sql
create policy "ratings_insert_party" on public.ratings for insert with check (
  rater_id = auth.uid()
  and not public.is_banned()
  and exists (
```

- [ ] **Step 5: User runs the updated `schema.sql`** (manual checkpoint). Expected "Success."

- [ ] **Step 6: Verify via REST**

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uidf () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
AT=$(tok neednow.verify917@gmail.com)
BT=$(tok neednow.third01@gmail.com); BID=$(uidf "$BT")   # ban target
# baseline: target can post
L1=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"user_id\":\"$BID\",\"owner_name\":\"Third\",\"type\":\"sell\",\"title\":\"pre-ban\",\"description\":\"x\",\"price\":1,\"zip\":\"78704\",\"lat\":30.24,\"lng\":-97.77}")
echo "pre-ban post (want 201): $L1"
# non-admin cannot ban
curl -s -o /dev/null -w "non-admin ban attempt (want 4xx): %{http_code}\n" "$BASE/rest/v1/banned_users" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"user_id\":\"$BID\"}"
# admin bans the target
curl -s -o /dev/null -w "admin ban: %{http_code}\n" "$BASE/rest/v1/banned_users" -H "apikey: $KEY" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d "{\"user_id\":\"$BID\",\"reason\":\"test\"}"
# banned target can no longer post / message
echo "post-ban post (want 4xx): $(curl -s -o /dev/null -w '%{http_code}' "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"user_id\":\"$BID\",\"owner_name\":\"Third\",\"type\":\"sell\",\"title\":\"post-ban\",\"description\":\"x\",\"price\":1,\"zip\":\"78704\",\"lat\":30.24,\"lng\":-97.77}")"
# banned target can still READ the feed
echo -n "banned can still browse (want array): "; curl -s -X POST "$BASE/rest/v1/rpc/nearby_listings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d '{"origin_lat":30.27,"origin_lng":-97.74,"radius_mi":25,"type_filter":"all","q":""}' | head -c 20; echo ""
# banned target cannot read banned_users
echo -n "banned reads banned_users (want []): "; curl -s "$BASE/rest/v1/banned_users?select=user_id" -H "apikey: $KEY" -H "Authorization: Bearer $BT"; echo ""
# admin unbans
curl -s -o /dev/null -w "admin unban: %{http_code}\n" -X DELETE "$BASE/rest/v1/banned_users?user_id=eq.$BID" -H "apikey: $KEY" -H "Authorization: Bearer $AT"
echo "post-unban post (want 201): $(curl -s -o /dev/null -w '%{http_code}' "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"user_id\":\"$BID\",\"owner_name\":\"Third\",\"type\":\"sell\",\"title\":\"post-unban\",\"description\":\"x\",\"price\":1,\"zip\":\"78704\",\"lat\":30.24,\"lng\":-97.77}")"
# cleanup the target's test listings
curl -s -o /dev/null -X DELETE "$BASE/rest/v1/listings?user_id=eq.$BID" -H "apikey: $KEY" -H "Authorization: Bearer $BT"
echo "cleanup done"
```

Expected: pre-ban 201; non-admin ban 4xx; admin ban 201; post-ban **4xx**; banned can still browse (array); banned reads banned_users `[]`; unban 204; post-unban **201**.

---

## Task 2: Ban API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Append** (after `adminDeleteListing`)

```js
export async function banUser(userId, reason) {
  const { error } = await supabase.from("banned_users").insert({ user_id: userId, reason: (reason || "").trim() });
  if (error) throw error;
}

export async function unbanUser(userId) {
  const { error } = await supabase.from("banned_users").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function adminListBanned() {
  const { data, error } = await supabase.from("banned_users").select("user_id,reason");
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Verify** — preview console as admin: `typeof (await import("../assets/js/api.js")).banUser` → `"function"`; `await m.adminListBanned()` returns an array.

---

## Task 3: Users tab Ban/Unban

**Files:** Modify `assets/js/admin.js`

- [ ] **Step 1: Extend imports + add a module `meId`**

Change the api.js import to also bring in the ban functions and `getProfile`:
```js
import { amIAdmin, adminListReports, adminListUsers, adminListListings, adminGetConversation,
         setReportStatus, setListingHidden, adminDeleteListing,
         banUser, unbanUser, adminListBanned, getProfile } from "./api.js";
```
Add a module-level variable near the top (after the imports):
```js
var meId = null;
```

- [ ] **Step 2: Replace `renderUsers` entirely**

```js
async function renderUsers(panel) {
  panel.innerHTML = '<p class="muted">Loading users…</p>';
  var users = await adminListUsers();
  var listings = [];
  try { listings = await adminListListings(); } catch (e) { /* */ }
  var banned = [];
  try { banned = await adminListBanned(); } catch (e) { /* */ }
  var bannedSet = {};
  banned.forEach(function (b) { bannedSet[b.user_id] = true; });
  var counts = {};
  listings.forEach(function (l) { if (l.user_id) counts[l.user_id] = (counts[l.user_id] || 0) + 1; });
  if (!users.length) { panel.innerHTML = '<p class="muted">No users.</p>'; return; }
  var parts = await Promise.all(users.map(async function (u) {
    var coord = await resolveZip(u.zip);
    var loc = coord ? coord.city : (u.zip || "");
    var n = counts[u.id] || 0;
    var isBanned = !!bannedSet[u.id];
    var btn = (u.id === meId) ? '<span class="muted">you</span>'
      : (isBanned
          ? '<button class="btn btn--ghost btn--sm" data-unban="' + u.id + '">Unban</button>'
          : '<button class="btn btn--ghost btn--sm" data-ban="' + u.id + '">Ban</button>');
    return '<div class="admin-row' + (isBanned ? " admin-row--done" : "") + '">' + avatarHTML(u, "md") +
      '<div class="admin-row__main">' +
        '<div><a href="profile.html?u=' + u.id + '"><strong>' + esc(u.name) + "</strong></a> " +
          starBadge(u.rating_avg, u.rating_count) +
          (isBanned ? ' <span class="status status--banned">banned</span>' : "") + "</div>" +
        '<div class="admin-meta muted">' + esc(loc) + " · joined " + monthYear(u.created_at) +
          " · " + n + " listing" + (n === 1 ? "" : "s") + "</div>" +
        '<div class="admin-meta">' + btn + "</div>" +
      "</div></div>";
  }));
  panel.innerHTML = parts.join("");
  panel.querySelectorAll("[data-ban]").forEach(function (b) {
    b.addEventListener("click", async function () {
      var reason = window.prompt("Reason for banning (optional):", "");
      if (reason === null) return;
      try { await banUser(b.getAttribute("data-ban"), reason); renderUsers(panel); }
      catch (e) { toast("Couldn't ban user."); }
    });
  });
  panel.querySelectorAll("[data-unban]").forEach(function (b) {
    b.addEventListener("click", async function () {
      try { await unbanUser(b.getAttribute("data-unban")); renderUsers(panel); }
      catch (e) { toast("Couldn't unban user."); }
    });
  });
}
```

- [ ] **Step 3: Set `meId` in the gate** — in the `DOMContentLoaded` handler, after the `amIAdmin()` gate passes, add:

```js
  try { var me = await getProfile(); meId = me && me.id; } catch (e) { /* */ }
```

(Place it right after `if (!(await amIAdmin())) { go("pages/feed.html"); return; }` and before wiring the tabs.)

- [ ] **Step 4: Verify** — Users tab shows a Ban button per user (your own row shows "you"); banning prompts for a reason, adds a "banned" badge + dims the row, and flips the button to Unban; the banned account can't post in the preview; unban restores it.

---

## Task 4: Styles

**Files:** Modify `assets/css/main.css`

- [ ] **Step 1: Append**

```css
.status--banned { background: #fde8e8; color: var(--danger); }
```

- [ ] **Step 2: Verify** — the banned badge is red-tinted and distinct from open/resolved/dismissed; banned rows dim via `.admin-row--done`.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/admin.js assets/css/main.css docs/superpowers/
git commit -m "feat: admin user management — ban/suspend users (DB-enforced)"
```

---

## Notes for the implementer
- `is_banned()` must be `security definer` (reads `banned_users` past its admin-only RLS, and is used inside insert policies).
- `banned_users` has only admin policies — banned users cannot self-unban or even read the list.
- The four participation inserts now require `not public.is_banned()`; reporting is intentionally NOT ban-gated.
- `listings_insert_own` is dropped+recreated inside the ban block because its original definition precedes `is_banned()` in the file. Leave the original line alone — the ban block supersedes it on every run.

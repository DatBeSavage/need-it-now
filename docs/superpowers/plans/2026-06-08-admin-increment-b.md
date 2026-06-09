# Admin Increment B — Content Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can resolve/dismiss reports and hide or delete any listing from the dashboard; hidden listings drop out of the public feed.

**Architecture:** Two new columns (`reports.status`, `listings.hidden`), an admin update policy on `reports`, admin-extended update/delete policies on `listings`, and a `not hidden` filter in `nearby_listings`. Dashboard gains action buttons. RLS enforces everything.

**Tech Stack:** Static HTML/CSS/JS (ES modules), Supabase Postgres + Auth (RLS).

**Verification model:** No JS test runner. RLS via live REST (admin + non-admin tokens); UI in the preview. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`. Admin account: `neednow.verify917@gmail.com`; non-admin: `neednow.owner01@gmail.com` (password `test123456`).

---

## File structure
- **Modify** `supabase/schema.sql` — `reports.status`, `listings.hidden`, `reports_update_admin`, admin-extend `listings_update_own`/`listings_delete_own`, add `and not l.hidden` to `nearby_listings`.
- **Modify** `assets/js/api.js` — `setReportStatus`, `setListingHidden`, `adminDeleteListing`; add `hidden` to `adminListListings` select.
- **Modify** `assets/js/admin.js` — action buttons in Reports + Listings tabs.
- **Modify** `assets/css/main.css` — status badges + dimmed rows.

---

## Task 1: Schema — moderation columns, policies, feed filter

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Add the columns** — `reports.status` next to the reports table, `listings.hidden` next to the listings columns (near the top alters):

```sql
alter table public.reports  add column if not exists status text not null default 'open'
  check (status in ('open','resolved','dismissed'));
alter table public.listings add column if not exists hidden boolean not null default false;
```

- [ ] **Step 2: Admin can update reports** — add this policy in the reports section (after `reports_select_own`):

```sql
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports for update
  using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 3: Admin-extend the listings update/delete policies** — replace the existing two policies IN PLACE:

```sql
drop policy if exists "listings_update_own" on public.listings;
create policy "listings_update_own" on public.listings for update
  using (auth.uid() = user_id or public.is_admin());
drop policy if exists "listings_delete_own" on public.listings;
create policy "listings_delete_own" on public.listings for delete
  using (auth.uid() = user_id or public.is_admin());
```

- [ ] **Step 4: Hide hidden listings from the feed** — in the `nearby_listings` inner `select`'s WHERE clause, add `and not l.hidden`:

```sql
    from public.listings l
    left join public.profiles p on p.id = l.user_id
    where (type_filter = 'all' or l.type = type_filter)
      and not l.hidden
      and (
        coalesce(q, '') = ''
        or l.title ilike '%' || q || '%'
        or l.description ilike '%' || q || '%'
      )
```

(Return type is unchanged, so this stays a plain `create or replace function` — no drop needed. Edit the existing function body in place.)

- [ ] **Step 5: User runs the updated `schema.sql`** (manual checkpoint). Expected "Success."

- [ ] **Step 6: Verify via REST**

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uidf () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
AT=$(tok neednow.verify917@gmail.com)            # admin
OT=$(tok neednow.owner01@gmail.com); OID=$(uidf "$OT")   # owns a listing; non-admin
# admin resolves the leftover test report
RID=$(curl -s "$BASE/rest/v1/reports?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
curl -s -o /dev/null -w "admin resolve report: %{http_code}\n" -X PATCH "$BASE/rest/v1/reports?id=eq.$RID" -H "apikey: $KEY" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d '{"status":"resolved"}'
echo -n "report status now: "; curl -s "$BASE/rest/v1/reports?select=status&id=eq.$RID" -H "apikey: $KEY" -H "Authorization: Bearer $AT"; echo ""
# owner posts a listing; admin hides it; confirm gone from feed but visible in table
LID=$(curl -s "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"user_id\":\"$OID\",\"owner_name\":\"Owner One\",\"type\":\"sell\",\"title\":\"HideMe ZZZ\",\"description\":\"x\",\"price\":5,\"zip\":\"78701\",\"lat\":30.27,\"lng\":-97.74}" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
curl -s -o /dev/null -w "admin hide listing: %{http_code}\n" -X PATCH "$BASE/rest/v1/listings?id=eq.$LID" -H "apikey: $KEY" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d '{"hidden":true}'
echo -n "feed RPC finds HideMe (want 0): "; curl -s -X POST "$BASE/rest/v1/rpc/nearby_listings" -H "apikey: $KEY" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d '{"origin_lat":30.27,"origin_lng":-97.74,"radius_mi":25,"type_filter":"all","q":"HideMe"}' | grep -oc 'HideMe'
echo -n "admin table still sees HideMe (want 1): "; curl -s "$BASE/rest/v1/listings?select=title&id=eq.$LID" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | grep -oc 'HideMe'
# non-admin cannot hide someone else's listing (use admin's own? owner can hide own — test a FOREIGN one): non-admin tries to hide a listing they don't own → 0 rows affected
curl -s -o /dev/null -w "admin delete listing: %{http_code}\n" -X DELETE "$BASE/rest/v1/listings?id=eq.$LID" -H "apikey: $KEY" -H "Authorization: Bearer $AT"
```

Expected: resolve → 204, status `resolved`; hide → 204; feed finds **0** HideMe; admin table finds **1**; delete → 204.

---

## Task 2: Moderation API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Add `hidden` to `adminListListings`'s select**:

```js
    .select("id,user_id,owner_name,type,title,price,zip,emoji,hidden,created_at")
```

- [ ] **Step 2: Append the moderation functions** (after `adminGetConversation`)

```js
export async function setReportStatus(reportId, status) {
  const { error } = await supabase.from("reports").update({ status: status }).eq("id", reportId);
  if (error) throw error;
}

export async function setListingHidden(listingId, hidden) {
  const { error } = await supabase.from("listings").update({ hidden: hidden }).eq("id", listingId);
  if (error) throw error;
}

export async function adminDeleteListing(listingId) {
  const { error } = await supabase.from("listings").delete().eq("id", listingId);
  if (error) throw error;
}
```

- [ ] **Step 3: Verify** — preview console as admin: `const m = await import("../assets/js/api.js");` then `typeof m.setReportStatus` / `m.setListingHidden` / `m.adminDeleteListing` are all `"function"`.

---

## Task 3: Dashboard actions

**Files:** Modify `assets/js/admin.js`

- [ ] **Step 1: Extend the imports**

```js
import { amIAdmin, adminListReports, adminListUsers, adminListListings, adminGetConversation,
         setReportStatus, setListingHidden, adminDeleteListing } from "./api.js";
import { go, toast } from "./auth.js";
```

(The other imports — `avatarHTML`, `resolveZip`, `starBadge` — stay.)

- [ ] **Step 2: Replace `renderReports` entirely**

```js
async function renderReports(panel) {
  panel.innerHTML = '<p class="muted">Loading reports…</p>';
  var rows = await adminListReports();
  if (!rows.length) { panel.innerHTML = '<p class="muted">No reports yet.</p>'; return; }
  panel.innerHTML = rows.map(function (r) {
    var reporter = (r.reporter && r.reporter.name) || "Someone";
    var reported = (r.reported && r.reported.name) || "user";
    var status = r.status || "open";
    var ctx = "";
    if (r.listing) ctx += '<span class="muted">Listing: ' + esc(r.listing.title) + "</span>";
    if (r.conversation_id) ctx += '<button class="btn btn--ghost btn--sm" data-chat="' + r.conversation_id + '">View chat</button>';
    var actions = status === "open"
      ? '<button class="btn btn--ghost btn--sm" data-resolve="' + r.id + '">Resolve</button>' +
        '<button class="btn btn--ghost btn--sm" data-dismiss="' + r.id + '">Dismiss</button>'
      : "";
    return '<div class="admin-row' + (status !== "open" ? " admin-row--done" : "") + '"><div class="admin-row__main">' +
      "<div><strong>" + esc(reporter) + "</strong> reported " +
        '<a href="profile.html?u=' + r.reported_user_id + '"><strong>' + esc(reported) + "</strong></a> " +
        '<span class="badge badge--buy">' + esc(r.reason) + "</span> " +
        '<span class="status status--' + status + '">' + status + "</span></div>" +
      (r.details ? '<p class="muted">' + esc(r.details) + "</p>" : "") +
      '<div class="admin-meta">' + ctx + actions + '<span class="muted">' + dateShort(r.created_at) + "</span></div>" +
      '<div class="admin-chat" data-chatbox="' + (r.conversation_id || "") + '" hidden></div>' +
      "</div></div>";
  }).join("");

  panel.querySelectorAll("[data-chat]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var id = btn.getAttribute("data-chat");
      var box = panel.querySelector('[data-chatbox="' + id + '"]');
      if (!box) return;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = '<p class="muted">Loading…</p>';
      try {
        var msgs = await adminGetConversation(id);
        box.innerHTML = msgs.length
          ? msgs.map(function (m) { return '<div class="admin-msg"><strong>' + esc(m.sender_name) + ":</strong> " + esc(m.body) + "</div>"; }).join("")
          : '<p class="muted">No messages.</p>';
      } catch (e) { box.innerHTML = '<p class="muted">Couldn\'t load chat.</p>'; }
    });
  });
  panel.querySelectorAll("[data-resolve]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try { await setReportStatus(btn.getAttribute("data-resolve"), "resolved"); renderReports(panel); }
      catch (e) { toast("Couldn't update report."); }
    });
  });
  panel.querySelectorAll("[data-dismiss]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try { await setReportStatus(btn.getAttribute("data-dismiss"), "dismissed"); renderReports(panel); }
      catch (e) { toast("Couldn't update report."); }
    });
  });
}
```

- [ ] **Step 3: Replace `renderListings` entirely**

```js
async function renderListings(panel) {
  panel.innerHTML = '<p class="muted">Loading listings…</p>';
  var rows = await adminListListings();
  if (!rows.length) { panel.innerHTML = '<p class="muted">No listings.</p>'; return; }
  panel.innerHTML = rows.map(function (l) {
    var owner = l.user_id
      ? '<a href="profile.html?u=' + l.user_id + '">' + esc(l.owner_name) + "</a>"
      : esc(l.owner_name) + " (demo)";
    return '<div class="admin-row' + (l.hidden ? " admin-row--done" : "") + '">' +
      '<span class="admin-emoji">' + (l.emoji || "📦") + "</span>" +
      '<div class="admin-row__main">' +
        "<div><strong>" + esc(l.title) + "</strong> · " +
          (l.type === "sell" ? money(l.price) : "Budget " + money(l.price)) +
          (l.hidden ? ' <span class="status status--dismissed">hidden</span>' : "") + "</div>" +
        '<div class="admin-meta muted">' + owner + " · " + esc(l.zip || "") + " · " + dateShort(l.created_at) + "</div>" +
        '<div class="admin-meta">' +
          '<button class="btn btn--ghost btn--sm" data-hide="' + l.id + '" data-h="' + (l.hidden ? "1" : "0") + '">' +
            (l.hidden ? "Unhide" : "Hide") + "</button>" +
          '<button class="btn btn--ghost btn--sm" data-del="' + l.id + '">Delete</button>' +
        "</div>" +
      "</div></div>";
  }).join("");
  panel.querySelectorAll("[data-hide]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try { await setListingHidden(btn.getAttribute("data-hide"), btn.getAttribute("data-h") !== "1"); renderListings(panel); }
      catch (e) { toast("Couldn't update listing."); }
    });
  });
  panel.querySelectorAll("[data-del]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (!window.confirm("Delete this listing permanently?")) return;
      try { await adminDeleteListing(btn.getAttribute("data-del")); renderListings(panel); }
      catch (e) { toast("Couldn't delete listing."); }
    });
  });
}
```

- [ ] **Step 4: Verify** — admin Reports tab shows status badges with Resolve/Dismiss that update + dim the row; Listings tab Hide/Unhide toggles (hidden ones marked + dropped from the feed) and Delete removes with a confirm.

---

## Task 4: Styles

**Files:** Modify `assets/css/main.css`

- [ ] **Step 1: Append**

```css
/* ---- Admin moderation ---- */
.status { font-size: var(--fs-xs); font-weight: 800; padding: 1px 8px; border-radius: var(--r-pill); text-transform: capitalize; }
.status--open { background: var(--blue-050); color: var(--blue-700); }
.status--resolved { background: var(--green-050); color: var(--green-700); }
.status--dismissed { background: var(--surface-2); color: var(--muted); }
.admin-row--done { opacity: .62; }
```

- [ ] **Step 2: Verify** — open/resolved/dismissed badges read clearly; resolved/dismissed reports and hidden listings dim; actions still tappable on a 375px viewport.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/admin.js assets/css/main.css docs/superpowers/
git commit -m "feat: admin moderation — resolve/dismiss reports, hide/delete listings"
```

---

## Notes for the implementer
- `listings_update_own`'s implicit check becomes `auth.uid() = user_id or is_admin()` (no separate `with check`), so an admin updating a foreign listing passes (new row keeps the original owner; `is_admin()` is true).
- `nearby_listings` return type is unchanged — keep it `create or replace`, do NOT drop it.
- `setListingHidden`/`adminDeleteListing` also work for an owner on their *own* listing (owner path in the same policies); admin powers come from `is_admin()`.
- `toast` is exported by `auth.js`; `admin.js` now imports it alongside `go`.

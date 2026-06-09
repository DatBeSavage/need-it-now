# Admin Increment A — Identity + Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-self-grantable admin role and a gated, read-only dashboard where an admin can monitor all reports, users, listings, and the contents of any private conversation.

**Architecture:** A locked-down `admins` table (no write policies) + a `security definer` `is_admin()` helper wired into RLS so admins can read everything. A gated `pages/admin.html` with Reports/Users/Listings tabs. Authorization is enforced in the database; the UI only hides itself.

**Tech Stack:** Static HTML/CSS/JS (ES modules), `@supabase/supabase-js@2`, Supabase Postgres + Auth (RLS).

**Verification model:** No JS test runner. RLS verified via live REST with BOTH a non-admin and an admin token (admin requires the user to run the bootstrap). UI verified in the preview. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`.

---

## File structure
- **Modify** `supabase/schema.sql` — `admins` table, `is_admin()`, `admins_select`; add `or public.is_admin()` to the SELECT policies of `reports`, `conversations`, `messages`.
- **Modify** `assets/js/api.js` — `amIAdmin`, `adminListReports`, `adminListUsers`, `adminListListings`, `adminGetConversation`.
- **Create** `pages/admin.html` + `assets/js/admin.js` — gated dashboard.
- **Modify** `assets/js/auth.js` — Admin nav link for admins only.
- **Modify** `assets/css/main.css` — tabs + admin rows.

---

## Task 1: Schema — admin identity + monitoring RLS

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Add the admins table + `is_admin()` + policy** — insert this block **right after the profiles/listings RLS section** (it must come BEFORE the conversations/messages/reports policies that reference `is_admin()`):

```sql
-- ============================================================
-- Admin identity  (Admin Increment A)
-- ============================================================
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- security definer: bypasses RLS on admins (avoids recursion with the policy
-- below) and only ever reports on the calling user.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins enable row level security;
drop policy if exists "admins_select" on public.admins;
create policy "admins_select" on public.admins
  for select using (user_id = auth.uid() or public.is_admin());
-- NO insert/update/delete policies: only the SQL Editor (service role) can add admins.
```

- [ ] **Step 2: Let admins read all reports** — replace the existing `reports_select_own` policy with an admin-aware one:

```sql
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports for select
  using (reporter_id = auth.uid() or public.is_admin());
```

- [ ] **Step 3: Let admins read all conversations** — replace `conversations_select_party`:

```sql
drop policy if exists "conversations_select_party" on public.conversations;
create policy "conversations_select_party" on public.conversations for select
  using (auth.uid() = buyer_id or auth.uid() = owner_id or public.is_admin());
```

- [ ] **Step 4: Let admins read all messages** — replace `messages_select_party`:

```sql
drop policy if exists "messages_select_party" on public.messages;
create policy "messages_select_party" on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
    )
    or public.is_admin()
  );
```

> Edit these policies **in place** in their existing sections (don't duplicate the blocks). The `admins`/`is_admin()` block from Step 1 sits earlier in the file, so the function exists when these run.

- [ ] **Step 5: User runs the updated `schema.sql`** (manual checkpoint), then **bootstraps admins**:

```sql
-- make yourself admin (find your id under Authentication > Users)
insert into admins (user_id) values ('<your-auth-user-id>') on conflict do nothing;
-- ALSO add a test account so the agent can verify the admin path:
insert into admins (user_id)
  values ((select id from auth.users where email = 'neednow.verify917@gmail.com'))
  on conflict do nothing;
```

Expected: "Success."

- [ ] **Step 6: Verify RLS with a NON-admin token** (must stay restricted)

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uidf () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
NT=$(tok neednow.owner01@gmail.com); NID=$(uidf "$NT")   # NON-admin
echo -n "non-admin reports (own only / few): "; curl -s "$BASE/rest/v1/reports?select=id" -H "apikey: $KEY" -H "Authorization: Bearer $NT" | grep -o '{' | wc -l
curl -s -o /dev/null -w "non-admin insert into admins (want 401/403): %{http_code}\n" "$BASE/rest/v1/admins" -H "apikey: $KEY" -H "Authorization: Bearer $NT" -H "Content-Type: application/json" -d "{\"user_id\":\"$NID\"}"
echo -n "non-admin all-admins list (want just self or empty): "; curl -s "$BASE/rest/v1/admins?select=user_id" -H "apikey: $KEY" -H "Authorization: Bearer $NT"
```

Expected: non-admin sees only its own reports; insert into admins → **401/403**; admins list shows at most their own row.

- [ ] **Step 7: Verify RLS with the ADMIN token** (verify917, now bootstrapped)

```bash
AT=$(tok neednow.verify917@gmail.com)
echo -n "admin reports count: "; curl -s "$BASE/rest/v1/reports?select=id" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | grep -o '{' | wc -l
echo -n "admin sees all admins: "; curl -s "$BASE/rest/v1/admins?select=user_id" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | grep -o 'user_id' | wc -l
# admin can read a conversation they're NOT a participant of: list any conversation id first as admin
CID=$(curl -s "$BASE/rest/v1/conversations?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
echo -n "admin reads messages of $CID: "; curl -s "$BASE/rest/v1/messages?select=body&conversation_id=eq.$CID" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | head -c 120; echo ""
```

Expected: admin sees more reports than the non-admin did (all of them), the full admins list, and message bodies for a conversation. If `neednow.verify917` happens to be a participant of the only conversation, that's fine — the key positive proof is the **reports** count (all vs own) and the **admins** list (all vs self).

---

## Task 2: Admin data API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Append the admin section** (after the Reporting section)

```js
/* ---------------- Admin (read-only monitoring; RLS-gated) ---------------- */
export async function amIAdmin() {
  const user = await getUser();
  if (!user) return false;
  const { data } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !!data;
}

export async function adminListReports() {
  const { data, error } = await supabase.from("reports")
    .select("*, reporter:profiles!reports_reporter_id_fkey(name,avatar_path), " +
            "reported:profiles!reports_reported_user_id_fkey(name,avatar_path), " +
            "listing:listings(id,title)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function adminListUsers() {
  const { data, error } = await supabase.from("profiles")
    .select("id,name,zip,avatar_path,rating_avg,rating_count,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function adminListListings() {
  const { data, error } = await supabase.from("listings")
    .select("id,user_id,owner_name,type,title,price,zip,emoji,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function adminGetConversation(conversationId) {
  const { data, error } = await supabase.from("messages")
    .select("sender_name,sender_id,body,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Verify** — preview console as the bootstrapped admin:
`const m = await import("../assets/js/api.js"); await m.amIAdmin()` → `true`; `await m.adminListReports()` returns an array. As a non-admin, `amIAdmin()` → `false` and `adminListReports()` → `[]`.

---

## Task 3: Admin dashboard page

**Files:** Create `pages/admin.html`, `assets/js/admin.js`

- [ ] **Step 1: Create `pages/admin.html`** (nav matches other pages)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — Need-It-Now</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/css/tokens.css" />
  <link rel="stylesheet" href="../assets/css/main.css" />
</head>
<body>
  <nav class="nav">
    <div class="nav__inner">
      <a class="brand" href="../index.html">
        <span class="brand__mark">⚡</span>
        <span class="full"><b>Need</b>-<b>It</b><span style="color:var(--ink)">-Now</span></span>
      </a>
      <div class="nav__links">
        <a href="../index.html">Home</a>
        <a href="feed.html">Browse</a>
      </div>
      <div class="nav__user" data-nav-user></div>
    </div>
  </nav>

  <main class="wrap" style="padding-block:var(--sp-6)">
    <h1 style="font-size:var(--fs-xl);margin-bottom:var(--sp-4)">Admin</h1>
    <div class="tabs">
      <button class="tab active" data-tab="reports">Reports</button>
      <button class="tab" data-tab="users">Users</button>
      <button class="tab" data-tab="listings">Listings</button>
    </div>
    <div id="admin-panel" class="admin-panel"></div>
  </main>

  <script type="module" src="../assets/js/auth.js"></script>
  <script type="module" src="../assets/js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `assets/js/admin.js`**

```js
// Need-It-Now — admin dashboard (gated; read-only monitoring).
import { amIAdmin, adminListReports, adminListUsers, adminListListings, adminGetConversation } from "./api.js";
import { go } from "./auth.js";
import { avatarHTML } from "./avatar.js";
import { resolveZip } from "./config.js";
import { starBadge } from "./stars.js";

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function dateShort(iso) { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function monthYear(iso) { return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }

async function renderReports(panel) {
  panel.innerHTML = '<p class="muted">Loading reports…</p>';
  var rows = await adminListReports();
  if (!rows.length) { panel.innerHTML = '<p class="muted">No reports yet.</p>'; return; }
  panel.innerHTML = rows.map(function (r) {
    var reporter = (r.reporter && r.reporter.name) || "Someone";
    var reported = (r.reported && r.reported.name) || "user";
    var ctx = "";
    if (r.listing) ctx += '<span class="muted">Listing: ' + esc(r.listing.title) + "</span>";
    if (r.conversation_id) ctx += '<button class="btn btn--ghost btn--sm" data-chat="' + r.conversation_id + '">View chat</button>';
    return '<div class="admin-row"><div class="admin-row__main">' +
      "<div><strong>" + esc(reporter) + "</strong> reported " +
        '<a href="profile.html?u=' + r.reported_user_id + '"><strong>' + esc(reported) + "</strong></a> " +
        '<span class="badge badge--buy">' + esc(r.reason) + "</span></div>" +
      (r.details ? '<p class="muted">' + esc(r.details) + "</p>" : "") +
      '<div class="admin-meta">' + ctx + '<span class="muted">' + dateShort(r.created_at) + "</span></div>" +
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
}

async function renderUsers(panel) {
  panel.innerHTML = '<p class="muted">Loading users…</p>';
  var users = await adminListUsers();
  var listings = [];
  try { listings = await adminListListings(); } catch (e) { /* */ }
  var counts = {};
  listings.forEach(function (l) { if (l.user_id) counts[l.user_id] = (counts[l.user_id] || 0) + 1; });
  if (!users.length) { panel.innerHTML = '<p class="muted">No users.</p>'; return; }
  var parts = await Promise.all(users.map(async function (u) {
    var coord = await resolveZip(u.zip);
    var loc = coord ? coord.city : (u.zip || "");
    var n = counts[u.id] || 0;
    return '<div class="admin-row">' + avatarHTML(u, "md") + '<div class="admin-row__main">' +
      '<div><a href="profile.html?u=' + u.id + '"><strong>' + esc(u.name) + "</strong></a> " +
        starBadge(u.rating_avg, u.rating_count) + "</div>" +
      '<div class="admin-meta muted">' + esc(loc) + " · joined " + monthYear(u.created_at) +
        " · " + n + " listing" + (n === 1 ? "" : "s") + "</div>" +
      "</div></div>";
  }));
  panel.innerHTML = parts.join("");
}

async function renderListings(panel) {
  panel.innerHTML = '<p class="muted">Loading listings…</p>';
  var rows = await adminListListings();
  if (!rows.length) { panel.innerHTML = '<p class="muted">No listings.</p>'; return; }
  panel.innerHTML = rows.map(function (l) {
    var owner = l.user_id
      ? '<a href="profile.html?u=' + l.user_id + '">' + esc(l.owner_name) + "</a>"
      : esc(l.owner_name) + " (demo)";
    return '<div class="admin-row"><span class="admin-emoji">' + (l.emoji || "📦") + "</span>" +
      '<div class="admin-row__main">' +
        "<div><strong>" + esc(l.title) + "</strong> · " +
          (l.type === "sell" ? money(l.price) : "Budget " + money(l.price)) + "</div>" +
        '<div class="admin-meta muted">' + owner + " · " + esc(l.zip || "") + " · " + dateShort(l.created_at) + "</div>" +
      "</div></div>";
  }).join("");
}

var RENDER = { reports: renderReports, users: renderUsers, listings: renderListings };

function showTab(name) {
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.toggle("active", t.getAttribute("data-tab") === name);
  });
  RENDER[name](document.getElementById("admin-panel"));
}

document.addEventListener("DOMContentLoaded", async function () {
  var panel = document.getElementById("admin-panel");
  if (!panel) return;
  if (!(await amIAdmin())) { go("pages/feed.html"); return; }
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); });
  });
  showTab("reports");
});
```

- [ ] **Step 3: Verify** — as the admin, `pages/admin.html` loads the Reports tab; tabs switch to Users/Listings and populate; "View chat" toggles a reported conversation's messages. As a non-admin, the page redirects to the feed.

---

## Task 4: Admin nav link (admins only)

**Files:** Modify `assets/js/auth.js`

- [ ] **Step 1: Import `amIAdmin`** — extend the existing api.js import:

```js
import { signUp, signIn, signOut, getProfile, amIAdmin } from "./api.js";
```

- [ ] **Step 2: Render the Admin link in the logged-in slot** — in `renderNavUser`, inside `if (profile) {`, before building `slot.innerHTML`, resolve admin status and prepend the link:

```js
    var adminLink = "";
    try { if (await amIAdmin()) {
      adminLink = '<a href="' + base() + 'pages/admin.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--blue-600);text-decoration:none;padding:.5rem .8rem">Admin</a>';
    } } catch (e) { /* not admin */ }
    slot.innerHTML =
      adminLink +
      '<a href="' + base() + 'pages/messages.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--ink-2);text-decoration:none;padding:.5rem .8rem">Messages</a>' +
      // ...(rest of the existing slot markup unchanged)
```

(Keep the rest of the existing logged-in `slot.innerHTML` exactly as-is; only prepend `adminLink +`.)

- [ ] **Step 3: Verify** — the Admin link shows in the nav only for the bootstrapped admin account; non-admins never see it.

---

## Task 5: Styles

**Files:** Modify `assets/css/main.css`

- [ ] **Step 1: Append**

```css
/* ---- Admin dashboard ---- */
.tabs { display: flex; gap: var(--sp-1); border-bottom: 1px solid var(--border); margin-bottom: var(--sp-4); }
.tab { background: none; border: 0; cursor: pointer; font: inherit; font-weight: 700;
  color: var(--muted); padding: var(--sp-3) var(--sp-4); border-bottom: 2px solid transparent; }
.tab:hover { color: var(--ink); }
.tab.active { color: var(--blue-600); border-bottom-color: var(--blue-600); }
.admin-panel { display: flex; flex-direction: column; gap: var(--sp-2); }
.admin-row { display: flex; gap: var(--sp-3); align-items: flex-start; padding: var(--sp-3);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); }
.admin-row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.admin-row a { color: var(--blue-600); text-decoration: none; }
.admin-meta { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; font-size: var(--fs-sm); }
.admin-emoji { font-size: 1.5rem; line-height: 1; }
.admin-chat { margin-top: var(--sp-2); padding: var(--sp-3); background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--r-sm); display: flex; flex-direction: column; gap: 4px; }
.admin-msg { font-size: var(--fs-sm); }
```

- [ ] **Step 2: Verify** — tabs underline the active one; admin rows align with avatar/emoji + details; the "View chat" box reads clearly; everything is usable on a 375px viewport.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/admin.js assets/js/auth.js \
        assets/css/main.css pages/admin.html docs/superpowers/
git commit -m "feat: admin role + read-only monitoring dashboard (reports/users/listings)"
```

---

## Notes for the implementer
- `is_admin()` MUST be `security definer` — otherwise the `admins_select` policy (which calls it) recurses, and it can't be used in other tables' policies. Don't change it to invoker.
- The `admins` table intentionally has **no** insert/update/delete policy. Do not add one — admins are created only from the SQL Editor.
- All admin API functions rely on RLS for authorization; they need no client-side admin check beyond the page gate. A non-admin calling them simply gets `[]`.
- Report embeds use FK names `reports_reporter_id_fkey` and `reports_reported_user_id_fkey`.
- `auth.js renderNavUser` is already `async`, so `await amIAdmin()` there is fine.

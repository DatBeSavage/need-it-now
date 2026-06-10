# Admin Increment D — Rules / Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins set site-wide rules (daily listing limit, banned words, community guidelines) from a Settings tab; the limit + word filter are enforced in the database, and guidelines render on a public page.

**Architecture:** A public-read/admin-write `app_settings` key/value table with seeded defaults, two `before insert` guard triggers on `listings`, an admin Settings tab, and a `guidelines.html` page. Categories editing is deferred (D2).

**Tech Stack:** Static HTML/CSS/JS (ES modules), Supabase Postgres + Auth (RLS + triggers).

**Verification model:** No JS test runner. RLS/triggers via live REST (admin + non-admin tokens); UI in the preview. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`. Admin `neednow.verify917@gmail.com`; non-admin `neednow.third01@gmail.com` (password `test123456`).

---

## File structure
- **Modify** `supabase/schema.sql` — `app_settings` + policies + seed + two listings guard triggers.
- **Modify** `assets/js/api.js` — `getSettings`, `adminSetSetting`.
- **Modify** `pages/admin.html` — a Settings tab button.
- **Modify** `assets/js/admin.js` — `renderSettings` + imports + `RENDER.settings`.
- **Create** `pages/guidelines.html` — public guidelines page.
- **Modify** every page's static nav — add a Guidelines link.

---

## Task 1: Schema — settings + enforcement

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Append the settings block** (near the end, after the reports section)

```sql
-- ============================================================
-- Site settings + rules  (Admin Increment D)
-- ============================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings_select_all"  on public.app_settings;
drop policy if exists "settings_insert_admin" on public.app_settings;
drop policy if exists "settings_update_admin" on public.app_settings;
create policy "settings_select_all"  on public.app_settings for select using (true);
create policy "settings_insert_admin" on public.app_settings for insert with check (public.is_admin());
create policy "settings_update_admin" on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values
  ('max_listings_per_day', '0'),
  ('banned_words', ''),
  ('guidelines', 'Be respectful. No scams or illegal items. Meet in public, well-lit places and trust your instincts.')
on conflict (key) do nothing;

-- Daily listing limit (0/blank = unlimited; admins exempt).
create or replace function public.guard_daily_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int;
begin
  select nullif(btrim(value), '')::int into lim from public.app_settings where key = 'max_listings_per_day';
  if lim is null or lim <= 0 then return new; end if;
  if public.is_admin() then return new; end if;
  select count(*) into cnt from public.listings
    where user_id = new.user_id and created_at > now() - interval '24 hours';
  if cnt >= lim then raise exception 'Daily listing limit reached (% per day).', lim; end if;
  return new;
end; $$;
drop trigger if exists trg_daily_listing_limit on public.listings;
create trigger trg_daily_listing_limit before insert on public.listings
  for each row execute function public.guard_daily_listing_limit();

-- Banned-words filter on listing title + description.
create or replace function public.guard_banned_words()
returns trigger language plpgsql security definer set search_path = public as $$
declare words text; w text; hay text;
begin
  select value into words from public.app_settings where key = 'banned_words';
  if words is null or btrim(words) = '' then return new; end if;
  hay := lower(coalesce(new.title,'') || ' ' || coalesce(new.description,''));
  foreach w in array string_to_array(lower(words), ',') loop
    w := btrim(w);
    if w <> '' and position(w in hay) > 0 then
      raise exception 'Your listing contains a blocked word.';
    end if;
  end loop;
  return new;
end; $$;
drop trigger if exists trg_banned_words on public.listings;
create trigger trg_banned_words before insert on public.listings
  for each row execute function public.guard_banned_words();
```

- [ ] **Step 2: User runs the updated `schema.sql`** (manual checkpoint). Expected "Success."

- [ ] **Step 3: Verify via REST**

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uidf () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
AT=$(tok neednow.verify917@gmail.com)
BT=$(tok neednow.third01@gmail.com); BID=$(uidf "$BT")
post () { curl -s -o /dev/null -w "%{http_code}" "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"user_id\":\"$BID\",\"owner_name\":\"Third\",\"type\":\"sell\",\"title\":\"$1\",\"description\":\"$2\",\"price\":1,\"zip\":\"78704\",\"lat\":30.24,\"lng\":-97.77}"; }
set_s () { curl -s -o /dev/null -w "set $1: %{http_code}\n" -X PATCH "$BASE/rest/v1/app_settings?key=eq.$1" -H "apikey: $KEY" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d "{\"value\":\"$2\"}"; }
echo -n "non-admin reads settings (want rows): "; curl -s "$BASE/rest/v1/app_settings?select=key" -H "apikey: $KEY" -H "Authorization: Bearer $BT" | head -c 30; echo ""
curl -s -o /dev/null -w "non-admin update settings (no-op): %{http_code}\n" -X PATCH "$BASE/rest/v1/app_settings?key=eq.banned_words" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d '{"value":"hacked"}'
# daily limit = 1
set_s max_listings_per_day 1
echo "1st post (want 201): $(post limit-a desc)"
echo "2nd post within 24h (want 4xx): $(post limit-b desc)"
set_s max_listings_per_day 0
echo "post after reset (want 201): $(post limit-c desc)"
# banned words
set_s banned_words forbidden,scam
echo "post with banned word (want 4xx): $(post 'forbidden item' desc)"
echo "clean post (want 201): $(post 'nice bike' 'great condition')"
set_s banned_words ''
# cleanup
curl -s -o /dev/null -X DELETE "$BASE/rest/v1/listings?user_id=eq.$BID" -H "apikey: $KEY" -H "Authorization: Bearer $BT"
echo "cleanup done"
```

Expected: non-admin reads settings (rows); non-admin update is a no-op; limit=1 → 1st 201, 2nd 4xx; reset → 201; banned word → 4xx; clean → 201.

---

## Task 2: Settings API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Append** (after the ban functions)

```js
export async function getSettings() {
  const { data, error } = await supabase.from("app_settings").select("key,value");
  if (error) throw error;
  const out = {};
  (data || []).forEach(function (r) { out[r.key] = r.value; });
  return out;
}

export async function adminSetSetting(key, value) {
  const { error } = await supabase.from("app_settings")
    .upsert({ key: key, value: value, updated_at: new Date().toISOString() });
  if (error) throw error;
}
```

- [ ] **Step 2: Verify** — preview console as admin: `await (await import("../assets/js/api.js")).getSettings()` returns an object with `max_listings_per_day`/`banned_words`/`guidelines`.

---

## Task 3: Admin Settings tab

**Files:** Modify `pages/admin.html`, `assets/js/admin.js`

- [ ] **Step 1: Add the tab button** in `pages/admin.html` (after the Listings tab):

```html
        <button class="tab" data-tab="settings">Settings</button>
```

- [ ] **Step 2: Extend `admin.js` imports** — add the two settings functions:

```js
import { amIAdmin, adminListReports, adminListUsers, adminListListings, adminGetConversation,
         setReportStatus, setListingHidden, adminDeleteListing,
         banUser, unbanUser, adminListBanned, getProfile,
         getSettings, adminSetSetting } from "./api.js";
```

- [ ] **Step 3: Add `renderSettings`** (near the other render functions)

```js
async function renderSettings(panel) {
  panel.innerHTML = '<p class="muted">Loading settings…</p>';
  var s = {};
  try { s = await getSettings(); } catch (e) { /* */ }
  panel.innerHTML =
    '<form class="card" data-settings style="padding:var(--sp-5);max-width:560px">' +
      '<div class="field"><label for="set-max">Max listings per user per day (0 = unlimited)</label>' +
        '<input class="input" id="set-max" type="number" min="0" value="' + esc(s.max_listings_per_day || "0") + '" /></div>' +
      '<div class="field"><label for="set-words">Banned words (comma-separated)</label>' +
        '<input class="input" id="set-words" value="' + esc(s.banned_words || "") + '" /></div>' +
      '<div class="field"><label for="set-guide">Community guidelines</label>' +
        '<textarea class="textarea" id="set-guide" style="min-height:160px">' + esc(s.guidelines || "") + "</textarea></div>" +
      '<button class="btn btn--primary" type="submit">Save settings</button>' +
    "</form>";
  panel.querySelector("[data-settings]").addEventListener("submit", async function (e) {
    e.preventDefault();
    var btn = panel.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await adminSetSetting("max_listings_per_day", String(parseInt(panel.querySelector("#set-max").value, 10) || 0));
      await adminSetSetting("banned_words", panel.querySelector("#set-words").value);
      await adminSetSetting("guidelines", panel.querySelector("#set-guide").value);
      toast("Settings saved.");
    } catch (e2) { toast((e2 && e2.message) || "Couldn't save settings."); }
    finally { btn.disabled = false; btn.textContent = "Save settings"; }
  });
}
```

- [ ] **Step 4: Register it in `RENDER`** — extend the map:

```js
var RENDER = { reports: renderReports, users: renderUsers, listings: renderListings, settings: renderSettings };
```

- [ ] **Step 5: Verify** — the Settings tab loads current values; changing the daily limit / banned words / guidelines and saving persists (re-open the tab to confirm) and toasts.

---

## Task 4: Community Guidelines page

**Files:** Create `pages/guidelines.html`

- [ ] **Step 1: Create `pages/guidelines.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Community Guidelines — Need-It-Now</title>
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
        <a href="guidelines.html" class="active">Guidelines</a>
      </div>
      <div class="nav__user" data-nav-user></div>
    </div>
  </nav>

  <main class="wrap" style="max-width:680px;padding-block:var(--sp-6)">
    <h1 style="font-size:var(--fs-xl);margin-bottom:var(--sp-4)">Community Guidelines</h1>
    <div id="guide" class="card" style="padding:var(--sp-5);white-space:pre-wrap">Loading…</div>
  </main>

  <script type="module" src="../assets/js/auth.js"></script>
  <script type="module">
    import { getSettings } from "../assets/js/api.js";
    getSettings().then(function (s) {
      document.getElementById("guide").textContent = (s && s.guidelines) || "Be respectful and trade safely.";
    }).catch(function () {
      document.getElementById("guide").textContent = "Be respectful and trade safely.";
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify** — `pages/guidelines.html` renders the saved guidelines text (newline-aware) and the nav shows Guidelines active.

---

## Task 5: Add Guidelines to the nav (all pages)

**Files:** Modify `index.html`, `pages/feed.html`, `pages/post.html`, `pages/login.html`, `pages/register.html`, `pages/messages.html`, `pages/profile.html`, `pages/admin.html`

- [ ] **Step 1: Add one Guidelines link** to each page's `<div class="nav__links">`, after the Browse link, matching that page's path depth:
  - `index.html` (root): `<a href="pages/guidelines.html">Guidelines</a>`
  - all pages inside `pages/`: `<a href="guidelines.html">Guidelines</a>`

  Do not mark it `active` on these pages (only `guidelines.html` itself is active, set in Task 4). Match each page's existing nav markup exactly; only add the one `<a>`.

- [ ] **Step 2: Verify** — every page's nav shows Home / Browse / Guidelines; the link resolves correctly from both the root and `pages/`.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/admin.js pages/admin.html \
        pages/guidelines.html index.html pages/feed.html pages/post.html pages/login.html \
        pages/register.html pages/messages.html pages/profile.html docs/superpowers/
git commit -m "feat: admin settings/rules — daily limit, banned words, guidelines page"
```

---

## Notes for the implementer
- The two guard functions are `before insert` triggers on `listings`; they read `app_settings` and (for the limit) exempt admins via `is_admin()`.
- `adminSetSetting` uses `upsert`; the seeded rows mean it's normally an update — both the insert and update policies require `is_admin()`.
- `app_settings` is public-readable so the Guidelines page and any client can read rules without auth.
- Settings values are plain text: the limit is parsed with `nullif(btrim(value),'')::int`, banned words split on commas.
- Editable categories are explicitly out of scope (follow-up D2).

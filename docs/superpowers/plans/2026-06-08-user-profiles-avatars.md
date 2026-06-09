# User Profiles + Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a profile with an uploaded photo, display name, approximate location (city/state from ZIP), and bio — surfaced across nav, listings, inbox, and chat, with a dual-mode profile page (editable for you, read-only for others).

**Architecture:** Two new `profiles` columns + a public-read Supabase Storage `avatars` bucket with per-user write policies. Avatars upload through a client-side resize pipeline. A shared `avatar.js` helper renders photo-or-initials everywhere. `nearby_listings` gains `owner_avatar`. New `profile.html`/`profile.js` page.

**Tech Stack:** Static HTML/CSS/JS (ES modules), `@supabase/supabase-js@2`, Supabase Postgres + Auth + Storage.

**Verification model:** No JS test runner. Backend/storage verified via live REST + Storage API (curl + real JWT). UI verified in the live preview with two browser profiles. Base URL `https://yubhbztyprfupvjwxwmm.supabase.co`; publishable key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`.

---

## File structure
- **Modify** `supabase/schema.sql` — add `profiles.avatar_path` + `profiles.bio`; add `avatars` bucket + storage policies; drop/recreate `nearby_listings` with `owner_avatar`.
- **Create** `assets/js/avatar.js` — `initials`, `avatarUrl`, `avatarHTML` (photo-or-initials).
- **Modify** `assets/js/api.js` — `updateProfile`, `uploadAvatar`, `getProfileById`, `listingsByUser`; extend `getProfile`; add `avatar_path` to `myConversations` embeds.
- **Create** `pages/profile.html` + `assets/js/profile.js` — dual-mode profile page.
- **Modify** `assets/js/auth.js` — nav avatar (photo + link), import shared `initials`.
- **Modify** `assets/js/feed.js` — owner avatar + profile link on cards.
- **Modify** `assets/js/messages.js` — other party's avatar in inbox rows.
- **Modify** `assets/js/chat.js` — other party's avatar in the chat header.
- **Modify** `assets/css/main.css` — `.avatar` system + profile/owner/mini styles.

---

## Task 1: Schema + storage bucket + RPC

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Add the `profiles` columns** (right after the profiles table block)

```sql
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists bio text not null default '';
```

- [ ] **Step 2: Add the avatars Storage bucket + policies** (append a new section)

```sql
-- ============================================================
-- Avatars storage bucket (public read; users write only their own folder)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_insert_own"  on storage.objects;
drop policy if exists "avatars_update_own"  on storage.objects;
drop policy if exists "avatars_delete_own"  on storage.objects;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
```

- [ ] **Step 3: Replace the `nearby_listings` function** with a version that returns `owner_avatar`

Its return type changes, so drop then recreate (and re-grant). Replace the entire existing `create or replace function public.nearby_listings(...)` + grant block with:

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
  owner_avatar text, distance_mi double precision
)
language sql stable as $$
  select *
  from (
    select
      l.id, l.user_id, l.owner_name, l.type, l.title, l.description,
      l.price, l.category, l.emoji, l.zip, l.lat, l.lng,
      l.response_count, l.created_at,
      p.avatar_path as owner_avatar,
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

> The inner select column order must match the `returns table` order exactly (RETURNS TABLE maps by position): `owner_avatar` comes right before `distance_mi` in both.

- [ ] **Step 4: User runs the updated `schema.sql`** in the Supabase SQL Editor (manual checkpoint). Expected: "Success. No rows returned."

- [ ] **Step 5: Verify columns, RPC, and storage policies via REST/Storage API**

Reuse the owner account `neednow.owner01@gmail.com` (password `test123456`).

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uid () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
OT=$(tok neednow.owner01@gmail.com); OID=$(uid "$OT")
# columns exist + updatable
curl -s -o /dev/null -w "bio update HTTP %{http_code}\n" -X PATCH "$BASE/rest/v1/profiles?id=eq.$OID" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -d '{"bio":"Local seller, quick to respond."}'
# upload an avatar into my own folder (make a tiny test file)
printf '\xff\xd8\xff\xe0test' > /tmp/a.jpg
curl -s -o /dev/null -w "upload own HTTP %{http_code}\n" -X POST "$BASE/storage/v1/object/avatars/$OID/test.jpg" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: image/jpeg" --data-binary @/tmp/a.jpg
# public read works
curl -s -o /dev/null -w "public read HTTP %{http_code}\n" "$BASE/storage/v1/object/public/avatars/$OID/test.jpg"
# writing into ANOTHER user's folder is denied
curl -s -o /dev/null -w "forge folder HTTP %{http_code}\n" -X POST "$BASE/storage/v1/object/avatars/00000000-0000-0000-0000-000000000000/x.jpg" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: image/jpeg" --data-binary @/tmp/a.jpg
# RPC returns owner_avatar
curl -s -X POST "$BASE/rest/v1/rpc/nearby_listings" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -d '{"origin_lat":30.27,"origin_lng":-97.74,"radius_mi":25,"type_filter":"all","q":""}' | grep -o 'owner_avatar' | head -1
```

Expected: `bio update HTTP 200`, `upload own HTTP 200`, `public read HTTP 200`, `forge folder HTTP 403` (or 400), and `owner_avatar` printed. Clean up: `curl -s -X DELETE "$BASE/storage/v1/object/avatars/$OID/test.jpg" -H "apikey: $KEY" -H "Authorization: Bearer $OT"`.

---

## Task 2: Shared avatar helper

**Files:** Create `assets/js/avatar.js`

- [ ] **Step 1: Create `avatar.js`**

```js
// Need-It-Now — avatar rendering (photo, or initials fallback).
import { SUPABASE_URL } from "./config.js";

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2)
    .map(function (p) { return p[0]; }).join("").toUpperCase();
}

// Build the public URL for a stored avatar path, or null.
export function avatarUrl(path) {
  return path ? SUPABASE_URL + "/storage/v1/object/public/avatars/" + path : null;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

// person: { name, avatarUrl? | avatar_path? }   size: "sm" | "md" | "lg"
export function avatarHTML(person, size) {
  size = size || "md";
  var url = person && (person.avatarUrl || avatarUrl(person.avatar_path));
  if (url) {
    return '<img class="avatar avatar--' + size + '" src="' + url +
      '" alt="' + esc(person && person.name) + '" loading="lazy" />';
  }
  return '<span class="avatar avatar--initials avatar--' + size + '">' +
    initials(person && person.name) + "</span>";
}
```

- [ ] **Step 2: Verify it imports** — in the preview console: `await import("../assets/js/avatar.js")` resolves; `(await import("../assets/js/avatar.js")).avatarHTML({name:"Ana Lee"},"sm")` returns the initials span `AL`.

---

## Task 3: Profile data API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Extend `getProfile`** to include avatar + bio + a ready URL

Replace the `return { ... }` in `getProfile` with:

```js
  return {
    id: user.id,
    email: user.email,
    name: (data && data.name) || "Neighbor",
    zip: (data && data.zip) || "",
    bio: (data && data.bio) || "",
    avatar_path: (data && data.avatar_path) || null,
    avatarUrl: (data && data.avatar_path)
      ? SUPABASE_URL + "/storage/v1/object/public/avatars/" + data.avatar_path : null,
  };
```

(`SUPABASE_URL` is already imported at the top of `api.js`.)

- [ ] **Step 2: Add profile + avatar functions** (append after `createListing`/`getListing` group)

```js
/* ---------------- Profiles & avatars ---------------- */
export async function updateProfile(patch) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  const fields = {};
  if (patch.name != null) fields.name = patch.name;
  if (patch.zip != null) fields.zip = patch.zip;
  if (patch.bio != null) fields.bio = patch.bio;
  const { error } = await supabase.from("profiles").update(fields).eq("id", profile.id);
  if (error) throw error;
}

export async function getProfileById(userId) {
  const { data, error } = await supabase.from("profiles")
    .select("id,name,zip,bio,avatar_path,created_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listingsByUser(userId) {
  const { data, error } = await supabase.from("listings")
    .select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

function _resizeToBlob(file, size) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () {
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error("Image processing failed.")); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { reject(new Error("Couldn't read that image.")); };
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadAvatar(file) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG, or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB.");
  const blob = await _resizeToBlob(file, 512);
  const path = profile.id + "/" + Date.now() + ".jpg";
  const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", profile.id);
  if (error) throw error;
  if (profile.avatar_path) supabase.storage.from("avatars").remove([profile.avatar_path]);
  return SUPABASE_URL + "/storage/v1/object/public/avatars/" + path;
}
```

- [ ] **Step 3: Add `avatar_path` to the `myConversations` embeds**

In `myConversations`, change the embed string to:

```js
    .select("*, listing:listings(id,title,emoji,type,price), " +
            "buyer:profiles!conversations_buyer_id_fkey(name,avatar_path), " +
            "owner:profiles!conversations_owner_id_fkey(name,avatar_path)")
```

- [ ] **Step 4: Verify** — preview console while logged in:
`const m = await import("../assets/js/api.js"); console.log(await m.getProfile());` shows `avatar_path`/`avatarUrl`/`bio` keys. `await m.listingsByUser((await m.getProfile()).id)` returns an array.

---

## Task 4: Profile page

**Files:** Create `pages/profile.html`, `assets/js/profile.js`

- [ ] **Step 1: Create `pages/profile.html`** (nav matches the other pages; main is JS-filled)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Profile — Need-It-Now</title>
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

  <main class="wrap" style="max-width:680px;padding-block:var(--sp-6)">
    <div id="profile-root"></div>
  </main>

  <script type="module" src="../assets/js/auth.js"></script>
  <script type="module" src="../assets/js/profile.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `assets/js/profile.js`**

```js
// Need-It-Now — profile page (own = editable/settings; other = read-only).
import { getProfile, getProfileById, updateProfile, uploadAvatar, listingsByUser } from "./api.js";
import { resolveZip } from "./config.js";
import { wireZipInput } from "./zips.js";
import { avatarHTML } from "./avatar.js";
import { toast, go, base } from "./auth.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function monthYear(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function miniCard(l, editable) {
  return '<article class="mini">' +
    '<span class="mini__emoji">' + (l.emoji || "📦") + "</span>" +
    '<span class="mini__body"><strong>' + esc(l.title) + "</strong>" +
    '<span class="muted">' + (l.type === "sell" ? money(l.price) : "Budget " + money(l.price)) + "</span></span>" +
    (editable ? '<a class="btn btn--ghost btn--sm" href="post.html?id=' + l.id + '">Edit</a>' : "") +
    "</article>";
}

async function renderListings(box, userId, editable) {
  var rows = [];
  try { rows = await listingsByUser(userId); } catch (e) { /* leave empty */ }
  box.innerHTML = rows.length
    ? rows.map(function (l) { return miniCard(l, editable); }).join("")
    : '<p class="muted">No active listings.</p>';
}

async function renderPublic(root, p) {
  var coord = await resolveZip(p.zip);
  var loc = coord ? coord.city : (p.zip || "");
  root.innerHTML =
    '<div class="profile-head card">' +
      avatarHTML(p, "lg") +
      '<div><h1 class="profile-name">' + esc(p.name) + "</h1>" +
        '<p class="muted">' + esc(loc) + (loc ? " · " : "") + "Member since " + monthYear(p.created_at) + "</p>" +
        (p.bio ? '<p class="profile-bio">' + esc(p.bio) + "</p>" : "") +
        '<div data-rating-slot></div>' +
      "</div>" +
    "</div>" +
    '<h2 class="profile-sub">Listings</h2><div class="minis" data-listings></div>';
  renderListings(root.querySelector("[data-listings]"), p.id, false);
}

function renderOwn(root, me) {
  root.innerHTML =
    '<h1 class="profile-name" style="margin-bottom:var(--sp-4)">Your profile</h1>' +
    '<form class="card" data-form style="padding:var(--sp-6)">' +
      '<div class="profile-edit-head">' +
        '<span data-av>' + avatarHTML(me, "lg") + "</span>" +
        '<label class="btn btn--ghost btn--sm">Change photo' +
          '<input type="file" accept="image/*" data-file hidden /></label>' +
      "</div>" +
      '<div class="field"><label for="pf-name">Display name</label>' +
        '<input class="input" id="pf-name" value="' + esc(me.name) + '" /></div>' +
      '<div class="field"><label for="pf-zip">ZIP (your area)</label>' +
        '<input class="input" id="pf-zip" list="zip-list" value="' + esc(me.zip) + '" />' +
        '<datalist id="zip-list"></datalist></div>' +
      '<div class="field"><label for="pf-bio">Bio</label>' +
        '<textarea class="textarea" id="pf-bio" maxlength="280" placeholder="A line or two about you…">' + esc(me.bio) + "</textarea></div>" +
      '<p class="form-error" role="alert"></p>' +
      '<button class="btn btn--primary btn--lg" type="submit">Save profile</button>' +
    "</form>" +
    '<h2 class="profile-sub">Your listings</h2><div class="minis" data-listings></div>';

  var form = root.querySelector("[data-form]");
  var fileInput = root.querySelector("[data-file]");
  var avBox = root.querySelector("[data-av]");
  var err = form.querySelector(".form-error");
  var pendingFile = null;

  var checkZip = wireZipInput(document.getElementById("pf-zip"));
  checkZip();

  fileInput.addEventListener("change", function () {
    pendingFile = fileInput.files[0] || null;
    if (pendingFile) avBox.innerHTML = '<img class="avatar avatar--lg" src="' + URL.createObjectURL(pendingFile) + '" alt="" />';
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    var name = document.getElementById("pf-name").value.trim();
    var zip = document.getElementById("pf-zip").value.trim();
    var bio = document.getElementById("pf-bio").value.trim();
    if (!name) { err.textContent = "Add a display name."; return; }
    if (!(await resolveZip(zip))) { err.textContent = "Enter a valid US ZIP."; return; }
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (pendingFile) { await uploadAvatar(pendingFile); pendingFile = null; }
      await updateProfile({ name: name, zip: zip, bio: bio });
      toast("Profile saved.");
      go("pages/profile.html"); // reload fresh (also refreshes nav avatar)
    } catch (e2) {
      err.textContent = (e2 && e2.message) || "Couldn't save — try again.";
      btn.disabled = false; btn.textContent = "Save profile";
    }
  });

  renderListings(root.querySelector("[data-listings]"), me.id, true);
}

document.addEventListener("DOMContentLoaded", async function () {
  var root = document.getElementById("profile-root");
  if (!root) return;
  var me = null;
  try { me = await getProfile(); } catch (e) { me = null; }
  var u = new URLSearchParams(location.search).get("u");
  var viewingId = u || (me && me.id);
  if (!viewingId) { go("pages/login.html?next=/pages/profile.html"); return; }

  if (me && viewingId === me.id) { renderOwn(root, me); return; }
  var p = null;
  try { p = await getProfileById(viewingId); } catch (e) { /* */ }
  if (!p) { root.innerHTML = '<div class="empty"><div class="em">🤷</div><p>That profile doesn\'t exist.</p></div>'; return; }
  renderPublic(root, p);
});
```

- [ ] **Step 3: Verify** in the preview — logged in, open `pages/profile.html`: your editable form shows with current name/zip/bio and your listings. Change the photo (preview updates), edit name/bio, Save → toast, reload, nav avatar updates. Open `profile.html?u=<another user id>` → read-only view with their info + listings.

---

## Task 5: Surface avatars across the app

**Files:** Modify `assets/js/auth.js`, `assets/js/feed.js`, `assets/js/messages.js`, `assets/js/chat.js`

- [ ] **Step 1: `auth.js` — shared initials + nav avatar link**

Add the import and delete the local `initials` function (now in `avatar.js`):

```js
import { avatarHTML, initials } from "./avatar.js";
```

In `renderNavUser`, replace the avatar `<span>` line with a linked avatar:

```js
      '<a href="' + base() + 'pages/profile.html" class="nav__avatar-link" title="' + profile.name + '">' +
        avatarHTML(profile, "sm") + "</a>" +
```

- [ ] **Step 2: `feed.js` — owner avatar + profile link on cards**

Add the import:

```js
import { avatarHTML } from "./avatar.js";
```

Replace the owner `<span>` inside `cardHTML`'s `listing__meta` with a linked owner cell:

```js
          (function () {
            var person = { name: row.owner_name, avatar_path: row.owner_avatar };
            var inner = avatarHTML(person, "sm") + "<span>" + escapeHTML(row.owner_name) + "</span>";
            return row.user_id
              ? '<a class="owner" href="profile.html?u=' + row.user_id + '">' + inner + "</a>"
              : '<span class="owner">' + inner + "</span>";
          })() + " · " + timeAgo(row.created_at) +
```

(Replaces `escapeHTML(row.owner_name) + " · " + timeAgo(row.created_at)` inside the `<span>` — keep the surrounding `<span>` wrapper of `listing__meta`.)

- [ ] **Step 3: `messages.js` — other party's avatar in inbox rows**

Add the import:

```js
import { avatarHTML } from "./avatar.js";
```

In `rowHTML`, build the other party and put their avatar before the body:

```js
  var other = c.iAmOwner ? c.buyer : c.owner;
  var who = (other && other.name) || (c.iAmOwner ? "Buyer" : "Seller");
```

Replace the `thread__emoji` span with the avatar:

```js
    avatarHTML({ name: who, avatar_path: other && other.avatar_path }, "md") +
```

(Use `who` for the name everywhere it previously computed the name.)

- [ ] **Step 4: `chat.js` — avatar in the chat header**

Add the import:

```js
import { avatarHTML } from "./avatar.js";
```

In `modal()`, add an avatar slot at the start of `chat__head`'s inner div:

```js
      '<header class="chat__head"><span class="chat__av" data-av></span><div>' +
```

Change `openPanel(opts, who, sub)` to `openPanel(opts, person, sub)` where `person` is `{ name, avatar_path | avatarUrl }`; set the header:

```js
  m.querySelector("[data-av]").innerHTML = avatarHTML(person, "md");
  m.querySelector("[data-who]").textContent = person.name;
  m.querySelector("[data-sub]").textContent = sub;
```

Update the two callers:

```js
export async function openChatForListing(listing) {
  var person = { name: listing.owner_name || "Seller", avatar_path: listing.owner_avatar };
  var sub = (listing.type === "sell" ? "Re: " : "You have: ") + listing.title;
  try { await openPanel({ listing: listing }, person, sub); }
  catch (err) { toast((err && err.message) || "Couldn't open chat."); }
}

export function openChatForConversation(conv) {
  var other = conv.iAmOwner ? conv.buyer : conv.owner;
  var person = { name: (other && other.name) || (conv.iAmOwner ? "Buyer" : "Seller"),
                 avatar_path: other && other.avatar_path };
  openPanel({ conv: conv }, person, "Re: " + (conv.listing ? conv.listing.title : "Listing"));
}
```

- [ ] **Step 5: Verify** — preview, two profiles with photos uploaded: avatars show in the nav, on listing cards (clicking the owner opens their profile), in the inbox, and in the chat header. Users without a photo show initials.

---

## Task 6: Styles

**Files:** Modify `assets/css/main.css`

- [ ] **Step 1: Append the avatar system + profile/owner/mini styles**

```css
/* ---- Avatars ---- */
.avatar { display: inline-block; border-radius: 50%; object-fit: cover;
  background: var(--blue-600); color: #fff; font-weight: 700; text-align: center;
  vertical-align: middle; overflow: hidden; flex: none; }
.avatar--initials { line-height: 1; display: inline-grid; place-items: center; }
.avatar--sm { width: 28px; height: 28px; font-size: 12px; }
.avatar--md { width: 40px; height: 40px; font-size: 15px; }
.avatar--lg { width: 88px; height: 88px; font-size: 30px; }
.nav__avatar-link { display: inline-flex; }

/* owner cell on listing cards */
.owner { display: inline-flex; align-items: center; gap: var(--sp-1);
  color: inherit; text-decoration: none; }
.owner:hover { color: var(--blue-600); }

/* profile page */
.profile-head { display: flex; gap: var(--sp-4); align-items: center;
  padding: var(--sp-5); margin-bottom: var(--sp-5); }
.profile-name { font-size: var(--fs-xl); }
.profile-bio { margin-top: var(--sp-2); max-width: 60ch; }
.profile-sub { font-size: var(--fs-lg); margin: var(--sp-5) 0 var(--sp-3); }
.profile-edit-head { display: flex; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-5); }

/* mini listing cards */
.minis { display: flex; flex-direction: column; gap: var(--sp-2); }
.mini { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); }
.mini__emoji { font-size: 1.4rem; }
.mini__body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mini__body strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 520px) { .profile-head { flex-direction: column; text-align: center; } }
```

- [ ] **Step 2: Verify** — avatars are round and crisp at all three sizes; the profile header lays out well on desktop and stacks on a 375px viewport; owner cells on cards align; initials fallback is centered.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/avatar.js assets/js/api.js assets/js/profile.js \
        assets/js/auth.js assets/js/feed.js assets/js/messages.js assets/js/chat.js \
        assets/css/main.css pages/profile.html docs/superpowers/
git commit -m "feat: user profiles with avatar uploads (Supabase Storage)"
```

---

## Notes for the implementer
- The public avatar URL is deterministic: `${SUPABASE_URL}/storage/v1/object/public/avatars/<path>` — `avatar.js` and `api.js` both build it this way; keep them in sync.
- `getProfile()` returns `avatarUrl`; embeds/RPC return raw `avatar_path` — `avatarHTML` accepts either.
- `initials` now lives in `avatar.js`; `auth.js` imports it (don't leave a duplicate).
- Demo seed listings have `user_id` null → owner cell renders initials with no profile link.
- Avatar filenames are timestamped (`Date.now()`), so replacing a photo busts the cache automatically; the old object is deleted.

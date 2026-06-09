# Need-It-Now — User Profiles + Avatars design

Status: approved 2026-06-08. The **Profiles** phase — built before Reputation
(Phase 3) and Reporting (Phase 2), because ratings and reports both gain meaning
when attached to a real, recognizable profile. Additive schema; re-run the updated
`supabase/schema.sql` (idempotent) plus a one-time storage-bucket setup.

## Goal

Give every user a real profile: an uploaded photo, a display name, an approximate
location (city/state from their ZIP, never an exact address), and a short bio.
Surface those avatars across the app (nav, listings, inbox, chat) and give each
user a profile page — editable for yourself (doubles as account settings),
read-only when viewing others.

## Confirmed decisions
1. **Avatars are real uploaded photos** stored in Supabase Storage.
2. **Location = city/state derived from `zip`** via the existing `resolveZip` cache.
   No free-text location, no stored city.
3. **Bio** included (short, optional).
4. The **profile page doubles as account settings** (no separate settings page).
5. **`nearby_listings` gains an `owner_avatar` column** now; Phase 3 adds
   `owner_rating` / `owner_rating_count` beside it.

---

## Data model

### `profiles` — add two columns
```sql
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists bio text not null default '';
```
- `avatar_path` — storage object path, e.g. `<user_id>/1733bce0.jpg`. Null → render
  the initials fallback.
- `bio` — short "about me".
- Reused as-is: `name`, `zip`, `created_at` (→ "Member since"). City/state is derived
  client-side from `zip`; nothing new is stored for location.
- Existing RLS already covers it: `profiles_select_all` (public read),
  `profiles_update_own` (owner edits). No policy changes needed.

### Supabase Storage — `avatars` bucket
```sql
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read of avatar files.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- A user may write only within their own <uid>/ folder.
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;
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

### `nearby_listings` RPC — add `owner_avatar`
The return signature changes, so the function must be **dropped and recreated**
(`create or replace` cannot change a function's return type):
```sql
drop function if exists public.nearby_listings(
  double precision, double precision, double precision, text, text);
```
Recreate it identically to today, plus:
- `owner_avatar text` added to the `returns table (...)` list.
- A `left join public.profiles p on p.id = l.user_id` and `p.avatar_path as owner_avatar`
  in the select.
- Re-issue the existing `grant execute ... to anon, authenticated;`.

---

## Avatar upload pipeline

Client-side, in `api.js`:
1. **Validate** — type in {jpeg,png,webp}, size ≤ 5 MB (pre-resize).
2. **Resize** — draw the image cover-fit onto a 512×512 `<canvas>`, export
   `toBlob('image/jpeg', 0.85)`. Keeps storage small and uniform.
3. **Upload** — `supabase.storage.from('avatars').upload(`<uid>/<Date.now()>.jpg`, blob,
   { contentType: 'image/jpeg', upsert: false })`. A fresh filename each time avoids
   stale-image caching.
4. **Record** — `update profiles set avatar_path = <new path>` for the current user.
5. **Clean up** — remove the previous `avatar_path` object if there was one.

> Note: `Date.now()` is fine in app code (it's only unavailable inside Workflow
> scripts), so timestamped filenames are OK here.

---

## API additions (`api.js`)
- `updateProfile({ name, zip, bio })` — update the current user's row.
- `uploadAvatar(file)` — the pipeline above; returns the new public URL.
- `avatarUrl(path)` — `supabase.storage.from('avatars').getPublicUrl(path)` → URL or null.
- `getProfileById(userId)` — public read of any profile (avatar, name, zip, bio,
  created_at) for viewing others.
- `listingsByUser(userId)` — `select * from listings where user_id = eq.userId
  order by created_at desc` (their active listings).
- `getProfile()` — extended to also return `avatar_path`, `bio`, and a computed
  `avatarUrl`.
- `myConversations()` embeds gain `avatar_path`:
  `buyer:profiles!conversations_buyer_id_fkey(name,avatar_path)` and the matching
  `owner:` embed.

---

## Shared avatar helper (`assets/js/avatar.js`)
- `initials(name)` — exported (moved here; `auth.js` imports it instead of its local copy).
- `avatarHTML(person, size)` — returns `<img class="avatar avatar--<size>">` when an
  avatar URL is available, else `<span class="avatar avatar--initials avatar--<size>">AB</span>`.
  `person` is any object with `{ name, avatarUrl | avatar_path }`.
- Sizes: `sm` (nav/bubbles), `md` (cards/inbox/chat header), `lg` (profile page).

---

## Profile page (`pages/profile.html` + `assets/js/profile.js`)

One page, two modes, chosen by the `?u=<user_id>` query param:

**Your profile** (no `?u`, or `?u` == your id) — editable, doubles as settings:
- Avatar with a "Change photo" file input (preview before save).
- Display-name input.
- ZIP input wired with `wireZipInput` (live city/state confirmation).
- Bio textarea.
- **Save** → `updateProfile(...)`, and if a new file was chosen, `uploadAvatar(file)` first.
- "Your listings" — `listingsByUser(me.id)` rendered as compact cards (emoji, title,
  price) linking to the feed; each with Edit (→ `post.html?id=`).
- Guarded by `requireAuth()`.

**Someone else's** (`?u=<other id>`) — read-only:
- Avatar (lg), name, city/state (from their ZIP), bio, "Member since <month year>".
- Their active listings (compact cards).
- A `<div data-rating-slot>` placeholder — Phase 3 fills it with ★ rating + count.

---

## Where avatars appear (all via `avatarHTML`)
- **Nav** (`auth.js renderNavUser`) — the initials disc becomes `avatarHTML(profile,'sm')`,
  wrapped in a link to `pages/profile.html`. Initials remain the fallback.
- **Listing cards** (`feed.js cardHTML`) — owner avatar (`sm`) + name, linking to
  `profile.html?u=<row.user_id>`, using `row.owner_avatar` from the RPC. Demo listings
  (`user_id` null) show the initials fallback with no link.
- **Inbox rows** (`messages.js`) — the other party's avatar (`md`) from the embed.
- **Chat header** (`chat.js`) — the other party's avatar (`md`) + name, linking to
  their profile. (Message bubbles stay text for now.)

---

## CSS (`main.css`)
- `.avatar` — round, `object-fit: cover`, bordered; `--sm`/`--md`/`--lg` sizes.
- `.avatar--initials` — centered initials on a token-colored disc (reuse the current
  nav-avatar look).
- Profile page layout: header band (avatar + name + meta), bio block, listings grid,
  the edit form. Tokens only.

---

## Manual steps (one-time, in the Supabase SQL Editor)
Run the updated `supabase/schema.sql` — it now also creates the `avatars` bucket,
its storage policies, and the recreated `nearby_listings`. Idempotent: `add column
if not exists`, `on conflict do nothing`, `drop policy if exists`, `drop function if
exists` + recreate.

## Testing
- **Schema/storage (REST + storage API):** with a real JWT, upload a file to
  `avatars/<uid>/x.jpg` (200), confirm it's publicly readable, and confirm a second
  user **cannot** write to the first user's folder (403). `update profiles set
  avatar_path` succeeds for self only.
- **RPC:** `nearby_listings` rows now include `owner_avatar`.
- **UI (preview, two profiles):** upload a photo on your profile → it appears in the
  nav, on your listing cards, in the inbox, and in the chat header for the other user.
  Edit name/bio/ZIP → persists and the city updates live. Visiting `profile.html?u=<id>`
  shows that user read-only with their listings. Initials fallback shows for users
  without a photo.

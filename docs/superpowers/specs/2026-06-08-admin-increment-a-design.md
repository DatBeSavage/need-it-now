# Need-It-Now — Admin Increment A design (identity + monitoring)

Status: approved 2026-06-08. The secure foundation for all admin/moderation work.
**Read-only monitoring** in this increment; moderation (B), user management (C),
and rules/settings (D) build on it. Additive, idempotent schema + a one-time
admin bootstrap.

## Goal

A real admin role that cannot be self-granted, plus a gated dashboard where an
admin can monitor **everything**: all reports, all users, all listings, and the
**contents of any private conversation** (to investigate reports).

## Confirmed decisions
1. Admin status is **not stored on `profiles`** (self-editable) — it lives in a
   locked-down `admins` table with no user-facing write path.
2. The **first admin is bootstrapped via SQL** in the Supabase dashboard
   (service-role context), since that's the only place with write access.
3. Admins get **full visibility**, including reading **private chat messages**.
4. This increment is **read-only**; actions come later (B/C/D).
5. Enforcement is in the **database (RLS)**, never client-only (publishable key is public).

---

## Security model

### `admins` table
```sql
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

drop policy if exists "admins_select" on public.admins;
create policy "admins_select" on public.admins
  for select using (user_id = auth.uid() or public.is_admin());
-- NO insert/update/delete policies → the publishable key has zero write paths.
-- Admins are added only from the SQL Editor (service role bypasses RLS).
```

### `is_admin()` helper
```sql
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
```
- **`security definer` is required** here: it bypasses RLS on `admins`, which (a)
  avoids infinite recursion with the `admins_select` policy that calls `is_admin()`,
  and (b) lets the function be used inside other tables' policies for any admin.
- It only ever reports on the **caller** (`auth.uid()`), so being publicly callable
  is harmless.
- Define order in `schema.sql`: create `admins` table → create `is_admin()` →
  create `admins_select` policy (function body references the table; the policy
  references the function).

### Bootstrap (one-time, manual)
In the SQL Editor (find your id under Authentication → Users, or
`select id from auth.users where email = 'you@…';`):
```sql
insert into admins (user_id) values ('<your-auth-user-id>') on conflict do nothing;
```

### RLS additions for "monitor everything"
Append `or public.is_admin()` to these SELECT policies (drop + recreate, idempotent):
- **reports**: `using (reporter_id = auth.uid() or public.is_admin())`
- **conversations**: `using (auth.uid() = buyer_id or auth.uid() = owner_id or public.is_admin())`
- **messages**: `using (<existing participant exists()> or public.is_admin())`

`profiles` and `listings` are already `select using (true)`, so admins already read
them. No write policies change in this increment.

---

## API additions (`assets/js/api.js`) — all gated by RLS
- `amIAdmin()` → `boolean`. Reads the `admins` table for your own row
  (`admins_select` permits reading your own row).
- `adminListReports()` → all reports, embedded with reporter + reported profile +
  listing title. Returns `[]` for non-admins (RLS).
- `adminListUsers()` → all `profiles` (id, name, zip, avatar_path, rating_avg,
  rating_count, created_at), newest first.
- `adminListListings()` → all listings, newest first.
- `adminGetConversation(conversationId)` → the conversation's messages (ordered),
  for the report drill-down.

These intentionally rely on RLS for authorization — a non-admin calling them gets
empty results, not elevated data.

---

## Admin dashboard (`pages/admin.html` + `assets/js/admin.js`)
- **Gate:** on load, `await amIAdmin()`; if false → `go("pages/feed.html")`. (RLS is
  the real guard; this only hides the UI.)
- **Layout:** standard nav + a `.wrap` with a simple tab strip (Reports / Users /
  Listings) and a panel the JS fills. Tabs switch client-side; data loads lazily
  per tab on first view.
- **Reports tab:** for each report — reporter name → reported user (link to their
  profile), reason badge, details, context: listing title (link) and/or a
  **"View chat"** button that calls `adminGetConversation` and shows the messages
  inline. Date.
- **Users tab:** avatar, name, location (city from ZIP), ★ rating, "Member since",
  and **# listings** (computed by grouping `adminListListings()` by `user_id`).
  Each links to `profile.html?u=<id>`.
- **Listings tab:** emoji, title, owner name, type, price, ZIP, date; owner links to
  their profile.
- Everything **read-only**; action buttons arrive in B/C/D.

## Nav (`assets/js/auth.js`)
In `renderNavUser` (logged-in branch), after resolving the profile, also
`await amIAdmin()`; if true, prepend an **Admin** link
(`<base>pages/admin.html`) to the slot. Non-admins never see it.

## CSS (`assets/css/main.css`)
- Tab strip (`.tabs`, `.tab`, active state), an admin table/list style
  (`.admin-row`, columns), reusing tokens. The "View chat" drill-down reuses the
  existing message-bubble styles where practical, or a compact `.admin-chat` list.

---

## Manual steps (SQL Editor, one-time)
1. Re-run `supabase/schema.sql` (adds `admins`, `is_admin()`, and the three
   `or is_admin()` SELECT-policy updates). Idempotent.
2. Run the bootstrap insert to make yourself an admin.

## Testing
- **REST (security):**
  - A **non-admin** token: `select` on `reports` returns only own; on a
    conversation they're not in returns `[]`; **insert into `admins`** is rejected
    (no policy) → 401/403.
  - Make a test user admin via SQL, then with that token: `reports` returns **all**
    rows; a conversation they're not a participant of returns its messages;
    `select user_id from admins` returns all.
  - Confirm a non-admin still **cannot** read another user's private messages
    (regression: the `or is_admin()` must not loosen non-admins).
- **UI (preview):** as a non-admin, `pages/admin.html` redirects to the feed and no
  Admin nav link shows. As the admin, the link appears and all three tabs populate;
  "View chat" shows a reported conversation's messages.

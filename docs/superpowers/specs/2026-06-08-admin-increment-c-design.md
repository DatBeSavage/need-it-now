# Need-It-Now — Admin Increment C design (user management / bans)

Status: approved 2026-06-08 (roadmap-approved). Builds on A/B. Admins can
**ban (suspend)** a user — DB-enforced so a banned user can't post, start chats,
send messages, or leave ratings — and unban them.

## Model
"Ban" = **suspension of participation**, enforced by RLS. A banned user can still
log in and browse (read-only); their write actions are rejected. (A *hard* account
disable would be a Supabase Auth dashboard action and is out of scope.) Existing
listings stay up; an admin can hide/delete them via Increment B.

## Schema
- **`banned_users`** table — `user_id uuid pk references profiles(id) on delete cascade`,
  `reason text default ''`, `created_at`. Admin-only RLS:
  ```sql
  select using (public.is_admin());
  insert with check (public.is_admin());
  delete using (public.is_admin());
  ```
  Normal users have **no** write/read path (so no self-unban, no enumerating bans).
- **`is_banned()`** — `security definer`, `stable`: `exists(select 1 from banned_users where user_id = auth.uid())`. Bypasses RLS (so it works inside insert policies and the admin-only `banned_users` select).
- **Enforcement** — add `and not public.is_banned()` to the `with check` of the
  participation insert policies:
  - `listings_insert_own`, `conversations_insert_buyer`, `messages_insert_party`,
    `ratings_insert_party`.
  - (Reporting is intentionally left allowed — a low-risk safety valve.)

### Ordering note
`is_banned()` must be defined **before** any policy that uses it. The
`listings_insert_own` policy currently sits earlier in the file than the admin
identity block, so the ban block (table + `is_banned()` + `banned_users` policies)
goes right after the admins block, and `listings_insert_own` is **dropped and
recreated** there with the ban check. The conversations/messages/ratings insert
policies come later in the file, so they're edited in place.

## API (`api.js`)
- `banUser(userId, reason)` — insert into `banned_users` (admin-only by RLS).
- `unbanUser(userId)` — delete from `banned_users`.
- `adminListBanned()` — `[{user_id, reason}]` (admin-only).

## UI (`admin.js`, Users tab)
- Load `adminListBanned()` alongside users; build a banned-id set.
- Each user row shows a **Banned** badge if banned, and a **Ban**/**Unban** button
  (Ban prompts for a short reason). The admin's own row shows no ban button.
- Actions call `banUser`/`unbanUser` then re-render.

## Manual step
Re-run `supabase/schema.sql` (adds `banned_users`, `is_banned()`, the ban-check on
the four insert policies). Idempotent.

## Testing
- **REST:** admin bans a test user → that user's token can no longer insert a
  listing / conversation / message / rating (4xx or no-op), but can still read;
  admin unbans → the user can post again. A non-admin cannot insert into
  `banned_users` (4xx) and cannot read it (`[]`).
- **UI:** Users tab shows Ban/Unban + the Banned badge; banning blocks the target
  from posting in the preview.

## Not in C
Settings/rules (D).

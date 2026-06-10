# Need-It-Now — Admin Increment D design (rules / settings)

Status: approved 2026-06-08 (roadmap-approved). Builds on A/B/C. Gives admins a
**Settings** tab to set site-wide rules that are **enforced in the database**, plus
an editable Community Guidelines page.

## Scope decision
In D now: **site settings store + DB enforcement (daily listing limit, banned
words) + Community Guidelines page**. **Editable categories** is deferred to a small
follow-up (D2) because it's a cross-cutting refactor (post form `<select>`, the
`EMOJI` map, and the feed filter chips all currently hard-code categories).

## Schema
- **`app_settings`** table — `key text primary key`, `value text not null default ''`,
  `updated_at`. Public-readable; admin-writable:
  ```sql
  select using (true);
  insert with check (public.is_admin());
  update using (public.is_admin()) with check (public.is_admin());
  ```
- **Seed defaults** (idempotent `on conflict do nothing`):
  `max_listings_per_day = '0'` (0 = unlimited), `banned_words = ''`,
  `guidelines = 'Be respectful. No scams or illegal items. Meet in public, public places.'`
- **Enforcement triggers** (before insert on `listings`, `security definer`):
  - `guard_daily_listing_limit` — if `max_listings_per_day > 0` and the (non-admin)
    poster already has that many listings in the last 24h, raise. Admins exempt.
  - `guard_banned_words` — if any comma-separated word in `banned_words` appears in
    the listing's lower(title + ' ' + description), raise. (Listings only for now;
    extendable to messages later.)

## API (`api.js`)
- `getSettings()` — `{ key: value, … }` for all rows (public read; used by the
  Settings tab and the Guidelines page).
- `adminSetSetting(key, value)` — upsert one setting (admin-only by RLS).

## UI
- **Admin Settings tab** (4th tab in `admin.js`): a form with **Max listings per
  user per day** (number; 0 = unlimited), **Banned words** (comma-separated), and
  **Community guidelines** (textarea). Save calls `adminSetSetting` per changed
  field, then toasts.
- **Community Guidelines page** (`pages/guidelines.html` + tiny inline module):
  renders `getSettings().guidelines` (newline-aware). Linked from the nav of the
  pages that have a footer/nav slot — added to the static nav links (Home / Browse /
  Guidelines) so everyone can find it.

## Manual step
Re-run `supabase/schema.sql` (adds `app_settings`, its policies, the seed defaults,
and the two `listings` guard triggers). Idempotent.

## Testing
- **REST:** as admin set `max_listings_per_day = '1'`; a non-admin's 2nd listing in
  24h is rejected; reset to `'0'` and it works again. Set `banned_words = 'forbidden'`;
  a listing titled "forbidden item" is rejected. A non-admin cannot update
  `app_settings` (no-op/4xx) but can read it.
- **UI:** Settings tab loads current values, saving persists them; the Guidelines
  page shows the saved text.

## Not in D (follow-up D2)
Editable categories (DB-driven category list feeding the post form, emoji map, and
feed chips).

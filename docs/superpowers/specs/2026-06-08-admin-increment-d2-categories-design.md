# Need-It-Now — Admin D2 design (editable categories)

Status: approved 2026-06-08 (roadmap-approved follow-up). Makes the listing
category list **DB-driven and admin-editable**, replacing the hard-coded options.

## Context
Categories are currently hard-coded in two places: the `<select>` in `post.html`
and the `EMOJI` map in `post.js` (category → emoji). They are NOT used as feed
filters (the feed chips filter by type: all/sell/buy), so this is contained to the
post form + an admin editor.

## Schema
- **`categories`** table — `value text primary key` (slug), `label text not null`,
  `emoji text not null default '📦'`, `sort int not null default 0`, `created_at`.
  Public-readable; admin-writable (insert/update/delete `with check/using
  public.is_admin()`).
- **Seed** the current 8 categories (idempotent `on conflict do nothing`):
  car/bike/phone/furniture/game/tool/garden/other with their labels + emojis + sort 1–8.

## API (`api.js`)
- `getCategories()` — `[{value,label,emoji,sort}]` ordered by `sort` (public read).
- `adminSaveCategory({value,label,emoji,sort})` — upsert (admin-only by RLS).
- `adminDeleteCategory(value)` — delete (admin-only).

## Post form (`post.js`)
- On load, `getCategories()`; if non-empty, replace the `<select>` options with the
  DB list and build an `emojiByCat` map. The listing's `emoji` is taken from the
  chosen category (`emojiByCat[cat]`), falling back to the existing `EMOJI` map then
  `📦`. If the fetch fails/empty, the hard-coded HTML options remain as a fallback.
- Edit mode sets `form.category.value` after the options are populated.

## Admin editor (`admin.js`)
- A **Categories** tab (5th tab): each category as a row with an editable **emoji**
  and **label**, plus **Save** and **Delete**; a bottom "add new" row (emoji / label
  / slug → **Add**). Save preserves the row's existing `sort`; new categories append
  (`sort = 99`). Slugs are lowercased + stripped to `[a-z0-9]`.

## Manual step
Re-run `supabase/schema.sql` (adds `categories` + policies + seed). Idempotent.

## Testing
- **REST:** admin upserts a new category (201/200) and deletes one (204); a
  non-admin upsert/delete is a no-op/4xx; everyone can read categories.
- **UI:** the post form's category dropdown reflects the DB list (add a category in
  the admin tab → it appears in the post form); posting picks up the category's emoji.

## Notes
- Existing listings keep their stored `emoji`; only new posts derive emoji from the
  (possibly edited) category.
- Deleting a category doesn't touch existing listings that used it (their `category`
  text remains); it just removes it from the picker.

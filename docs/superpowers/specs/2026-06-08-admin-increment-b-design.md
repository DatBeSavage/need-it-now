# Need-It-Now — Admin Increment B design (content moderation)

Status: approved 2026-06-08 (roadmap-approved). Builds on Increment A. Makes the
admin dashboard **actionable**: clear the report queue and remove bad listings.
Additive, idempotent schema.

## Goal
Admins can resolve/dismiss reports and hide or delete **any** listing, all from the
dashboard. Hidden listings disappear from the public feed. Enforcement is in RLS.

## Schema changes
- `reports.status text not null default 'open' check (status in ('open','resolved','dismissed'))`.
- `listings.hidden boolean not null default false`.
- **reports update** — admins only:
  ```sql
  create policy "reports_update_admin" on public.reports for update
    using (public.is_admin()) with check (public.is_admin());
  ```
- **listings update/delete** — owner OR admin (extend the existing policies):
  ```sql
  -- using (auth.uid() = user_id or public.is_admin())  on both update and delete
  ```
  (Keep the existing `with check (auth.uid() = user_id)` semantics for inserts;
  update's `with check` becomes `auth.uid() = user_id or public.is_admin()`.)
- **`nearby_listings`** gains `and not l.hidden` in its WHERE (return type unchanged
  → plain `create or replace`, no drop). Hidden listings vanish from the feed.
- Admins still see hidden listings in the dashboard via `adminListListings()` (direct
  table read, not the RPC).

## API additions (`api.js`)
- `setReportStatus(reportId, status)` — `'resolved' | 'dismissed' | 'open'`.
- `setListingHidden(listingId, hidden)` — admin toggles `hidden` (also usable by owner).
- `adminDeleteListing(listingId)` — hard delete (RLS lets admin delete any).
- `adminListListings()` already returns everything; extend its select to include `hidden`.
- `adminListReports()` already returns `*`, which now includes `status`.

## UI (`admin.js`)
- **Reports tab:** each report shows its `status` as a badge; **Resolve** and
  **Dismiss** buttons (hidden once not `open`); resolved/dismissed rows dim. Buttons
  call `setReportStatus` then re-render.
- **Listings tab:** each row gets **Hide/Unhide** (reflecting `hidden`) and **Delete**
  (with a confirm). Hidden rows show a "Hidden" badge. Actions re-render the tab.
- All actions are admin-only by RLS; the buttons live only on the admin dashboard.

## Manual step
Re-run `supabase/schema.sql` (adds the two columns, the reports-update policy, the
listings policy updates, and the `not hidden` feed filter). Idempotent.

## Testing
- **REST:** as admin — set a report to resolved (200) and read back `status`; hide a
  listing (200) and confirm it drops from `nearby_listings` but still appears in
  `adminListListings`; delete a listing (204). As non-admin — updating someone
  else's report or listing, or deleting a listing you don't own, is rejected (4xx);
  hiding still works on your *own* listing (owner path) but not others'.
- **UI:** admin Reports tab resolve/dismiss updates the badge; Listings tab
  hide/unhide/delete works and the hidden one disappears from the feed.

## Not in B
User bans (C), settings/rules (D).

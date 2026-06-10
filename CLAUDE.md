# Project map — Need-It-Now (local marketplace)

A static HTML/CSS/JS front end backed by **Supabase** (hosted Postgres + Auth +
auto REST API). The front end is served by a local preview that hot-reloads on
save, and is also hostable as a plain static site (GitHub Pages). All shared data
(accounts, listings, responses) lives in Supabase — different browsers/users see
the same data. The browser talks to Supabase directly over HTTPS using the
**publishable key**; Row-Level Security (RLS) is what protects the data.

## Where things live
- **Landing page**: `index.html` in the project root.
- **App pages** live in `pages/`: `register.html`, `login.html`, `post.html`,
  `feed.html`. Each is standalone HTML.
- **Styles** are in `assets/css/`:
  - `tokens.css` — design tokens in `:root` (blue primary, green money accent,
    neutrals, type + spacing scale, radius, shadows). Re-theme here.
  - `main.css` — layout & components (nav, buttons, forms, cards, feed, modal).
- **Scripts** are in `assets/js/` and load as ES modules (`<script type="module">`):
  - `config.js` — Supabase URL + publishable key, the demo ZIP→lat/lng table,
    and `zipCoord()`.
  - `api.js` — creates the Supabase client (imported from esm.sh) and exports the
    data API: `signUp/signIn/signOut`, `getUser/getProfile`, `nearbyListings`
    (calls the `nearby_listings` RPC), `createListing`, `addResponse`.
  - `auth.js` — renders nav user state on every page, register/login/logout
    handlers, `requireAuth()` guard, `toast()`, `go()/base()` helpers.
  - `feed.js` — feed page: location + radius filtering, type chips, search,
    respond modal. Distance + response counts come from the RPC rows.
  - `post.js` — create-listing form on `post.html`.
- **Database**: `supabase/schema.sql` (tables, RLS policies, triggers,
  `nearby_listings` geo function) and `supabase/seed.sql` (demo listings).

## Backend / Supabase
- Tables: `profiles` (1 per auth user), `listings`, `responses`.
- Auth: Supabase email+password. A trigger (`handle_new_user`) auto-creates the
  `profiles` row from sign-up metadata (`name`, `zip`). Email confirmation is
  expected to be OFF for the prototype (instant sign-in).
- Location/radius: each listing stores `lat/lng` (resolved from ZIP client-side at
  post time). The `nearby_listings(lat,lng,radius_mi,type,q)` SQL function returns
  listings within radius with a computed `distance_mi`, nearest first.
- `listings.response_count` is bumped once per new conversation (`bump_interest_count`).
- **Write-protection model (don't undo this):** RLS is row-level only, so columns are
  locked with Postgres `GRANT UPDATE (cols)`. Clients may update only content fields on
  `profiles` (name/zip/bio/avatar_path) and `listings` (the listing fields + `photos`).
  Protected columns are written only by privileged code: `rating_avg`/`rating_count` by
  the `recompute_rating` trigger; `listings.hidden` by the `admin_set_listing_hidden()`
  RPC (admin-only); deal confirmation by `mark_dealt()` (sets only the caller's side —
  both parties must confirm before `dealt_at` is set, which gates ratings). Any URL built
  from a stored field (avatar_path, photos) MUST be HTML-escaped before going into markup.
- **Listing photos**: up to 4 per listing in `listings.photos text[]`, stored in the
  public `listings` storage bucket under `<uid>/...`; first photo is the card cover.
- To change the schema, edit `supabase/schema.sql` and re-run it in the Supabase
  SQL Editor (it is idempotent). To reseed, run `supabase/seed.sql`.

## Shared nav (keep in sync!)
Every page has the same `<nav class="nav">…</nav>`. There is no include system —
when you add or rename a page you MUST update the nav links in EVERY page.
- Root page (`index.html`) links to `pages/feed.html`, `pages/post.html`.
- Pages inside `pages/` link to `../index.html`, `feed.html`, `post.html`.
- Mark the current page's link with `class="active"`.
- The `<div ... data-nav-user></div>` slot is filled by `auth.js` (logged-out:
  Log in / Sign up; logged-in: + Post, avatar, Log out). Leave it empty in HTML.
- Pages in `pages/` use `../assets/...` paths; the root page uses `assets/...`.

## How to make changes
- **Add a page** in `pages/`: copy an existing page, fix its `<title>`, set its
  own nav link `active`, add the link to the nav on every other page, keep the
  `../assets/...` paths, and load page JS as `<script type="module">`.
- **Edit behavior**: change the relevant JS module. New data access goes through
  `api.js` (don't sprinkle `supabase` calls across pages).
- **Restyle**: edit `assets/css/tokens.css` first (the `:root` tokens).

## Don't touch
- `.phosphor-site.json` (project manifest, managed by the app).
- `config.js` keys are the *publishable* key only — never put the service_role /
  secret key in front-end code.

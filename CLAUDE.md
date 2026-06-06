# Project map — Need-It-Now (local marketplace prototype)

A plain HTML/CSS/JS static site served by a local preview that hot-reloads on
save. It's a front-end-only prototype of a local buy/sell marketplace — all data
(users, listings, responses, session) lives in the browser via `localStorage`.
There is NO backend; "accounts" are not secure and are not shared between
browsers. A real version would need a server + database.

## Where things live
- **Landing page**: `index.html` in the project root.
- **App pages** live in `pages/`: `register.html`, `login.html`, `post.html`,
  `feed.html`. Each is standalone HTML.
- **Styles** are in `assets/css/`:
  - `tokens.css` — design tokens in `:root` (blue primary, green money accent,
    neutrals, type + spacing scale, radius, shadows). Re-theme here; never
    hard-code colors/sizes in pages.
  - `main.css` — layout & components (nav, buttons, forms, cards, feed, modal).
- **Scripts** are in `assets/js/` (loaded in this order on each page):
  - `store.js` — `window.NIN`: localStorage CRUD for users/listings/responses/
    session, the sample ZIP→lat/lng table, and `distanceMiles()` (haversine).
  - `seed.js` — sample users + listings; seeds localStorage only if empty.
  - `auth.js` — `window.NINAuth`: renders the nav user state on every page,
    register/login form handlers, `requireAuth()` guard, `toast()`.
  - `feed.js` — feed page: location + radius filtering, type chips, search,
    respond modal.
  - `post.js` — create-listing form on `post.html`.

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
  own nav link `active`, add the link to the nav on every other page, and keep
  the `../assets/...` script/style paths.
- **Edit a page / behavior**: change just that file or the relevant JS module.
  Keep edits surgical.
- **Restyle**: edit `assets/css/tokens.css` first (the `:root` tokens).
- **Sample data / ZIPs**: edit `seed.js` (listings/users) and the `ZIPS` table in
  `store.js`. To reset the demo, run `NIN.reset()` in the browser console.

## Don't touch
- `.phosphor-site.json` (project manifest, managed by the app).

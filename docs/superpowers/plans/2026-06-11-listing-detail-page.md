# Listing Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated `listing.html?id=<uuid>` page showing all of a listing's photos and full details with the primary actions, reachable by clicking any feed card.

**Architecture:** New standalone page + `listing.js` module, following the existing `profile.html?u=` multi-page pattern. A new `getListingDetail(id)` in `api.js` fetches the listing and merges owner data. The gallery is responsive (desktop cover+thumbnails+lightbox / mobile swipe carousel), chosen at render time via `matchMedia`. Feed cards become whole-clickable via the stretched-link pattern.

**Tech Stack:** Vanilla JS ES modules, supabase-js v2, CSS (scroll-snap, matchMedia), no build step, no test framework.

**Spec:** `docs/superpowers/specs/2026-06-11-listing-detail-page-design.md`

**Verification note (IMPORTANT):** The preview browser caches ES modules hard. Before verifying any change, force-refresh every touched JS/CSS file, then reload:
```js
await Promise.all(["/assets/js/api.js","/assets/js/listing.js","/assets/js/feed.js","/assets/css/main.css"].map(u => fetch(u,{cache:"reload"}))); location.reload();
```
A plain reload is not enough. Verification is manual via the running preview (serverId from `preview_list`).

---

### Task 1: `getListingDetail(id)` in api.js

**Files:**
- Modify: `assets/js/api.js` (add after `getListing`, ~line 97)

- [ ] **Step 1: Add the function**

Insert directly after the `getListing` function (which ends at `assets/js/api.js:97`):

```js
/* Listing + merged owner fields, shaped like a nearby_listings feed row so it
   works with openChatForListing / avatarHTML / starsHTML. Returns null when the
   listing is missing, or hidden and the viewer is neither owner nor admin. */
export async function getListingDetail(id) {
  const listing = await getListing(id);
  if (!listing) return null;
  if (listing.hidden) {
    const me = await getProfile();
    let admin = false;
    try { admin = await amIAdmin(); } catch (e) { admin = false; }
    if (!(me && me.id === listing.user_id) && !admin) return null;
  }
  let owner = null;
  if (listing.user_id) {
    try { owner = await getProfileById(listing.user_id); } catch (e) { owner = null; }
  }
  return Object.assign({}, listing, {
    owner_avatar: owner ? owner.avatar_path : null,
    owner_rating: owner ? owner.rating_avg : 0,
    owner_rating_count: owner ? owner.rating_count : 0,
    owner_bio: owner ? owner.bio : "",
  });
}
```

`getListing`, `getProfile`, `amIAdmin`, and `getProfileById` all already exist in this file — no new imports.

- [ ] **Step 2: Verify in the preview**

On the feed page, run (cache-bust first):
```js
(async () => {
  await fetch("/assets/js/api.js", { cache: "reload" });
  const api = await import("/assets/js/api.js?v=" + Date.now());
  const rows = await api.nearbyListings({ lat: 30.2711, lng: -97.7437, radius: 50, type: "all", q: "" });
  if (!rows.length) return "no listings to test with";
  const d = await api.getListingDetail(rows[0].id);
  return JSON.stringify({ id: d.id, title: d.title, hasOwnerRating: "owner_rating" in d, photos: (d.photos||[]).length });
})()
```
Expected: an object with the listing's id/title, `hasOwnerRating: true`, and a photo count. A bogus id returns `null`:
```js
(async () => { const api = await import("/assets/js/api.js?v=" + Date.now()); return await api.getListingDetail("00000000-0000-0000-0000-000000000000"); })()
```
Expected: `null`.

- [ ] **Step 3: Commit**

```bash
git add assets/js/api.js
git commit -m "feat(api): getListingDetail — listing + merged owner, hidden-aware"
```

---

### Task 2: `pages/listing.html`

**Files:**
- Create: `pages/listing.html`

- [ ] **Step 1: Create the page** (mirrors `profile.html`'s chrome; not added to any nav)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Listing — Need-It-Now</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="preconnect" href="https://yubhbztyprfupvjwxwmm.supabase.co" crossorigin />
  <link rel="preconnect" href="https://esm.sh" crossorigin />
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
        <a href="guidelines.html">Guidelines</a>
      </div>
      <div class="nav__user" data-nav-user></div>
    </div>
  </nav>

  <main class="wrap" style="padding-block:var(--sp-5)">
    <a href="feed.html" class="backlink">&larr; Back to feed</a>
    <div id="listing-root"></div>
  </main>

  <div class="lightbox" data-lightbox hidden></div>

  <script type="module" src="../assets/js/auth.js"></script>
  <script type="module" src="../assets/js/listing.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add the backlink style** to `assets/css/main.css` (near the `.feed-head` rules, ~line 192)

```css
.backlink { display: inline-block; margin-bottom: var(--sp-3); color: var(--blue-600); font-weight: 700; font-size: var(--fs-sm); text-decoration: none; }
.backlink:hover { text-decoration: underline; }
```

- [ ] **Step 3: Verify**

Navigate the preview to `/pages/listing.html`. Expected: nav + "← Back to feed" render; `#listing-root` is empty (no `listing.js` yet → console may warn that the module 404s only if not created; since Task 3 creates it, expect a 404 for listing.js for now — acceptable at this step, or skip console check until Task 3). The page chrome and backlink display correctly.

- [ ] **Step 4: Commit**

```bash
git add pages/listing.html assets/css/main.css
git commit -m "feat: listing detail page shell (nav, backlink, mounts)"
```

---

### Task 3: `listing.js` core — load, not-found, details, owner, actions + detail CSS

**Files:**
- Create: `assets/js/listing.js`
- Modify: `assets/css/main.css` (detail layout + a minimal gallery)

- [ ] **Step 1: Create `assets/js/listing.js`** (gallery is a simple cover image here; Task 4 upgrades it)

```js
// Need-It-Now — listing detail page.
import { getListingDetail, getProfile, deleteListing, listingPhotoUrl } from "./api.js";
import { resolveZip } from "./config.js";
import { toast, go } from "./auth.js";
import { confirmDialog } from "./ui.js";
import { openChatForListing } from "./chat.js";
import { openReport } from "./report.js";
import { avatarHTML } from "./avatar.js";
import { starsHTML } from "./stars.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function timeAgo(iso) {
  var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  var h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

var currentProfile = null;

function notFound(root) {
  root.innerHTML = '<div class="empty"><div class="em">🔍</div>' +
    "<p>This listing isn't available — it may have been removed. " +
    '<a href="feed.html" style="color:var(--blue-600);font-weight:700">Back to the feed</a>.</p></div>';
}

function ownerCardHTML(row) {
  if (!row.user_id) return '<div class="owner-card"><span class="muted">Sample listing</span></div>';
  var person = { name: row.owner_name, avatar_path: row.owner_avatar };
  return '<a class="owner-card" href="profile.html?u=' + encodeURIComponent(row.user_id) + '">' +
    avatarHTML(person, "md") +
    "<div><strong>" + esc(row.owner_name) + "</strong>" +
      starsHTML(row.owner_rating, row.owner_rating_count, "sm") +
      (row.owner_bio ? '<p class="muted owner-card__bio">' + esc(row.owner_bio) + "</p>" : "") +
    "</div></a>";
}

// Simple placeholder gallery — Task 4 replaces this with the responsive version.
function renderGallery(mount, row) {
  var photos = (row.photos || []).map(listingPhotoUrl).filter(Boolean);
  if (!photos.length) { mount.innerHTML = '<div class="gallery__empty">' + esc(row.emoji || "📦") + "</div>"; return; }
  mount.innerHTML = '<img class="gallery__main" src="' + esc(photos[0]) + '" alt="" />';
}

function renderActions(mount, row, mine) {
  if (mine) {
    mount.innerHTML =
      '<a class="btn btn--ghost" href="post.html?id=' + encodeURIComponent(row.id) + '">Edit</a>' +
      '<button class="btn btn--danger" data-delete>Delete</button>';
    mount.querySelector("[data-delete]").addEventListener("click", async function () {
      var ok = await confirmDialog({ title: "Delete this listing?", body: "This can't be undone.",
        confirmLabel: "Delete", danger: true });
      if (!ok) return;
      try { await deleteListing(row.id); toast("Listing deleted.", { type: "success" }); go("pages/feed.html"); }
      catch (e) { toast((e && e.message) || "Couldn't delete — try again.", { type: "error" }); }
    });
    return;
  }
  var label = row.type === "sell" ? "I'm interested" : "I have one";
  mount.innerHTML = '<button class="btn btn--primary" data-respond>' + label + "</button>" +
    (row.user_id ? '<button class="btn btn--ghost" data-report>Report</button>' : "");
  mount.querySelector("[data-respond]").addEventListener("click", function () { openChatForListing(row); });
  var rep = mount.querySelector("[data-report]");
  if (rep) rep.addEventListener("click", function () {
    openReport({ reportedUserId: row.user_id, reportedName: row.owner_name, listingId: row.id });
  });
}

function render(root, row) {
  var mine = !!(currentProfile && row.user_id && row.user_id === currentProfile.id);
  var badge = row.type === "sell"
    ? '<span class="badge badge--sell">For sale</span>'
    : '<span class="badge badge--buy">Looking to buy</span>';
  var priceLabel = row.type === "sell" ? money(row.price) : "Budget " + money(row.price);
  document.title = (row.title ? row.title + " — " : "") + "Need-It-Now";

  root.innerHTML =
    '<div class="detail">' +
      '<div class="detail__gallery" data-gallery></div>' +
      '<div class="detail__info">' +
        '<div class="detail__top">' + badge +
          '<span class="price detail__price">' + esc(priceLabel) + "</span></div>" +
        '<h1 class="detail__title">' + esc(row.title) + "</h1>" +
        '<div class="detail__meta muted">' +
          '<span class="pin">📍 ' + esc(row.zip || "") + "</span> · " +
          "posted " + timeAgo(row.created_at) + " · " +
          (row.response_count || 0) + " interested</div>" +
        (row.category ? '<span class="chip detail__cat">' + esc(row.category) + "</span>" : "") +
        '<p class="detail__desc">' + esc(row.description) + "</p>" +
        ownerCardHTML(row) +
        '<div class="detail__actions" data-actions></div>' +
      "</div>" +
    "</div>";

  renderGallery(root.querySelector("[data-gallery]"), row);
  renderActions(root.querySelector("[data-actions]"), row, mine);

  var pin = root.querySelector(".pin");
  resolveZip(row.zip).then(function (o) { if (o && pin) pin.textContent = "📍 " + o.city; }).catch(function () {});
}

document.addEventListener("DOMContentLoaded", async function () {
  var root = document.getElementById("listing-root");
  if (!root) return;
  var id = new URLSearchParams(location.search).get("id");
  if (!id) { notFound(root); return; }
  try { currentProfile = await getProfile(); } catch (e) { currentProfile = null; }
  var row;
  try { row = await getListingDetail(id); } catch (e) { notFound(root); return; }
  if (!row) { notFound(root); return; }
  render(root, row);
});
```

- [ ] **Step 2: Add detail-layout CSS** to `assets/css/main.css` (after the `.backlink` rules from Task 2)

```css
/* ---- Listing detail page ---- */
.detail { display: grid; grid-template-columns: minmax(0,1.1fr) minmax(0,.9fr); gap: var(--sp-6); align-items: start; }
.detail__info { display: flex; flex-direction: column; gap: var(--sp-3); }
.detail__top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.detail__price { font-size: var(--fs-xl); }
.detail__title { font-size: var(--fs-2xl); }
.detail__meta { font-size: var(--fs-sm); }
.detail__cat { align-self: flex-start; text-transform: capitalize; }
.detail__desc { white-space: pre-wrap; color: var(--ink-2); }
.detail__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-2); flex-wrap: wrap; }
.owner-card { display: flex; gap: var(--sp-3); align-items: center; text-decoration: none; color: inherit;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-3); }
.owner-card:hover { border-color: var(--border-2); }
.owner-card__bio { font-size: var(--fs-sm); margin-top: 2px; }
.detail__gallery { position: sticky; top: calc(var(--nav-h) + var(--sp-3)); }
.gallery__empty { aspect-ratio: 16/10; display: grid; place-items: center; font-size: 4rem;
  background: var(--grad-media); border: 1px solid var(--border); border-radius: var(--r-md); }
.gallery__main { width: 100%; aspect-ratio: 16/10; object-fit: cover; display: block;
  border: 1px solid var(--border); border-radius: var(--r-md); }
@media (max-width: 760px) {
  .detail { grid-template-columns: 1fr; gap: var(--sp-4); }
  .detail__gallery { position: static; }
}
```

- [ ] **Step 3: Verify** (cache-bust per the verification note, then reload)

Get a real listing id (from `nearbyListings` in console), then navigate to `/pages/listing.html?id=<id>`:
```js
(async () => {
  await Promise.all(["/assets/js/api.js","/assets/js/listing.js","/assets/css/main.css"].map(u => fetch(u,{cache:"reload"})));
  const api = await import("/assets/js/api.js?v=" + Date.now());
  const rows = await api.nearbyListings({ lat: 30.2711, lng: -97.7437, radius: 50, type: "all", q: "" });
  return rows.length ? rows[0].id : "no listings";
})()
```
Navigate to `.../listing.html?id=<that id>`, wait ~2s, then:
```js
JSON.stringify({
  title: document.querySelector(".detail__title") && document.querySelector(".detail__title").textContent,
  hasOwner: !!document.querySelector(".owner-card"),
  actionBtns: Array.from(document.querySelectorAll(".detail__actions .btn")).map(b => b.textContent),
  gallery: !!document.querySelector("[data-gallery] img, [data-gallery] .gallery__empty"),
  docTitle: document.title,
})
```
Expected: real title; owner card present; action buttons are either ["I'm interested"/"I have one","Report"] (not yours) or ["Edit","Delete"] (yours); gallery shows. Then test not-found: navigate to `.../listing.html?id=bad` → `.empty` panel with "Back to the feed". No console errors.

- [ ] **Step 4: Commit**

```bash
git add assets/js/listing.js assets/css/main.css
git commit -m "feat: listing detail page — load, details, owner card, actions"
```

---

### Task 4: Responsive gallery + lightbox

**Files:**
- Modify: `assets/js/listing.js` (replace `renderGallery`, add gallery/lightbox helpers)
- Modify: `assets/css/main.css` (gallery thumbnails, carousel, lightbox)

- [ ] **Step 1: Replace `renderGallery` in `listing.js`** with the responsive version + helpers

Replace the entire `renderGallery` function (the "simple placeholder" one) with this block:

```js
var MOBILE = window.matchMedia("(max-width: 760px)");
var galleryCtx = null;

function renderGallery(mount, row) {
  galleryCtx = { mount: mount, photos: (row.photos || []).map(listingPhotoUrl).filter(Boolean), emoji: row.emoji || "📦" };
  paintGallery();
}

function paintGallery() {
  if (!galleryCtx) return;
  var mount = galleryCtx.mount, photos = galleryCtx.photos;
  if (!photos.length) { mount.innerHTML = '<div class="gallery__empty">' + esc(galleryCtx.emoji) + "</div>"; return; }
  if (MOBILE.matches) paintCarousel(mount, photos);
  else paintStrip(mount, photos);
}

function paintStrip(mount, photos) {
  var current = 0;
  var thumbs = photos.length > 1
    ? '<div class="gallery__thumbs">' + photos.map(function (p, i) {
        return '<button type="button" class="gallery__thumb' + (i === 0 ? " is-active" : "") + '" data-i="' + i + '">' +
          '<img src="' + esc(p) + '" alt="" loading="lazy" /></button>';
      }).join("") + "</div>"
    : "";
  mount.innerHTML =
    '<button type="button" class="gallery__mainbtn" data-open>' +
      '<img class="gallery__main" data-main src="' + esc(photos[0]) + '" alt="" /></button>' + thumbs;
  var main = mount.querySelector("[data-main]");
  mount.querySelectorAll(".gallery__thumb").forEach(function (t) {
    t.addEventListener("click", function () {
      current = +t.getAttribute("data-i");
      main.src = photos[current];
      mount.querySelectorAll(".gallery__thumb").forEach(function (x) { x.classList.remove("is-active"); });
      t.classList.add("is-active");
    });
  });
  mount.querySelector("[data-open]").addEventListener("click", function () { openLightbox(photos, current); });
}

function paintCarousel(mount, photos) {
  mount.innerHTML =
    '<div class="gallery__track" data-track>' +
      photos.map(function (p) { return '<img class="gallery__slide" src="' + esc(p) + '" alt="" />'; }).join("") +
    "</div>" +
    (photos.length > 1
      ? '<div class="gallery__dots">' + photos.map(function (_, i) {
          return '<span class="gallery__dot' + (i === 0 ? " is-active" : "") + '"></span>'; }).join("") + "</div>"
      : "");
  if (photos.length < 2) return;
  var track = mount.querySelector("[data-track]");
  var dots = mount.querySelectorAll(".gallery__dot");
  track.addEventListener("scroll", function () {
    var i = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach(function (d, di) { d.classList.toggle("is-active", di === i); });
  }, { passive: true });
}

function openLightbox(photos, startIndex) {
  var box = document.querySelector("[data-lightbox]");
  var i = startIndex || 0;
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" && photos.length > 1) { i = (i - 1 + photos.length) % photos.length; paint(); }
    else if (e.key === "ArrowRight" && photos.length > 1) { i = (i + 1) % photos.length; paint(); }
  }
  function close() { document.removeEventListener("keydown", onKey); box.hidden = true; box.classList.remove("open"); box.innerHTML = ""; }
  function paint() {
    box.innerHTML =
      '<button class="lightbox__close" data-close aria-label="Close">✕</button>' +
      (photos.length > 1 ? '<button class="lightbox__nav lightbox__prev" data-prev aria-label="Previous">‹</button>' : "") +
      '<img class="lightbox__img" src="' + esc(photos[i]) + '" alt="" />' +
      (photos.length > 1 ? '<button class="lightbox__nav lightbox__next" data-next aria-label="Next">›</button>' : "");
    box.querySelector("[data-close]").addEventListener("click", close);
    var prev = box.querySelector("[data-prev]"), next = box.querySelector("[data-next]");
    if (prev) prev.addEventListener("click", function (e) { e.stopPropagation(); i = (i - 1 + photos.length) % photos.length; paint(); });
    if (next) next.addEventListener("click", function (e) { e.stopPropagation(); i = (i + 1) % photos.length; paint(); });
  }
  box.hidden = false; box.classList.add("open");
  box.onclick = function (e) { if (e.target === box) close(); };
  document.addEventListener("keydown", onKey);
  paint();
}

MOBILE.addEventListener("change", paintGallery);
```

(The `MOBILE.addEventListener("change", ...)` line registers once at module load and re-renders the gallery when the viewport crosses the breakpoint. This self-contained lightbox keydown handler is used instead of `escToClose` so the listener is removed on close and arrow-key nav is supported — no per-open listener leak.)

- [ ] **Step 2: Add gallery + lightbox CSS** to `assets/css/main.css` (right after the `.gallery__main` rule from Task 3, before the `@media (max-width: 760px)` block)

```css
.gallery__mainbtn { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.gallery__thumbs { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
.gallery__thumb { flex: 1; padding: 0; border: 2px solid transparent; border-radius: var(--r-sm);
  overflow: hidden; cursor: pointer; background: none; aspect-ratio: 1; }
.gallery__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gallery__thumb.is-active { border-color: var(--blue-600); }
.gallery__track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory;
  border: 1px solid var(--border); border-radius: var(--r-md); scrollbar-width: none; }
.gallery__track::-webkit-scrollbar { display: none; }
.gallery__slide { flex: 0 0 100%; width: 100%; aspect-ratio: 16/10; object-fit: cover; scroll-snap-align: center; }
.gallery__dots { display: flex; gap: 6px; justify-content: center; margin-top: var(--sp-2); }
.gallery__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border-2); }
.gallery__dot.is-active { background: var(--blue-600); }
.lightbox { position: fixed; inset: 0; z-index: 300; background: rgba(11,12,14,.9);
  display: none; place-items: center; padding: var(--sp-4); }
.lightbox.open { display: grid; }
.lightbox__img { max-width: 92vw; max-height: 88vh; object-fit: contain; border-radius: var(--r-sm); }
.lightbox__close { position: absolute; top: var(--sp-4); right: var(--sp-4); width: 42px; height: 42px;
  border: 0; border-radius: var(--r-pill); background: rgba(255,255,255,.14); color: #fff; font-size: 20px; cursor: pointer; }
.lightbox__close:hover { background: rgba(255,255,255,.26); }
.lightbox__nav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 46px;
  border: 0; border-radius: var(--r-pill); background: rgba(255,255,255,.14); color: #fff; font-size: 26px; cursor: pointer; }
.lightbox__nav:hover { background: rgba(255,255,255,.26); }
.lightbox__prev { left: var(--sp-3); }
.lightbox__next { right: var(--sp-3); }
```

- [ ] **Step 3: Verify** (cache-bust + reload). Use a listing that has ≥2 photos if one exists; otherwise post a test listing with photos via the post page or note the single-photo path.

Desktop (default preview width): on `listing.html?id=<id with photos>`:
```js
JSON.stringify({
  hasMain: !!document.querySelector(".gallery__mainbtn [data-main]"),
  thumbCount: document.querySelectorAll(".gallery__thumb").length,
})
```
Click a thumbnail (`document.querySelectorAll('.gallery__thumb')[1].click()`) → `[data-main].src` changes and the clicked thumb gets `is-active`. Click the main image (`document.querySelector('[data-open]').click()`) → `.lightbox.open` appears; dispatch ArrowRight/Escape keydown events → image advances / closes (`document.querySelector('[data-lightbox]').hidden === true`).

Mobile: `preview_resize` to 390px wide (or set the viewport), cache-bust + reload, then:
```js
JSON.stringify({ track: !!document.querySelector(".gallery__track"), slides: document.querySelectorAll(".gallery__slide").length, dots: document.querySelectorAll(".gallery__dot").length })
```
Expected: carousel track + slides + dots present; no thumbnail strip. Scroll the track and confirm the active dot follows.

- [ ] **Step 4: Commit**

```bash
git add assets/js/listing.js assets/css/main.css
git commit -m "feat: responsive listing gallery — desktop strip+lightbox, mobile carousel"
```

---

### Task 5: Feed card whole-clickable (stretched link)

**Files:**
- Modify: `assets/js/feed.js` (`cardHTML`, the title line ~62)
- Modify: `assets/css/main.css` (`.listing` stretched-link rules, near `.listing` ~243)

- [ ] **Step 1: Make the title a stretched link in `feed.js`**

In `cardHTML`, replace the title line:
```js
        '<h3 class="listing__title">' + escapeHTML(row.title) + "</h3>" +
```
with:
```js
        '<h3 class="listing__title"><a class="listing__title-link" href="listing.html?id=' +
          encodeURIComponent(row.id) + '">' + escapeHTML(row.title) + "</a></h3>" +
```

- [ ] **Step 2: Add stretched-link CSS** to `assets/css/main.css` (immediately after the `.listing { ... }` rule, ~line 248)

```css
.listing { position: relative; cursor: pointer; }
.listing__title-link { color: inherit; text-decoration: none; }
.listing__title-link::after { content: ""; position: absolute; inset: 0; z-index: 0; }
.listing__title-link:focus-visible { outline: 2px solid var(--blue-600); outline-offset: 2px; }
.listing:hover .listing__title { color: var(--blue-700); }
/* Keep the in-card controls clickable above the stretched overlay */
.listing__foot, .listing .owner { position: relative; z-index: 1; }
.listing__foot, .listing .owner { cursor: auto; }
```

Note: the existing `.listing { ... }` rule already sets `position`-affecting properties? It does not set `position`; this adds it. The existing `.listing:hover` transform rule is unaffected.

- [ ] **Step 3: Verify** (cache-bust feed.js + main.css, reload feed)

On `/pages/feed.html`, with at least one listing:
```js
(() => {
  const card = document.querySelector("#listings .listing");
  const link = card.querySelector(".listing__title-link");
  const foot = card.querySelector(".listing__foot");
  return JSON.stringify({
    titleIsLink: !!link && link.getAttribute("href").startsWith("listing.html?id="),
    cardPositioned: getComputedStyle(card).position === "relative",
    footAboveOverlay: getComputedStyle(foot).zIndex === "1",
  });
})()
```
Expected: all true. Then manual click test: clicking the card body/title navigates to `listing.html?id=...`; clicking the "I'm interested" / Edit / Delete / Report / owner-name does NOT navigate (opens chat / goes to edit / confirms delete / opens report / goes to profile). Use a screenshot to confirm the card looks unchanged.

- [ ] **Step 4: Commit**

```bash
git add assets/js/feed.js assets/css/main.css
git commit -m "feat: feed cards open the listing detail (stretched-link, controls stay clickable)"
```

---

### Task 6: Docs + final audit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the project map**

In the **App pages** bullet, add `listing.html` to the list (after `feed.html`):
```markdown
- **App pages** live in `pages/`: `register.html`, `login.html`, `reset.html`,
  `post.html`, `feed.html`, `listing.html`, `messages.html`, `profile.html`,
  `admin.html`, `guidelines.html`. Each is standalone HTML.
```

In the scripts list, add after the `feed.js` bullet:
```markdown
  - `listing.js` — listing detail page (`listing.html?id=`): responsive photo
    gallery (desktop cover+thumbnails+lightbox, mobile swipe carousel), full
    details, owner card, and actions (chat/report, or edit/delete if yours).
```

In the **Listing photos** note (under Backend / Supabase), append:
```markdown
  The detail page (`listing.html`) shows all photos; `getListingDetail(id)`
  returns the listing merged with owner avatar/rating/bio (null when hidden and
  the viewer isn't the owner/admin).
```

- [ ] **Step 2: Escape + responsive audit** (read-only, fix if needed)

Confirm by reading `listing.js` that every stored field reaching markup is wrapped in `esc()` (title, description, owner_name, owner_bio, category, zip) or `encodeURIComponent` (ids in URLs), and photo URLs go through `listingPhotoUrl` then `esc()`. Grep for any raw interpolation:
```
rg "innerHTML" assets/js/listing.js
```
Every `innerHTML` assignment must use only `esc()`/`encodeURIComponent`-wrapped dynamic values. If any raw field is found, wrap it and amend.

- [ ] **Step 3: XSS spot-check** in the preview

In the SQL editor or via an authenticated client, this is optional; at minimum verify in console that `esc` neutralizes markup:
```js
(async () => { const m = await import("/assets/js/listing.js?v=" + Date.now()); return "loaded"; })()
```
(Module has no exported esc; the structural guarantee is the audit in Step 2. If a test listing with `<b>` in its title exists, load its detail page and confirm the title shows literal `<b>` text, not bold.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add listing detail page to the project map"
```

---

## Final verification sweep

- [ ] Cache-bust all touched files, reload, and walk: feed → click a card → detail page renders (gallery, details, owner, actions).
- [ ] Desktop: thumbnail swap + lightbox (open, arrows, Esc, backdrop close).
- [ ] Mobile (resized): carousel swipe + dot sync; no lightbox.
- [ ] Your own listing shows Edit/Delete; delete confirms → removes → returns to feed.
- [ ] Someone else's listing shows Interested (opens chat) + Report (opens report).
- [ ] Not-found (`?id=bad`) and logged-out viewing both work without console errors.
- [ ] From the feed, the in-card buttons (Interested/Edit/Delete/Report/owner) still work and do NOT trigger navigation.
- [ ] `rg "innerHTML" assets/js/listing.js` — every dynamic value escaped.

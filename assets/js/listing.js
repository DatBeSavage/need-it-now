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

function wirePhotoFallback(mount) {
  mount.querySelectorAll("img").forEach(function (img) {
    img.addEventListener("error", function () {
      var thumb = img.closest(".gallery__thumb");
      if (thumb) { thumb.hidden = true; return; }
      if (img.classList.contains("gallery__slide")) { img.hidden = true; return; }
      var btn = img.closest(".gallery__mainbtn");
      var d = document.createElement("div");
      d.className = "gallery__empty";
      d.textContent = galleryCtx ? galleryCtx.emoji : "📦";
      (btn || img).replaceWith(d);
    });
  });
}

function paintStrip(mount, photos) {
  var current = 0;
  var thumbs = photos.length > 1
    ? '<div class="gallery__thumbs">' + photos.map(function (p, i) {
        return '<button type="button" class="gallery__thumb' + (i === 0 ? " is-active" : "") + '" data-i="' + i + '" aria-label="Photo ' + (i + 1) + '">' +
          '<img src="' + esc(p) + '" alt="" loading="lazy" /></button>';
      }).join("") + "</div>"
    : "";
  mount.innerHTML =
    '<button type="button" class="gallery__mainbtn" data-open aria-label="View photo full screen">' +
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
  wirePhotoFallback(mount);
}

function paintCarousel(mount, photos) {
  mount.innerHTML =
    '<div class="gallery__track" data-track>' +
      photos.map(function (p) { return '<img class="gallery__slide" src="' + esc(p) + '" alt="" loading="lazy" />'; }).join("") +
    "</div>" +
    (photos.length > 1
      ? '<div class="gallery__dots">' + photos.map(function (_, i) {
          return '<span class="gallery__dot' + (i === 0 ? " is-active" : "") + '"></span>'; }).join("") + "</div>"
      : "");
  if (photos.length < 2) { wirePhotoFallback(mount); return; }
  var track = mount.querySelector("[data-track]");
  var dots = mount.querySelectorAll(".gallery__dot");
  track.addEventListener("scroll", function () {
    var i = Math.max(0, Math.min(photos.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
    dots.forEach(function (d, di) { d.classList.toggle("is-active", di === i); });
  }, { passive: true });
  wirePhotoFallback(mount);
}

function openLightbox(photos, startIndex) {
  var opener = document.activeElement;
  var box = document.querySelector("[data-lightbox]");
  var i = startIndex || 0;
  function onKey(e) {
    if (e.key === "Escape") { if (document.querySelector(".modal-back.open")) return; close(); }
    else if (e.key === "ArrowLeft" && photos.length > 1) { i = (i - 1 + photos.length) % photos.length; paint(); }
    else if (e.key === "ArrowRight" && photos.length > 1) { i = (i + 1) % photos.length; paint(); }
  }
  function close() { document.removeEventListener("keydown", onKey); box.hidden = true; box.classList.remove("open"); box.innerHTML = ""; if (opener && opener.focus) opener.focus(); }
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
    var im = box.querySelector(".lightbox__img");
    im.addEventListener("error", function () { im.style.visibility = "hidden"; });
    var cb = box.querySelector("[data-close]"); if (cb) cb.focus();
  }
  box.hidden = false; box.classList.add("open");
  box.onclick = function (e) { if (e.target === box && e.detail <= 1) close(); };
  document.addEventListener("keydown", onKey);
  paint();
}

MOBILE.addEventListener("change", paintGallery);

function renderActions(mount, row, mine) {
  if (mine) {
    mount.innerHTML =
      '<a class="btn btn--ghost" href="post.html?id=' + encodeURIComponent(row.id) + '">Edit</a>' +
      '<button class="btn btn--danger" data-delete>Delete</button>';
    mount.querySelector("[data-delete]").addEventListener("click", async function () {
      var ok = await confirmDialog({ title: "Delete this listing?", body: "This can't be undone.",
        confirmLabel: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteListing(row.id);
        try { sessionStorage.removeItem("nin_feed_v1"); } catch (e2) { /* blocked */ }
        toast("Listing deleted.", { type: "success" });
        setTimeout(function () { go("pages/feed.html"); }, 900);
      }
      catch (e) { toast((e && e.message) || "Couldn't delete — try again.", { type: "error" }); }
    });
    return;
  }
  var label = row.type === "sell" ? "I'm interested" : "I have one";
  mount.innerHTML = '<button class="btn btn--primary" data-respond>' + label + "</button>" +
    (row.user_id ? '<button class="btn btn--ghost" data-report>Report</button>' : "");
  mount.querySelector("[data-respond]").addEventListener("click", function () {
    if (!currentProfile) { go("pages/login.html?next=" + encodeURIComponent("/pages/listing.html?id=" + row.id)); return; }
    openChatForListing(row);
  });
  var rep = mount.querySelector("[data-report]");
  if (rep) rep.addEventListener("click", function () {
    if (!currentProfile) { go("pages/login.html?next=" + encodeURIComponent("/pages/listing.html?id=" + row.id)); return; }
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

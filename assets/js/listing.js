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

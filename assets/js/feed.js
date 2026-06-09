// Need-It-Now — feed page: location + radius filtering, search, respond (Supabase).
import { nearbyListings, getProfile, deleteListing } from "./api.js";
import { resolveZip } from "./config.js";
import { fillZipDatalist } from "./zips.js";
import { toast, go } from "./auth.js";
import { openChatForListing } from "./chat.js";
import { avatarHTML } from "./avatar.js";
import { starBadge } from "./stars.js";

var state = { zip: "78701", radius: 25, type: "all", q: "" };
var currentProfile = null;
var lastRows = [];

function timeAgo(iso) {
  var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  var h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}
function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function escapeHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function isMine(row) {
  return !!(currentProfile && row.user_id && row.user_id === currentProfile.id);
}
function actionHTML(row) {
  if (isMine(row)) {
    return '<a class="btn btn--ghost btn--block" href="post.html?id=' + row.id + '">Edit</a>' +
      '<button class="btn btn--ghost" data-delete="' + row.id + '">Delete</button>';
  }
  return '<button class="btn btn--ghost btn--block" data-respond="' + row.id + '">' +
    (row.type === "sell" ? "I'm interested" : "I have one") + "</button>";
}

function cardHTML(row) {
  var badge = row.type === "sell"
    ? '<span class="badge badge--sell">For sale</span>'
    : '<span class="badge badge--buy">Looking to buy</span>';
  var d = row.distance_mi;
  var distTxt = (d == null) ? escapeHTML(row.zip || "")
    : (d < 1 ? "<1 mi away" : Math.round(d) + " mi away");
  var priceLabel = row.type === "sell" ? money(row.price) : "Budget " + money(row.price);
  return '' +
    '<article class="listing">' +
      '<div class="listing__media">' + (row.emoji || "📦") + "</div>" +
      '<div class="listing__body">' +
        '<div class="listing__top">' + badge +
          '<span class="price listing__price">' + priceLabel + "</span>" +
        "</div>" +
        '<h3 class="listing__title">' + escapeHTML(row.title) + "</h3>" +
        '<p class="listing__desc">' + escapeHTML(row.description) + "</p>" +
        '<div class="listing__meta">' +
          "<span>" +
          (function () {
            var person = { name: row.owner_name, avatar_path: row.owner_avatar };
            var inner = avatarHTML(person, "sm") + "<span>" + escapeHTML(row.owner_name) + "</span>" +
              starBadge(row.owner_rating, row.owner_rating_count);
            return row.user_id
              ? '<a class="owner" href="profile.html?u=' + row.user_id + '">' + inner + "</a>"
              : '<span class="owner">' + inner + "</span>";
          })() + " · " + timeAgo(row.created_at) +
          "</span>" +
          '<span class="pin">📍 ' + distTxt + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="listing__foot">' + actionHTML(row) +
        '<span class="muted" style="font-size:var(--fs-xs);white-space:nowrap">' +
          (row.response_count || 0) + " ↩</span>" +
      "</div>" +
    "</article>";
}

var renderToken = 0;
async function render() {
  var grid = document.getElementById("listings");
  var count = document.getElementById("result-count");
  var token = ++renderToken;
  var origin = await resolveZip(state.zip);
  if (token !== renderToken) return; // a newer render superseded this lookup

  if (!grid.dataset.loaded) {
    grid.innerHTML = '<div class="empty"><div class="em">⏳</div><p>Finding listings near you…</p></div>';
  }

  var rows;
  try {
    rows = await nearbyListings({
      lat: origin ? origin.lat : null,
      lng: origin ? origin.lng : null,
      radius: state.radius, type: state.type, q: state.q,
    });
  } catch (e) {
    if (token !== renderToken) return;
    grid.innerHTML = '<div class="empty"><div class="em">⚠️</div>' +
      "<p>Couldn't load listings. Check your connection and try again.</p></div>";
    if (count) count.textContent = "";
    return;
  }
  if (token !== renderToken) return; // a newer render superseded this one

  lastRows = rows;
  grid.dataset.loaded = "1";
  fillZipDatalist(document.getElementById("zip-list")); // grow autocomplete with any newly-resolved ZIP
  if (count) {
    var zipDigits = state.zip.replace(/[^0-9]/g, "").length;
    if (origin) {
      count.textContent = rows.length + " result" + (rows.length === 1 ? "" : "s") +
        " within " + state.radius + " mi of " + origin.city;
    } else if (zipDigits === 5) {
      count.textContent = "We couldn't find that ZIP — showing all recent listings.";
    } else {
      count.textContent = rows.length + " result" + (rows.length === 1 ? "" : "s");
    }
  }
  if (!rows.length) {
    grid.innerHTML = '<div class="empty"><div class="em">🔍</div>' +
      "<p>Nothing here yet. Try widening your radius or clearing filters — " +
      'or <a href="post.html" style="color:var(--blue-600);font-weight:700">post what you need</a>.</p></div>';
    return;
  }
  grid.innerHTML = rows.map(cardHTML).join("");
  grid.querySelectorAll("[data-respond]").forEach(function (btn) {
    btn.addEventListener("click", function () { openRespond(btn.getAttribute("data-respond")); });
  });
  grid.querySelectorAll("[data-delete]").forEach(function (btn) {
    btn.addEventListener("click", function () { confirmDelete(btn.getAttribute("data-delete")); });
  });
}

async function confirmDelete(id) {
  if (!window.confirm("Delete this listing? This can't be undone.")) return;
  try {
    await deleteListing(id);
    toast("Listing deleted.");
    render();
  } catch (e) {
    toast((e && e.message) || "Couldn't delete — try again.");
  }
}

var renderTimer;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 250); }

/* ---- Respond modal ---- */
function openRespond(id) {
  var row = lastRows.filter(function (r) { return r.id === id; })[0];
  if (!row) return;
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  openChatForListing(row);
}

function wireControls() {
  var loc = document.getElementById("ctl-zip");
  var rad = document.getElementById("ctl-radius");
  var radVal = document.getElementById("radius-val");
  var search = document.getElementById("ctl-search");

  state.zip = (currentProfile && currentProfile.zip) || "78701";
  loc.value = state.zip;
  rad.value = state.radius;
  radVal.textContent = state.radius;

  loc.addEventListener("input", function () { state.zip = loc.value.trim(); scheduleRender(); });
  rad.addEventListener("input", function () { state.radius = +rad.value; radVal.textContent = rad.value; scheduleRender(); });
  search.addEventListener("input", function () { state.q = search.value; scheduleRender(); });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      state.type = chip.getAttribute("data-filter");
      render();
    });
  });
}

document.addEventListener("DOMContentLoaded", async function () {
  if (!document.getElementById("listings")) return;
  fillZipDatalist(document.getElementById("zip-list"));
  try { currentProfile = await getProfile(); } catch (e) { currentProfile = null; }
  wireControls();
  render();
  if (new URLSearchParams(location.search).get("posted")) {
    var b = document.getElementById("flash");
    if (b) b.style.display = "flex";
  }
});

// Need-It-Now — feed page: location + radius filtering, search, respond (Supabase).
import { nearbyListings, getProfile, deleteListing, listingPhotoUrl, subscribeListings, mySaves, toggleSave, savedListings } from "./api.js";
import { resolveZip } from "./config.js";
import { fillZipDatalist } from "./zips.js";
import { toast, go } from "./auth.js";
import { confirmDialog } from "./ui.js";
import { openChatForListing } from "./chat.js";
import { avatarHTML } from "./avatar.js";
import { starBadge } from "./stars.js";
import { openReport } from "./report.js";

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
    '<article class="listing" data-id="' + row.id + '">' +
      '<div class="listing__media">' +
        (row.photos && row.photos.length
          ? '<img class="listing__photo" src="' + escapeHTML(listingPhotoUrl(row.photos[0])) + '" alt="" loading="lazy" />'
          : (row.emoji || "📦")) +
        ((row.user_id && !isMine(row))
          ? '<button type="button" class="save-heart' + (savedSet[row.id] ? " is-saved" : "") +
            '" data-save="' + row.id + '" aria-pressed="' + (savedSet[row.id] ? "true" : "false") +
            '" aria-label="Save listing">' + (savedSet[row.id] ? "❤" : "♡") + "</button>"
          : "") +
      "</div>" +
      '<div class="listing__body">' +
        '<div class="listing__top">' + badge +
          '<span class="price listing__price">' + priceLabel + "</span>" +
        "</div>" +
        '<h3 class="listing__title"><a class="listing__title-link" href="listing.html?id=' +
          encodeURIComponent(row.id) + '">' + escapeHTML(row.title) + "</a></h3>" +
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
        ((row.user_id && !isMine(row))
          ? '<button class="link-report" data-report="' + row.id + '" title="Report listing">⚑</button>' : "") +
      "</div>" +
    "</article>";
}

function skeletonHTML() {
  return '<article class="listing" aria-hidden="true">' +
    '<div class="listing__media skel"></div>' +
    '<div class="listing__body">' +
      '<div class="skel" style="height:14px;width:40%"></div>' +
      '<div class="skel" style="height:22px;width:75%"></div>' +
      '<div class="skel" style="height:14px;width:90%"></div>' +
      '<div class="skel" style="height:14px;width:55%"></div>' +
    "</div>" +
    '<div class="listing__foot"><div class="skel" style="height:34px;width:100%"></div></div>' +
  "</article>";
}

var deletedIds = {}; // optimistic deletes — never repaint these from an in-flight fetch

var pendingNew = 0, lastOrigin = null; // live "Show N new" pill state
var savedSet = {}; // listing_id -> 1 for the logged-in user's saves

function milesBetween(a, b) {
  var R = 3958.8, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.asin(Math.sqrt(s));
}

/* Would this just-posted row appear under the CURRENT filters? */
function matchesFilters(row) {
  if (state.type === "saved") return false; // pill is meaningless in the Saved view
  if (currentProfile && row.user_id === currentProfile.id) return false; // own post
  if ((state.type === "sell" || state.type === "buy") && row.type !== state.type) return false;
  if (state.q) {
    var q = state.q.toLowerCase();
    if ((row.title || "").toLowerCase().indexOf(q) === -1 &&
        (row.description || "").toLowerCase().indexOf(q) === -1) return false;
  }
  // Null coords on either side count as in-radius (same as the RPC's semantics).
  if (lastOrigin && row.lat != null && row.lng != null &&
      milesBetween(lastOrigin, row) > state.radius) return false;
  return true;
}

function freshPill() {
  var pill = document.getElementById("fresh-pill");
  if (!pill) {
    var holder = document.createElement("div");
    holder.className = "fresh-pill-holder";
    holder.setAttribute("aria-live", "polite");
    holder.innerHTML = '<button id="fresh-pill" class="fresh-pill" type="button" hidden></button>';
    var controls = document.getElementById("controls");
    controls.parentNode.insertBefore(holder, controls.nextSibling);
    pill = holder.querySelector("#fresh-pill");
    pill.addEventListener("click", function () { clearPill(); render(); });
  }
  return pill;
}
function updatePill() {
  var pill = freshPill();
  pill.textContent = "Show " + pendingNew + " new listing" + (pendingNew === 1 ? "" : "s");
  pill.hidden = pendingNew === 0;
}
function clearPill() { pendingNew = 0; updatePill(); }

function paintRows(rows, emptyHTML) {
  var grid = document.getElementById("listings");
  if (!rows.length) {
    grid.innerHTML = emptyHTML ||
      '<div class="empty"><div class="em">🔍</div>' +
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
  grid.querySelectorAll("[data-report]").forEach(function (btn) {
    btn.addEventListener("click", function () { reportListing(btn.getAttribute("data-report")); });
  });
  grid.querySelectorAll("[data-save]").forEach(function (btn) {
    btn.addEventListener("click", function () { toggleHeart(btn); });
  });
}

var renderToken = 0;
async function render() {
  var grid = document.getElementById("listings");
  var count = document.getElementById("result-count");
  var token = ++renderToken;

  if (!grid.dataset.loaded) {
    var cached = readFeedCache();
    if (cached) {
      lastRows = cached.rows;
      grid.dataset.loaded = "1";
      if (count && cached.countText) count.textContent = cached.countText;
      paintRows(cached.rows); // instant paint; the fetch below reconciles
    } else {
      var sk = "";
      for (var i = 0; i < 6; i++) sk += skeletonHTML();
      grid.innerHTML = sk;
    }
  }

  if (state.type === "saved") {
    var sRows;
    try { sRows = await savedListings(); }
    catch (e) {
      if (token !== renderToken) return;
      grid.innerHTML = '<div class="empty"><div class="em">⚠️</div>' +
        "<p>Couldn't load saved listings. Check your connection and try again.</p></div>";
      if (count) count.textContent = "";
      return;
    }
    if (token !== renderToken) return;
    sRows = sRows.filter(function (r) { return !deletedIds[r.id]; });
    lastRows = sRows;
    grid.dataset.loaded = "1";
    if (count) count.textContent = sRows.length + " saved listing" + (sRows.length === 1 ? "" : "s");
    paintRows(sRows, SAVED_EMPTY);
    writeFeedCache(sRows, count ? count.textContent : "");
    return;
  }

  var origin = await resolveZip(state.zip);
  lastOrigin = origin;
  if (token !== renderToken) return; // a newer render superseded this lookup

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

  rows = rows.filter(function (r) { return !deletedIds[r.id]; }); // don't resurrect optimistic deletes
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
  paintRows(rows);
  writeFeedCache(rows, count ? count.textContent : "");
}

async function confirmDelete(id) {
  var ok = await confirmDialog({
    title: "Delete this listing?", body: "This can't be undone.",
    confirmLabel: "Delete", danger: true,
  });
  if (!ok) return;
  var prevRows = lastRows;
  deletedIds[id] = 1;
  var grid = document.getElementById("listings");
  var card = grid && grid.querySelector('.listing[data-id="' + id + '"]');
  if (card) card.remove();
  lastRows = lastRows.filter(function (r) { return r.id !== id; });
  if (grid && !grid.querySelector(".listing")) paintRows(lastRows); // empty state, no refetch
  try {
    await deleteListing(id);
    toast("Listing deleted.", { type: "success" });
    try { sessionStorage.removeItem(FEED_CACHE); } catch (e) { /* blocked */ }
  } catch (e) {
    delete deletedIds[id];
    lastRows = prevRows;
    paintRows(lastRows); // restore locally — a refetch would also fail offline
    toast((e && e.message) || "Couldn't delete — try again.", { type: "error" });
  }
}

var SAVED_EMPTY = '<div class="empty"><div class="em">🤍</div>' +
  "<p>Nothing saved yet — tap the ♡ on a listing to keep it here.</p></div>";

async function toggleHeart(btn) {
  var id = btn.getAttribute("data-save");
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  var on = !savedSet[id];
  if (on) savedSet[id] = 1; else delete savedSet[id];
  btn.classList.toggle("is-saved", on);
  btn.textContent = on ? "❤" : "♡";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (!on && state.type === "saved") {
    var card = btn.closest(".listing");
    if (card) card.remove();
    lastRows = lastRows.filter(function (r) { return r.id !== id; });
    var grid = document.getElementById("listings");
    if (grid && !grid.querySelector(".listing")) paintRows(lastRows, SAVED_EMPTY);
  }
  try { await toggleSave(id, on); }
  catch (e) {
    if (on) delete savedSet[id]; else savedSet[id] = 1;
    toast("Couldn't update saved listings.", { type: "error" });
    render(); // repaint the truth
  }
}

function reportListing(id) {
  var row = lastRows.filter(function (r) { return r.id === id; })[0];
  if (!row) return;
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  openReport({ reportedUserId: row.user_id, reportedName: row.owner_name, listingId: row.id });
}

var renderTimer;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(function () { clearPill(); writeStateToURL(); render(); }, 250);
}

/* ---- Respond modal ---- */
function openRespond(id) {
  var row = lastRows.filter(function (r) { return r.id === id; })[0];
  if (!row) return;
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  openChatForListing(row);
}

function readStateFromURL() {
  var p = new URLSearchParams(location.search);
  if (p.get("zip")) state.zip = p.get("zip");
  var r = +p.get("radius");
  if ([2, 5, 10, 25, 50].indexOf(r) !== -1) state.radius = r;
  if (["sell", "buy", "saved"].indexOf(p.get("type")) !== -1) state.type = p.get("type");
  if (p.get("q")) state.q = p.get("q");
}
function writeStateToURL() {
  // Rebuilt from scratch: any future feed query param must be added here or it
  // will drop on the first filter change.
  var p = new URLSearchParams();
  if (state.zip) p.set("zip", state.zip);
  if (state.radius !== 25) p.set("radius", String(state.radius));
  if (state.type !== "all") p.set("type", state.type);
  if (state.q) p.set("q", state.q);
  var qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}
var FEED_CACHE = "nin_feed_v1";
function stateKey() { return JSON.stringify([state.zip, state.radius, state.type, state.q]); }
function readFeedCache() {
  try {
    var c = JSON.parse(sessionStorage.getItem(FEED_CACHE) || "null");
    return (c && c.key === stateKey()) ? c : null;
  } catch (e) { return null; }
}
function writeFeedCache(rows, countText) {
  try { sessionStorage.setItem(FEED_CACHE, JSON.stringify({ key: stateKey(), rows: rows, countText: countText })); }
  catch (e) { /* full / blocked */ }
}
function wireControls() {
  var loc = document.getElementById("ctl-zip");
  var rad = document.getElementById("ctl-radius");
  var search = document.getElementById("ctl-search");

  state.zip = (currentProfile && currentProfile.zip) || "78701";
  readStateFromURL(); // shared/refreshed URLs win over the profile default
  search.value = state.q;
  document.querySelectorAll(".chip").forEach(function (c) {
    c.classList.toggle("active", c.getAttribute("data-filter") === state.type);
  });
  loc.value = state.zip;
  rad.value = String(state.radius);

  loc.addEventListener("input", function () { state.zip = loc.value.trim(); scheduleRender(); });
  rad.addEventListener("change", function () { state.radius = +rad.value; scheduleRender(); });
  search.addEventListener("input", function () { state.q = search.value; scheduleRender(); });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      if (chip.getAttribute("data-filter") === "saved" && !currentProfile) {
        go("pages/login.html?next=" + encodeURIComponent("/pages/feed.html?type=saved"));
        return;
      }
      document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      state.type = chip.getAttribute("data-filter");
      clearPill();
      writeStateToURL();
      render();
    });
  });

  // Tuck the filter bar out of the way while scrolling down; bring it back on the
  // way up (or near the top). Keeps it handy without hogging the screen.
  var controls = document.getElementById("controls");
  var lastY = window.scrollY || 0, ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      if (y > 200 && y > lastY + 4) controls.classList.add("controls--tuck");
      else if (y < lastY - 4 || y < 200) controls.classList.remove("controls--tuck");
      lastY = y; ticking = false;
    });
  }, { passive: true });
}

document.addEventListener("DOMContentLoaded", async function () {
  if (!document.getElementById("listings")) return;
  fillZipDatalist(document.getElementById("zip-list"));
  try { currentProfile = await getProfile(); } catch (e) { currentProfile = null; }
  if (currentProfile) {
    try { (await mySaves()).forEach(function (id) { savedSet[id] = 1; }); } catch (e) { /* hearts optional */ }
  }
  wireControls();
  render();
  subscribeListings(function (row) {
    if (!row || deletedIds[row.id]) return;
    if (!matchesFilters(row)) return;
    pendingNew++;
    updatePill();
  });
  if (new URLSearchParams(location.search).get("posted")) {
    var b = document.getElementById("flash");
    if (b) b.style.display = "flex";
  }
});

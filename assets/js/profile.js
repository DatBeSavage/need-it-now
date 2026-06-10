// Need-It-Now — profile page (own = editable/settings; other = read-only).
import { getProfile, getProfileById, updateProfile, uploadAvatar, listingsByUser, ratingsForUser, listingPhotoUrl } from "./api.js";
import { starsHTML } from "./stars.js";
import { resolveZip } from "./config.js";
import { wireZipInput } from "./zips.js";
import { avatarHTML } from "./avatar.js";
import { toast, go, base } from "./auth.js";
import { openReport } from "./report.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function monthYear(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function miniCard(l, editable) {
  var media = (l.photos && l.photos.length)
    ? '<img class="mini__photo" src="' + esc(listingPhotoUrl(l.photos[0])) + '" alt="" loading="lazy" />'
    : '<span class="mini__emoji">' + (l.emoji || "📦") + "</span>";
  return '<article class="mini">' + media +
    '<span class="mini__body"><strong>' + esc(l.title) + "</strong>" +
    '<span class="muted">' + (l.type === "sell" ? money(l.price) : "Budget " + money(l.price)) + "</span></span>" +
    (editable ? '<a class="btn btn--ghost btn--sm" href="post.html?id=' + l.id + '">Edit</a>' : "") +
    "</article>";
}

async function renderListings(box, userId, editable) {
  var rows = [];
  try { rows = await listingsByUser(userId); } catch (e) { /* leave empty */ }
  box.innerHTML = rows.length
    ? rows.map(function (l) { return miniCard(l, editable); }).join("")
    : '<p class="muted">No active listings.</p>';
}

async function renderPublic(root, p) {
  var coord = await resolveZip(p.zip);
  var loc = coord ? coord.city : (p.zip || "");
  root.innerHTML =
    '<div class="profile-head card">' +
      avatarHTML(p, "lg") +
      '<div><h1 class="profile-name">' + esc(p.name) + "</h1>" +
        '<p class="muted">' + esc(loc) + (loc ? " · " : "") + "Member since " + monthYear(p.created_at) + "</p>" +
        (p.bio ? '<p class="profile-bio">' + esc(p.bio) + "</p>" : "") +
        '<div class="profile-rating">' + starsHTML(p.rating_avg, p.rating_count, "md") + "</div>" +
        '<button class="btn btn--ghost btn--sm" data-report-user style="margin-top:var(--sp-3)">⚑ Report</button>' +
      "</div>" +
    "</div>" +
    '<h2 class="profile-sub">Listings</h2><div class="minis" data-listings></div>' +
    '<h2 class="profile-sub">Reviews</h2><div class="reviews" data-reviews></div>';
  renderListings(root.querySelector("[data-listings]"), p.id, false);
  renderReviews(root.querySelector("[data-reviews]"), p.id);
  var rb = root.querySelector("[data-report-user]");
  if (rb) rb.addEventListener("click", function () {
    openReport({ reportedUserId: p.id, reportedName: p.name });
  });
}

async function renderReviews(box, userId) {
  var rows = [];
  try { rows = await ratingsForUser(userId); } catch (e) { /* leave empty */ }
  if (!rows.length) { box.innerHTML = '<p class="muted">No reviews yet.</p>'; return; }
  box.innerHTML = rows.map(function (r) {
    var who = (r.rater && r.rater.name) || "Neighbor";
    return '<div class="review">' +
      avatarHTML({ name: who, avatar_path: r.rater && r.rater.avatar_path }, "sm") +
      '<div class="review__body"><div class="review__top"><strong>' + esc(who) + "</strong>" +
        '<span class="review__stars">' + "★".repeat(r.stars) + "</span></div>" +
        (r.comment ? '<p class="review__text">' + esc(r.comment) + "</p>" : "") +
      "</div></div>";
  }).join("");
}

function renderOwn(root, me) {
  root.innerHTML =
    '<h1 class="profile-name" style="margin-bottom:var(--sp-2)">Your profile</h1>' +
    '<div class="profile-rating" style="margin-bottom:var(--sp-4)">' + starsHTML(me.rating_avg, me.rating_count, "md") + "</div>" +
    '<form class="card" data-form style="padding:var(--sp-6)">' +
      '<div class="profile-edit-head">' +
        '<span data-av>' + avatarHTML(me, "lg") + "</span>" +
        '<label class="btn btn--ghost btn--sm">Change photo' +
          '<input type="file" accept="image/*" data-file hidden /></label>' +
      "</div>" +
      '<div class="field"><label for="pf-name">Display name</label>' +
        '<input class="input" id="pf-name" value="' + esc(me.name) + '" /></div>' +
      '<div class="field"><label for="pf-zip">ZIP (your area)</label>' +
        '<input class="input" id="pf-zip" list="zip-list" value="' + esc(me.zip) + '" />' +
        '<datalist id="zip-list"></datalist></div>' +
      '<div class="field"><label for="pf-bio">Bio</label>' +
        '<textarea class="textarea" id="pf-bio" maxlength="280" placeholder="A line or two about you…">' + esc(me.bio) + "</textarea></div>" +
      '<p class="form-error" role="alert"></p>' +
      '<button class="btn btn--primary btn--lg" type="submit">Save profile</button>' +
    "</form>" +
    '<h2 class="profile-sub">Your listings</h2><div class="minis" data-listings></div>';

  var form = root.querySelector("[data-form]");
  var fileInput = root.querySelector("[data-file]");
  var avBox = root.querySelector("[data-av]");
  var err = form.querySelector(".form-error");
  var pendingFile = null;

  var checkZip = wireZipInput(document.getElementById("pf-zip"));
  checkZip();

  fileInput.addEventListener("change", function () {
    pendingFile = fileInput.files[0] || null;
    if (pendingFile) avBox.innerHTML = '<img class="avatar avatar--lg" src="' + URL.createObjectURL(pendingFile) + '" alt="" />';
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    var name = document.getElementById("pf-name").value.trim();
    var zip = document.getElementById("pf-zip").value.trim();
    var bio = document.getElementById("pf-bio").value.trim();
    if (!name) { err.textContent = "Add a display name."; return; }
    if (!(await resolveZip(zip))) { err.textContent = "Enter a valid US ZIP."; return; }
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (pendingFile) { await uploadAvatar(pendingFile); pendingFile = null; }
      await updateProfile({ name: name, zip: zip, bio: bio });
      toast("Profile saved.");
      go("pages/profile.html"); // reload fresh (also refreshes nav avatar)
    } catch (e2) {
      err.textContent = (e2 && e2.message) || "Couldn't save — try again.";
      btn.disabled = false; btn.textContent = "Save profile";
    }
  });

  renderListings(root.querySelector("[data-listings]"), me.id, true);
}

document.addEventListener("DOMContentLoaded", async function () {
  var root = document.getElementById("profile-root");
  if (!root) return;
  var me = null;
  try { me = await getProfile(); } catch (e) { me = null; }
  var u = new URLSearchParams(location.search).get("u");
  var viewingId = u || (me && me.id);
  if (!viewingId) { go("pages/login.html?next=/pages/profile.html"); return; }

  if (me && viewingId === me.id) { renderOwn(root, me); return; }
  var p = null;
  try { p = await getProfileById(viewingId); } catch (e) { /* */ }
  if (!p) { root.innerHTML = '<div class="empty"><div class="em">🤷</div><p>That profile doesn\'t exist.</p></div>'; return; }
  renderPublic(root, p);
});

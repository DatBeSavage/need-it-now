// Need-It-Now — admin dashboard (gated; read-only monitoring).
import { amIAdmin, adminListReports, adminListUsers, adminListListings, adminGetConversation,
         setReportStatus, setListingHidden, adminDeleteListing,
         banUser, unbanUser, adminListBanned, getProfile,
         getSettings, adminSetSetting,
         getCategories, adminSaveCategory, adminDeleteCategory } from "./api.js";
import { go, toast } from "./auth.js";
import { confirmDialog } from "./ui.js";
import { avatarHTML } from "./avatar.js";
import { resolveZip } from "./config.js";
import { starBadge } from "./stars.js";

var meId = null;

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function money(n) { return "$" + Number(n).toLocaleString("en-US"); }
function dateShort(iso) { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function monthYear(iso) { return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }

async function renderReports(panel) {
  panel.innerHTML = '<p class="muted">Loading reports…</p>';
  var rows = await adminListReports();
  if (!rows.length) { panel.innerHTML = '<p class="muted">No reports yet.</p>'; return; }
  panel.innerHTML = rows.map(function (r) {
    var reporter = (r.reporter && r.reporter.name) || "Someone";
    var reported = (r.reported && r.reported.name) || "user";
    var status = r.status || "open";
    var ctx = "";
    if (r.listing) ctx += '<span class="muted">Listing: ' + esc(r.listing.title) + "</span>";
    if (r.conversation_id) ctx += '<button class="btn btn--ghost btn--sm" data-chat="' + r.conversation_id + '">View chat</button>';
    var actions = status === "open"
      ? '<button class="btn btn--ghost btn--sm" data-resolve="' + r.id + '">Resolve</button>' +
        '<button class="btn btn--ghost btn--sm" data-dismiss="' + r.id + '">Dismiss</button>'
      : "";
    return '<div class="admin-row' + (status !== "open" ? " admin-row--done" : "") + '"><div class="admin-row__main">' +
      "<div><strong>" + esc(reporter) + "</strong> reported " +
        '<a href="profile.html?u=' + r.reported_user_id + '"><strong>' + esc(reported) + "</strong></a> " +
        '<span class="badge badge--buy">' + esc(r.reason) + "</span> " +
        '<span class="status status--' + status + '">' + status + "</span></div>" +
      (r.details ? '<p class="muted">' + esc(r.details) + "</p>" : "") +
      '<div class="admin-meta">' + ctx + actions + '<span class="muted">' + dateShort(r.created_at) + "</span></div>" +
      '<div class="admin-chat" data-chatbox="' + (r.conversation_id || "") + '" hidden></div>' +
      "</div></div>";
  }).join("");

  panel.querySelectorAll("[data-chat]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var id = btn.getAttribute("data-chat");
      var box = panel.querySelector('[data-chatbox="' + id + '"]');
      if (!box) return;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = '<p class="muted">Loading…</p>';
      try {
        var msgs = await adminGetConversation(id);
        box.innerHTML = msgs.length
          ? msgs.map(function (m) { return '<div class="admin-msg"><strong>' + esc(m.sender_name) + ":</strong> " + esc(m.body) + "</div>"; }).join("")
          : '<p class="muted">No messages.</p>';
      } catch (e) { box.innerHTML = '<p class="muted">Couldn\'t load chat.</p>'; }
    });
  });
  panel.querySelectorAll("[data-resolve]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try { await setReportStatus(btn.getAttribute("data-resolve"), "resolved"); renderReports(panel); }
      catch (e) { toast("Couldn't update report."); }
    });
  });
  panel.querySelectorAll("[data-dismiss]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try { await setReportStatus(btn.getAttribute("data-dismiss"), "dismissed"); renderReports(panel); }
      catch (e) { toast("Couldn't update report."); }
    });
  });
}

async function renderUsers(panel) {
  panel.innerHTML = '<p class="muted">Loading users…</p>';
  var users = await adminListUsers();
  var listings = [];
  try { listings = await adminListListings(); } catch (e) { /* */ }
  var banned = [];
  try { banned = await adminListBanned(); } catch (e) { /* */ }
  var bannedSet = {};
  banned.forEach(function (b) { bannedSet[b.user_id] = true; });
  var counts = {};
  listings.forEach(function (l) { if (l.user_id) counts[l.user_id] = (counts[l.user_id] || 0) + 1; });
  if (!users.length) { panel.innerHTML = '<p class="muted">No users.</p>'; return; }
  var parts = await Promise.all(users.map(async function (u) {
    var coord = await resolveZip(u.zip);
    var loc = coord ? coord.city : (u.zip || "");
    var n = counts[u.id] || 0;
    var isBanned = !!bannedSet[u.id];
    var btn = (u.id === meId) ? '<span class="muted">you</span>'
      : (isBanned
          ? '<button class="btn btn--ghost btn--sm" data-unban="' + u.id + '">Unban</button>'
          : '<button class="btn btn--ghost btn--sm" data-ban="' + u.id + '">Ban</button>');
    return '<div class="admin-row' + (isBanned ? " admin-row--done" : "") + '">' + avatarHTML(u, "md") +
      '<div class="admin-row__main">' +
        '<div><a href="profile.html?u=' + u.id + '"><strong>' + esc(u.name) + "</strong></a> " +
          starBadge(u.rating_avg, u.rating_count) +
          (isBanned ? ' <span class="status status--banned">banned</span>' : "") + "</div>" +
        '<div class="admin-meta muted">' + esc(loc) + " · joined " + monthYear(u.created_at) +
          " · " + n + " listing" + (n === 1 ? "" : "s") + "</div>" +
        '<div class="admin-meta">' + btn + "</div>" +
      "</div></div>";
  }));
  panel.innerHTML = parts.join("");
  panel.querySelectorAll("[data-ban]").forEach(function (b) {
    b.addEventListener("click", async function () {
      var reason = window.prompt("Reason for banning (optional):", "");
      if (reason === null) return;
      try { await banUser(b.getAttribute("data-ban"), reason); renderUsers(panel); }
      catch (e) { toast("Couldn't ban user."); }
    });
  });
  panel.querySelectorAll("[data-unban]").forEach(function (b) {
    b.addEventListener("click", async function () {
      try { await unbanUser(b.getAttribute("data-unban")); renderUsers(panel); }
      catch (e) { toast("Couldn't unban user."); }
    });
  });
}

async function renderListings(panel) {
  panel.innerHTML = '<p class="muted">Loading listings…</p>';
  var rows = await adminListListings();
  if (!rows.length) { panel.innerHTML = '<p class="muted">No listings.</p>'; return; }
  panel.innerHTML = rows.map(function (l) {
    var owner = l.user_id
      ? '<a href="profile.html?u=' + l.user_id + '">' + esc(l.owner_name) + "</a>"
      : esc(l.owner_name) + " (demo)";
    return '<div class="admin-row' + (l.hidden ? " admin-row--done" : "") + '">' +
      '<span class="admin-emoji">' + (l.emoji || "📦") + "</span>" +
      '<div class="admin-row__main">' +
        "<div><strong>" + esc(l.title) + "</strong> · " +
          (l.type === "sell" ? money(l.price) : "Budget " + money(l.price)) +
          (l.hidden ? ' <span class="status status--dismissed">hidden</span>' : "") + "</div>" +
        '<div class="admin-meta muted">' + owner + " · " + esc(l.zip || "") + " · " + dateShort(l.created_at) + "</div>" +
        '<div class="admin-meta">' +
          '<button class="btn btn--ghost btn--sm" data-hide="' + l.id + '" data-h="' + (l.hidden ? "1" : "0") + '">' +
            (l.hidden ? "Unhide" : "Hide") + "</button>" +
          '<button class="btn btn--ghost btn--sm" data-del="' + l.id + '">Delete</button>' +
        "</div>" +
      "</div></div>";
  }).join("");
  panel.querySelectorAll("[data-hide]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try { await setListingHidden(btn.getAttribute("data-hide"), btn.getAttribute("data-h") !== "1"); renderListings(panel); }
      catch (e) { toast("Couldn't update listing."); }
    });
  });
  panel.querySelectorAll("[data-del]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var ok = await confirmDialog({
        title: "Delete this listing permanently?", body: "This removes the listing for everyone.",
        confirmLabel: "Delete", danger: true,
      });
      if (!ok) return;
      try { await adminDeleteListing(btn.getAttribute("data-del")); renderListings(panel); }
      catch (e) { toast("Couldn't delete listing.", { type: "error" }); }
    });
  });
}

async function renderSettings(panel) {
  panel.innerHTML = '<p class="muted">Loading settings…</p>';
  var s = {};
  try { s = await getSettings(); } catch (e) { /* */ }
  panel.innerHTML =
    '<form class="card" data-settings style="padding:var(--sp-5);max-width:560px">' +
      '<div class="field"><label for="set-max">Max listings per user per day (0 = unlimited)</label>' +
        '<input class="input" id="set-max" type="number" min="0" value="' + esc(s.max_listings_per_day || "0") + '" /></div>' +
      '<div class="field"><label for="set-words">Banned words (comma-separated)</label>' +
        '<input class="input" id="set-words" value="' + esc(s.banned_words || "") + '" /></div>' +
      '<div class="field"><label for="set-guide">Community guidelines</label>' +
        '<textarea class="textarea" id="set-guide" style="min-height:160px">' + esc(s.guidelines || "") + "</textarea></div>" +
      '<button class="btn btn--primary" type="submit">Save settings</button>' +
    "</form>";
  panel.querySelector("[data-settings]").addEventListener("submit", async function (e) {
    e.preventDefault();
    var btn = panel.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await adminSetSetting("max_listings_per_day", String(parseInt(panel.querySelector("#set-max").value, 10) || 0));
      await adminSetSetting("banned_words", panel.querySelector("#set-words").value);
      await adminSetSetting("guidelines", panel.querySelector("#set-guide").value);
      toast("Settings saved.");
    } catch (e2) { toast((e2 && e2.message) || "Couldn't save settings."); }
    finally { btn.disabled = false; btn.textContent = "Save settings"; }
  });
}

async function renderCategories(panel) {
  panel.innerHTML = '<p class="muted">Loading categories…</p>';
  var cats = [];
  try { cats = await getCategories(); } catch (e) { /* */ }
  var sortByValue = {};
  cats.forEach(function (c) { sortByValue[c.value] = c.sort; });
  var rows = cats.map(function (c) {
    return '<div class="admin-row"><span class="admin-emoji">' + esc(c.emoji) + "</span>" +
      '<div class="admin-row__main"><div class="admin-meta">' +
        '<input class="input" data-cat-emoji="' + esc(c.value) + '" value="' + esc(c.emoji) + '" style="width:70px" />' +
        '<input class="input" data-cat-label="' + esc(c.value) + '" value="' + esc(c.label) + '" />' +
        '<span class="muted">' + esc(c.value) + "</span>" +
        '<button class="btn btn--ghost btn--sm" data-cat-save="' + esc(c.value) + '">Save</button>' +
        '<button class="btn btn--ghost btn--sm" data-cat-del="' + esc(c.value) + '">Delete</button>' +
      "</div></div></div>";
  }).join("");
  var addRow = '<div class="admin-row"><span class="admin-emoji">➕</span>' +
    '<div class="admin-row__main"><div class="admin-meta">' +
      '<input class="input" id="newcat-emoji" placeholder="📦" style="width:70px" />' +
      '<input class="input" id="newcat-label" placeholder="Label" />' +
      '<input class="input" id="newcat-value" placeholder="slug" style="width:120px" />' +
      '<button class="btn btn--primary btn--sm" id="newcat-add">Add</button>' +
    "</div></div></div>";
  panel.innerHTML = rows + addRow;

  panel.querySelectorAll("[data-cat-save]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var v = btn.getAttribute("data-cat-save");
      var label = panel.querySelector('[data-cat-label="' + v + '"]').value.trim();
      var emoji = panel.querySelector('[data-cat-emoji="' + v + '"]').value.trim() || "📦";
      if (!label) { toast("Label required."); return; }
      try { await adminSaveCategory({ value: v, label: label, emoji: emoji, sort: sortByValue[v] || 0 }); toast("Saved."); }
      catch (e) { toast("Couldn't save category."); }
    });
  });
  panel.querySelectorAll("[data-cat-del]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var ok = await confirmDialog({
        title: "Delete this category?", body: "Existing listings keep their value; the option disappears from the post form.",
        confirmLabel: "Delete", danger: true,
      });
      if (!ok) return;
      try { await adminDeleteCategory(btn.getAttribute("data-cat-del")); renderCategories(panel); }
      catch (e) { toast("Couldn't delete category.", { type: "error" }); }
    });
  });
  var add = panel.querySelector("#newcat-add");
  if (add) add.addEventListener("click", async function () {
    var v = panel.querySelector("#newcat-value").value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    var label = panel.querySelector("#newcat-label").value.trim();
    var emoji = panel.querySelector("#newcat-emoji").value.trim() || "📦";
    if (!v || !label) { toast("Slug and label are required."); return; }
    try { await adminSaveCategory({ value: v, label: label, emoji: emoji, sort: 99 }); renderCategories(panel); }
    catch (e) { toast("Couldn't add category."); }
  });
}

var RENDER = { reports: renderReports, users: renderUsers, listings: renderListings, settings: renderSettings, categories: renderCategories };

function showTab(name) {
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.toggle("active", t.getAttribute("data-tab") === name);
  });
  RENDER[name](document.getElementById("admin-panel"));
}

document.addEventListener("DOMContentLoaded", async function () {
  var panel = document.getElementById("admin-panel");
  if (!panel) return;
  if (!(await amIAdmin())) { go("pages/feed.html"); return; }
  try { var me = await getProfile(); meId = me && me.id; } catch (e) { /* */ }
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); });
  });
  showTab("reports");
});

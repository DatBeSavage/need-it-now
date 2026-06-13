// Need-It-Now — Messages inbox.
import { myConversations, deleteConversation } from "./api.js";
import { requireAuth, toast } from "./auth.js";
import { confirmDialog } from "./ui.js";
import { openChatForConversation } from "./chat.js";
import { avatarHTML } from "./avatar.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function timeAgo(iso) {
  var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  var h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

var EMPTY_HTML = '<div class="empty"><div class="em">💬</div>' +
  '<p>No conversations yet. Find something on the <a href="feed.html" style="color:var(--blue-600);font-weight:700">feed</a> and say hello.</p></div>';

function rowHTML(c) {
  var other = c.iAmOwner ? c.buyer : c.owner;
  var who = (other && other.name) || (c.iAmOwner ? "Buyer" : "Seller");
  var listing = c.listing || {};
  var title = listing.title || "Listing";
  var emoji = listing.emoji || "📦";
  var snippet = c.last_body || "No messages yet";
  var myRead = c.iAmOwner ? c.owner_read_at : c.buyer_read_at;
  var isUnread = !!c.last_body && new Date(c.last_message_at) > new Date(myRead || 0);
  return '<div class="thread-row' + (isUnread ? " is-unread" : "") + '" data-id="' + c.id + '">' +
    '<button class="thread' + (isUnread ? " thread--unread" : "") + '" data-open>' +
      avatarHTML({ name: who, avatar_path: other && other.avatar_path }, "md") +
      '<span class="thread__body">' +
        '<span class="thread__top"><strong>' + esc(who) + "</strong>" +
        (isUnread ? '<span class="thread__dot" aria-hidden="true"></span>' : "") +
        '<span class="muted thread__time">' + timeAgo(c.last_message_at) + "</span></span>" +
        '<span class="thread__listing muted">Re: ' + esc(emoji) + " " + esc(title) + "</span>" +
        '<span class="thread__snippet">' + esc(snippet) + "</span>" +
      "</span>" +
    "</button>" +
    '<button class="thread-menu" data-menu aria-label="Conversation options" aria-haspopup="true">⋮</button>' +
    '<div class="thread-pop" data-pop hidden>' +
      '<button class="thread-pop__item" data-del>Delete conversation</button></div>' +
  "</div>";
}

document.addEventListener("DOMContentLoaded", async function () {
  var box = document.getElementById("threads");
  if (!box) return;
  var profile = await requireAuth();
  if (!profile) return;
  box.innerHTML = '<div class="empty"><div class="em">⏳</div><p>Loading…</p></div>';
  var convs = [];
  try { convs = await myConversations(); }
  catch (e) { box.innerHTML = '<div class="empty"><div class="em">⚠️</div><p>Couldn\'t load messages.</p></div>'; return; }

  var withMsgs = convs.filter(function (c) { return c.last_body; });
  if (!withMsgs.length) { box.innerHTML = EMPTY_HTML; return; }
  box.innerHTML = withMsgs.map(rowHTML).join("");
  var byId = {}; convs.forEach(function (c) { byId[c.id] = c; });
  var remaining = withMsgs.length;

  function closeAllPops() { box.querySelectorAll("[data-pop]").forEach(function (p) { p.hidden = true; }); }
  document.addEventListener("click", closeAllPops);

  box.querySelectorAll(".thread-row").forEach(function (row) {
    var id = row.getAttribute("data-id");
    row.querySelector("[data-open]").addEventListener("click", function () {
      row.querySelector(".thread").classList.remove("thread--unread");
      var dot = row.querySelector(".thread__dot"); if (dot) dot.remove();
      openChatForConversation(byId[id]);
    });
    row.querySelector("[data-menu]").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = row.querySelector("[data-pop]");
      var wasHidden = pop.hidden;
      closeAllPops();
      pop.hidden = !wasHidden;
    });
    row.querySelector("[data-del]").addEventListener("click", async function (e) {
      e.stopPropagation();
      closeAllPops();
      var ok = await confirmDialog({
        title: "Delete this conversation?",
        body: "It'll come back if they message you again.",
        confirmLabel: "Delete", danger: true,
      });
      if (!ok) return;
      row.style.display = "none";
      try {
        await deleteConversation(id);
        remaining--;
        if (remaining <= 0) box.innerHTML = EMPTY_HTML;
      } catch (err) {
        row.style.display = "";
        toast((err && err.message) || "Couldn't delete — try again.", { type: "error" });
      }
    });
  });
});

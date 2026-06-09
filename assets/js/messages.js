// Need-It-Now — Messages inbox.
import { myConversations } from "./api.js";
import { requireAuth } from "./auth.js";
import { openChatForConversation } from "./chat.js";

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

function rowHTML(c) {
  var who = c.iAmOwner ? (c.buyer && c.buyer.name) || "Buyer"
                       : (c.owner && c.owner.name) || "Seller";
  var title = c.listing ? c.listing.title : "Listing";
  var snippet = c.last_body || "No messages yet";
  return '<button class="thread" data-id="' + c.id + '">' +
    '<span class="thread__emoji">' + ((c.listing && c.listing.emoji) || "📦") + "</span>" +
    '<span class="thread__body">' +
      '<span class="thread__top"><strong>' + esc(who) + "</strong>" +
      '<span class="muted thread__time">' + timeAgo(c.last_message_at) + "</span></span>" +
      '<span class="thread__listing muted">' + esc(title) + "</span>" +
      '<span class="thread__snippet">' + esc(snippet) + "</span>" +
    "</span></button>";
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
  if (!withMsgs.length) {
    box.innerHTML = '<div class="empty"><div class="em">💬</div>' +
      '<p>No conversations yet. Find something on the <a href="feed.html" style="color:var(--blue-600);font-weight:700">feed</a> and say hello.</p></div>';
    return;
  }
  box.innerHTML = withMsgs.map(rowHTML).join("");
  var byId = {}; convs.forEach(function (c) { byId[c.id] = c; });
  box.querySelectorAll(".thread").forEach(function (btn) {
    btn.addEventListener("click", function () { openChatForConversation(byId[btn.getAttribute("data-id")]); });
  });
});

// Need-It-Now — Messages inbox.
import { myConversations } from "./api.js";
import { requireAuth } from "./auth.js";
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

function rowHTML(c) {
  var other = c.iAmOwner ? c.buyer : c.owner;
  var who = (other && other.name) || (c.iAmOwner ? "Buyer" : "Seller");
  var title = c.listing ? c.listing.title : "Listing";
  var snippet = c.last_body || "No messages yet";
  var myRead = c.iAmOwner ? c.owner_read_at : c.buyer_read_at;
  var isUnread = !!c.last_body && new Date(c.last_message_at) > new Date(myRead || 0);
  return '<button class="thread' + (isUnread ? " thread--unread" : "") + '" data-id="' + c.id + '">' +
    avatarHTML({ name: who, avatar_path: other && other.avatar_path }, "md") +
    '<span class="thread__body">' +
      '<span class="thread__top"><strong>' + esc(who) + "</strong>" +
      (isUnread ? '<span class="thread__dot" aria-hidden="true"></span>' : "") +
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
    btn.addEventListener("click", function () {
      btn.classList.remove("thread--unread");
      var dot = btn.querySelector(".thread__dot");
      if (dot) dot.remove();
      openChatForConversation(byId[btn.getAttribute("data-id")]);
    });
  });
});

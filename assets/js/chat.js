// Need-It-Now — reusable real-time chat panel.
import { getOrCreateConversation, getMessages, sendMessage, subscribeMessages, getProfile } from "./api.js";
import { toast, base } from "./auth.js";

var meId = null, unsub = null, seen = {};

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function timeShort(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function modal() {
  var m = document.getElementById("chat-modal");
  if (m) return m;
  m = document.createElement("div");
  m.id = "chat-modal"; m.className = "modal-back";
  m.innerHTML =
    '<div class="chat card" role="dialog" aria-modal="true">' +
      '<header class="chat__head"><div>' +
        '<strong class="chat__who" data-who></strong>' +
        '<span class="chat__sub muted" data-sub></span></div>' +
        '<button class="chat__close" data-close aria-label="Close">✕</button></header>' +
      '<div class="chat__log" data-log></div>' +
      '<form class="chat__form" data-form>' +
        '<input class="chat__input" data-input autocomplete="off" placeholder="Write a message…" maxlength="2000" />' +
        '<button class="btn btn--primary" type="submit">Send</button></form>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener("click", function (e) { if (e.target === m) close(); });
  m.querySelector("[data-close]").addEventListener("click", close);
  return m;
}

function bubble(msg) {
  var mine = msg.sender_id === meId;
  return '<div class="bub ' + (mine ? "bub--me" : "bub--them") + '">' +
    (mine ? "" : '<span class="bub__who">' + esc(msg.sender_name) + "</span>") +
    '<span class="bub__body">' + esc(msg.body) + "</span>" +
    '<span class="bub__time">' + timeShort(msg.created_at) + "</span></div>";
}
function append(log, msg) {
  if (seen[msg.id]) return;
  seen[msg.id] = 1;
  var empty = log.querySelector(".chat__empty"); if (empty) empty.remove();
  log.insertAdjacentHTML("beforeend", bubble(msg));
  log.scrollTop = log.scrollHeight;
}
function close() {
  var m = document.getElementById("chat-modal");
  if (m) m.classList.remove("open");
  if (unsub) { unsub(); unsub = null; }
  seen = {};
}

function listen(log, convId) {
  if (unsub) unsub();
  unsub = subscribeMessages(convId, function (msg) { append(log, msg); });
}

// opts: { conv } for an existing thread, or { listing } for a lazy new thread.
async function openPanel(opts, who, sub) {
  var profile = await getProfile();
  if (!profile) { location.href = base() + "pages/login.html"; return; }
  meId = profile.id; seen = {};
  var conv = opts.conv || null;
  var m = modal(), log = m.querySelector("[data-log]"), input = m.querySelector("[data-input]");
  m.querySelector("[data-who]").textContent = who;
  m.querySelector("[data-sub]").textContent = sub;
  log.innerHTML = '<div class="chat__empty">Say hello 👋</div>';
  m.classList.add("open");

  m.querySelector("[data-form]").onsubmit = async function (e) {
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = "";
    try {
      if (!conv) { conv = await getOrCreateConversation(opts.listing); listen(log, conv.id); }
      await sendMessage(conv.id, text);
    } catch (err) { toast((err && err.message) || "Couldn't send."); input.value = text; }
  };

  if (conv) {
    try {
      var msgs = await getMessages(conv.id);
      if (msgs.length) { log.innerHTML = ""; msgs.forEach(function (x) { append(log, x); }); }
    } catch (err) { log.innerHTML = '<div class="chat__empty">Couldn\'t load messages.</div>'; }
    listen(log, conv.id);
  }
  input.focus();
}

export async function openChatForListing(listing) {
  var who = listing.owner_name || "Seller";
  var sub = (listing.type === "sell" ? "Re: " : "You have: ") + listing.title;
  try { await openPanel({ listing: listing }, who, sub); }
  catch (err) { toast((err && err.message) || "Couldn't open chat."); }
}

export function openChatForConversation(conv) {
  var who = conv.iAmOwner ? ((conv.buyer && conv.buyer.name) || "Buyer")
                          : ((conv.owner && conv.owner.name) || "Seller");
  openPanel({ conv: conv }, who, "Re: " + (conv.listing ? conv.listing.title : "Listing"));
}

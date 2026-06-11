// Need-It-Now — reusable real-time chat panel.
import { getOrCreateConversation, findConversation, getMessages, sendMessage, subscribeMessages, getProfile,
         markDealt, getMyRating, createRating } from "./api.js";
import { toast, base } from "./auth.js";
import { escToClose } from "./ui.js";
import { noteConversationOpened, noteConversationClosed } from "./notify.js";
import { avatarHTML } from "./avatar.js";
import { openReport } from "./report.js";

var meId = null, unsub = null, seen = {}, lastOpener = null;

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
      '<header class="chat__head"><span class="chat__av" data-av></span><div>' +
        '<strong class="chat__who" data-who></strong>' +
        '<span class="chat__sub muted" data-sub></span></div>' +
        '<button class="chat__report" data-report-user title="Report user">⚑</button>' +
        '<button class="chat__close" data-close aria-label="Close">✕</button></header>' +
      '<div class="chat__log" data-log></div>' +
      '<div class="deal" data-deal></div>' +
      '<form class="chat__form" data-form>' +
        '<input class="chat__input" data-input autocomplete="off" placeholder="Write a message…" maxlength="2000" />' +
        '<button class="btn btn--primary" type="submit">Send</button></form>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener("click", function (e) { if (e.target === m) close(); });
  m.querySelector("[data-close]").addEventListener("click", close);
  escToClose(m, close);
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
  noteConversationClosed();
  if (lastOpener && lastOpener.focus) { lastOpener.focus(); lastOpener = null; }
}

function listen(log, convId) {
  if (unsub) unsub();
  unsub = subscribeMessages(convId, function (msg) { append(log, msg); });
}

async function renderDeal(m, conv) {
  var bar = m.querySelector("[data-deal]");
  if (!conv || !conv.id) { bar.innerHTML = ""; return; }
  var iAmBuyer = conv.buyer_id === meId;
  var otherId = iAmBuyer ? conv.owner_id : conv.buyer_id;
  var myDone = iAmBuyer ? conv.dealt_buyer_at : conv.dealt_owner_at;
  if (!conv.dealt_at) {
    if (myDone) {
      bar.innerHTML = '<span class="muted">✓ You confirmed the deal — waiting for the other person.</span>';
      return;
    }
    bar.innerHTML = '<span class="muted">Made a deal?</span>' +
      '<button class="btn btn--ghost btn--sm" data-mark>Mark as dealt</button>';
    bar.querySelector("[data-mark]").onclick = async function () {
      try {
        var d = await markDealt(conv.id);
        conv.dealt_at = d.dealt_at;
        conv.dealt_buyer_at = d.dealt_buyer_at;
        conv.dealt_owner_at = d.dealt_owner_at;
        renderDeal(m, conv);
      } catch (e) { toast((e && e.message) || "Couldn't mark as dealt."); }
    };
    return;
  }
  var mine = await getMyRating(conv.id);
  if (mine) {
    bar.innerHTML = '<span class="muted">You rated</span><span class="deal__rated">' +
      "★".repeat(mine.stars) + "</span>";
    return;
  }
  bar.innerHTML = '<span class="muted">Deal done —</span>' +
    '<button class="btn btn--ghost btn--sm" data-rate>Leave a rating</button>';
  bar.querySelector("[data-rate]").onclick = function () { showRateForm(m, conv, otherId); };
}

function showRateForm(m, conv, otherId) {
  var bar = m.querySelector("[data-deal]");
  var picked = 0;
  bar.innerHTML = '<div class="rate">' +
    '<div class="rate__stars" data-stars>' +
      [1, 2, 3, 4, 5].map(function (i) {
        return '<button type="button" class="star" data-v="' + i + '">★</button>';
      }).join("") + "</div>" +
    '<input class="input rate__msg" data-msg placeholder="Add a comment (optional)" maxlength="200" />' +
    '<button class="btn btn--primary btn--sm" data-submit>Submit</button></div>';
  var starsEl = bar.querySelector("[data-stars]");
  starsEl.querySelectorAll(".star").forEach(function (b) {
    b.onclick = function () {
      picked = +b.getAttribute("data-v");
      starsEl.querySelectorAll(".star").forEach(function (x) {
        x.classList.toggle("star--on", +x.getAttribute("data-v") <= picked);
      });
    };
  });
  bar.querySelector("[data-submit]").onclick = async function () {
    if (!picked) { toast("Pick a star rating."); return; }
    try {
      await createRating({ conversationId: conv.id, rateeId: otherId, stars: picked,
        comment: bar.querySelector("[data-msg]").value });
      toast("Thanks for the rating!");
      renderDeal(m, conv);
    } catch (e) { toast((e && e.message) || "Couldn't submit rating."); }
  };
}

// opts: { conv } for an existing thread, or { listing } for a lazy new thread.
async function openPanel(opts, person, sub) {
  lastOpener = document.activeElement;
  var profile = await getProfile();
  if (!profile) { location.href = base() + "pages/login.html"; return; }
  meId = profile.id; seen = {};
  var conv = opts.conv || null;
  if (!conv && opts.listing && opts.listing.id) {
    // Re-opening a listing I already messaged: load that thread (find-only —
    // creating eagerly would bump response_count and the conversation rate guard).
    try { conv = await findConversation(opts.listing.id); } catch (e) { /* lazy create on send */ }
  }
  var m = modal(), log = m.querySelector("[data-log]"), input = m.querySelector("[data-input]");
  m.querySelector("[data-av]").innerHTML = avatarHTML(person, "md");
  m.querySelector("[data-who]").textContent = person.name;
  m.querySelector("[data-sub]").textContent = sub;
  var reporteeId = conv ? (conv.buyer_id === meId ? conv.owner_id : conv.buyer_id)
                        : (opts.listing && opts.listing.user_id);
  m.querySelector("[data-report-user]").onclick = function () {
    if (reporteeId) openReport({ reportedUserId: reporteeId, reportedName: person.name,
      conversationId: conv && conv.id });
  };
  log.innerHTML = '<div class="chat__empty">Say hello 👋</div>';
  m.classList.add("open");

  m.querySelector("[data-form]").onsubmit = async function (e) {
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = "";
    try {
      if (!conv) { conv = await getOrCreateConversation(opts.listing); listen(log, conv.id); renderDeal(m, conv); }
      await sendMessage(conv.id, text);
      noteConversationOpened(conv.id);
    } catch (err) { toast((err && err.message) || "Couldn't send."); input.value = text; }
  };

  if (conv) {
    noteConversationOpened(conv.id);
    try {
      var msgs = await getMessages(conv.id);
      if (msgs.length) { log.innerHTML = ""; msgs.forEach(function (x) { append(log, x); }); }
    } catch (err) { log.innerHTML = '<div class="chat__empty">Couldn\'t load messages.</div>'; }
    listen(log, conv.id);
  }
  renderDeal(m, conv);
  input.focus();
}

export async function openChatForListing(listing) {
  var person = { name: listing.owner_name || "Seller", avatar_path: listing.owner_avatar };
  var sub = (listing.type === "sell" ? "Re: " : "You have: ") + listing.title;
  try { await openPanel({ listing: listing }, person, sub); }
  catch (err) { toast((err && err.message) || "Couldn't open chat."); }
}

export function openChatForConversation(conv) {
  var other = conv.iAmOwner ? conv.buyer : conv.owner;
  var person = { name: (other && other.name) || (conv.iAmOwner ? "Buyer" : "Seller"),
                 avatar_path: other && other.avatar_path };
  openPanel({ conv: conv }, person, "Re: " + (conv.listing ? conv.listing.title : "Listing"));
}

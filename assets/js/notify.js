// Need-It-Now — global new-message notifications: nav badge, tab title, toast.
import { myUnreadCount, markConversationRead, subscribeMyMessages } from "./api.js";
import { toast } from "./ui.js";

var meId = null, unread = 0, openConvId = null, baseTitle = null, persist = null;

function paint(n) {
  unread = Math.max(0, n);
  if (baseTitle === null) baseTitle = document.title;
  document.title = (unread > 0 ? "(" + unread + ") " : "") + baseTitle;
  var badge = document.querySelector("[data-unread]");
  if (badge) {
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
  }
  if (persist) persist(unread);
}

async function refresh() {
  try { paint(await myUnreadCount()); } catch (e) { /* keep current value */ }
}

/* Called by auth.js once per page when a user is logged in. */
export function initNotifications(opts) {
  meId = opts.me;
  persist = opts.onCountChange || null;
  refresh();
  subscribeMyMessages(async function (msg) {
    if (!msg || msg.sender_id === meId) return;
    if (openConvId && msg.conversation_id === openConvId) {
      try { await markConversationRead(openConvId); } catch (e) { /* offline */ }
      return; // the open chat panel renders it; no toast
    }
    paint(unread + 1);
    toast("New message from " + (msg.sender_name || "a neighbor"), {
      actionLabel: "View",
      onAction: function () {
        // auth.js's base() would create an import cycle; same logic inline.
        var prefix = location.pathname.indexOf("/pages/") !== -1 ? "" : "pages/";
        location.href = prefix + "messages.html";
      },
    });
  });
}

/* chat.js hooks: keep the open conversation read and the badge honest. */
export async function noteConversationOpened(convId) {
  openConvId = convId;
  try { await markConversationRead(convId); } catch (e) { /* offline */ }
  refresh();
}
export function noteConversationClosed() { openConvId = null; }

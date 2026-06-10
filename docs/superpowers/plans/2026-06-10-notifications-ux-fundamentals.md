# Notifications & UX Fundamentals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unread-message notifications (badge + realtime toast + read-tracking), a proper toast/confirm system, password reset, and a batch of UI/perf improvements to the Need-It-Now marketplace.

**Architecture:** Static ES-module front end talking to Supabase. New `assets/js/ui.js` (toast v2 + confirm dialog + Esc helper) and `assets/js/notify.js` (global realtime message listener). Read-state lives in two new `conversations` columns written only by a `mark_conversation_read()` SECURITY DEFINER RPC, mirroring the existing `mark_dealt()` locked-columns pattern. Realtime delivery is already RLS-scoped (the `messages` publication exists at `supabase/schema.sql:289`).

**Tech Stack:** Vanilla JS ES modules, supabase-js v2 (esm.sh), Postgres RLS + SECURITY DEFINER RPCs.

**Spec:** `docs/superpowers/specs/2026-06-10-notifications-ux-fundamentals-design.md`

**Testing note:** This repo is a static site with no test framework. Per the spec, every task ends with a concrete manual-verification step using the local preview (start one with the preview tools if not running). Treat verification failures like failing tests: stop and fix before committing.

**Schema note:** Tasks 3–6 need `supabase/schema.sql` re-run in the hosted Supabase SQL Editor. The executor cannot do this — there is an explicit USER ACTION checkpoint.

**Already satisfied (no task):** the spec's "Image CLS" item — `.listing__media` already reserves space with `aspect-ratio: 16/10` (`assets/css/main.css:251`). Verify only: feed photos load without layout shift.

---

## Phase 1 — UX primitives

### Task 1: Toast v2 (`ui.js` + CSS + re-export)

**Files:**
- Create: `assets/js/ui.js`
- Modify: `assets/js/auth.js` (remove `toast`, re-export from ui.js)
- Modify: `assets/css/main.css` (replace `.toast` block ~lines 302–309; mobile rule ~line 522)

- [ ] **Step 1: Create `assets/js/ui.js`**

```js
// Need-It-Now — shared UI primitives: toasts, confirm dialog, modal helpers.

var ICONS = { success: "✓", error: "⚠", info: "" };
var DURATION = { success: 2400, info: 2400, error: 5500 };

function container() {
  var c = document.querySelector(".toasts");
  if (!c) {
    c = document.createElement("div");
    c.className = "toasts";
    c.setAttribute("role", "status");
    c.setAttribute("aria-live", "polite");
    document.body.appendChild(c);
  }
  return c;
}

/* toast("Saved.")  or  toast("Gone.", { type: "error", actionLabel: "Undo", onAction: fn }) */
export function toast(msg, opts) {
  opts = opts || {};
  var type = ICONS.hasOwnProperty(opts.type) ? opts.type : "info";
  var c = container();
  var t = document.createElement("div");
  t.className = "toast toast--" + type;
  if (ICONS[type]) {
    var ic = document.createElement("span");
    ic.className = "toast__icon"; ic.setAttribute("aria-hidden", "true"); ic.textContent = ICONS[type];
    t.appendChild(ic);
  }
  var m = document.createElement("span");
  m.className = "toast__msg"; m.textContent = msg;
  t.appendChild(m);
  if (opts.actionLabel) {
    var a = document.createElement("button");
    a.className = "toast__action"; a.type = "button"; a.textContent = opts.actionLabel;
    a.addEventListener("click", function () { dismiss(); if (opts.onAction) opts.onAction(); });
    t.appendChild(a);
  }
  var x = document.createElement("button");
  x.className = "toast__x"; x.type = "button"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "✕";
  x.addEventListener("click", function () { dismiss(); });
  t.appendChild(x);
  c.appendChild(t);
  while (c.children.length > 3) c.removeChild(c.firstChild);
  requestAnimationFrame(function () { t.classList.add("show"); });
  var timer = setTimeout(dismiss, opts.duration || DURATION[type]);
  function dismiss() {
    clearTimeout(timer);
    if (!t.parentNode) return;
    t.classList.remove("show");
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 200);
  }
  return dismiss;
}
```

- [ ] **Step 2: Replace the toast in `assets/js/auth.js`**

Delete the `toast` function (current lines 13–18) and add a re-export so every existing `import { toast } from "./auth.js"` (feed.js, chat.js, report.js, admin.js, …) keeps working:

```js
export { toast } from "./ui.js";
```

(Place it right after the existing import lines. `auth.js` itself never calls `toast`, so nothing else changes.)

- [ ] **Step 3: Replace the `.toast` CSS block in `assets/css/main.css`**

Replace the current block (lines 302–309, the `/* Toast */` section) with:

```css
/* Toasts — stacking container + variants */
.toasts {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-2);
  z-index: 200; pointer-events: none; max-width: calc(100vw - 32px);
}
.toast {
  display: flex; align-items: center; gap: .6ch;
  background: var(--ink); color: #fff; padding: .8rem 1.2rem; border-radius: var(--r-pill);
  font-weight: 700; font-size: var(--fs-sm); box-shadow: var(--shadow-lg);
  opacity: 0; transform: translateY(20px); transition: opacity .2s, transform .2s;
  pointer-events: auto; max-width: 100%;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast--success .toast__icon { color: #4ade80; }
.toast--error { background: #7f1d1d; }
.toast--error .toast__icon { color: #fca5a5; }
.toast__action {
  border: 0; background: rgba(255,255,255,.16); color: #fff; font: inherit; font-weight: 800;
  padding: .3rem .7rem; border-radius: var(--r-pill); cursor: pointer; margin-left: .4ch;
}
.toast__action:hover { background: rgba(255,255,255,.26); }
.toast__x {
  border: 0; background: none; color: rgba(255,255,255,.7); font: inherit;
  cursor: pointer; padding: 0 0 0 .4ch; line-height: 1;
}
.toast__x:hover { color: #fff; }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
```

Then in the mobile media block (`@media (max-width: 760px)`, ~line 522) change:

```css
.toast { bottom: calc(var(--bottomnav-h) + 18px); }
```

to:

```css
.toasts { bottom: calc(var(--bottomnav-h) + 18px); }
```

- [ ] **Step 4: Verify in the preview**

On the feed page, run in the browser console:

```js
const { toast } = await import("/assets/js/ui.js");
toast("Plain info toast");
toast("Saved!", { type: "success" });
toast("Something broke", { type: "error", actionLabel: "Retry", onAction: () => console.log("retry!") });
```

Expected: three stacked pills (newest at bottom), success has a green ✓, error is dark red with ⚠ and stays ~5.5 s, the Retry button logs `retry!` and dismisses, ✕ dismisses, container has `role="status" aria-live="polite"`. Also delete-a-listing still toasts (re-export works).

- [ ] **Step 5: Commit**

```bash
git add assets/js/ui.js assets/js/auth.js assets/css/main.css
git commit -m "feat: toast v2 — variants, stacking, actions, screen-reader announcements"
```

### Task 2: Confirm dialog + replace window.confirm

**Files:**
- Modify: `assets/js/ui.js` (add `confirmDialog`)
- Modify: `assets/css/main.css` (add `.btn--danger`, `.confirm__actions`)
- Modify: `assets/js/feed.js:146-155` (`confirmDelete`)
- Modify: `assets/js/admin.js:151-157` and `assets/js/admin.js:223-229`

- [ ] **Step 1: Add `confirmDialog` to `assets/js/ui.js`**

```js
/* confirmDialog({title, body, confirmLabel, cancelLabel, danger}) -> Promise<boolean> */
export function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var back = document.createElement("div");
    back.className = "modal-back open";
    back.innerHTML =
      '<div class="modal card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">' +
        '<h3 id="confirm-title"></h3>' +
        '<p class="muted" data-body></p>' +
        '<div class="confirm__actions">' +
          '<button type="button" class="btn btn--ghost" data-cancel></button>' +
          '<button type="button" class="btn" data-ok></button>' +
        "</div></div>";
    back.querySelector("h3").textContent = opts.title || "Are you sure?";
    back.querySelector("[data-body]").textContent = opts.body || "";
    var cancel = back.querySelector("[data-cancel]");
    var ok = back.querySelector("[data-ok]");
    cancel.textContent = opts.cancelLabel || "Cancel";
    ok.textContent = opts.confirmLabel || "OK";
    ok.classList.add(opts.danger ? "btn--danger" : "btn--primary");
    var prevFocus = document.activeElement;
    function done(val) {
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(val);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Tab") {
        var f = [cancel, ok];
        var i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }
    back.addEventListener("click", function (e) { if (e.target === back) done(false); });
    cancel.addEventListener("click", function () { done(false); });
    ok.addEventListener("click", function () { done(true); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    cancel.focus();
  });
}
```

- [ ] **Step 2: Add CSS to `assets/css/main.css`** (right after the `.btn--sm` rule, ~line 102)

```css
.btn--danger { background: var(--danger); color: #fff; box-shadow: 0 6px 18px rgba(226,72,59,.35); }
.btn--danger:hover { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(226,72,59,.45); }
.confirm__actions { display: flex; gap: var(--sp-2); justify-content: flex-end; margin-top: var(--sp-5); }
```

- [ ] **Step 3: Swap `feed.js` delete confirm**

Add to feed.js imports: `import { confirmDialog } from "./ui.js";`
Replace `confirmDelete` (lines 146–155) with:

```js
async function confirmDelete(id) {
  var ok = await confirmDialog({
    title: "Delete this listing?", body: "This can't be undone.",
    confirmLabel: "Delete", danger: true,
  });
  if (!ok) return;
  try {
    await deleteListing(id);
    toast("Listing deleted.", { type: "success" });
    render();
  } catch (e) {
    toast((e && e.message) || "Couldn't delete — try again.", { type: "error" });
  }
}
```

- [ ] **Step 4: Swap the two `admin.js` confirms**

Add to admin.js imports: `import { confirmDialog } from "./ui.js";`

Listing delete (lines 151–157) becomes:

```js
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
```

Category delete (lines 223–229) becomes:

```js
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
```

- [ ] **Step 5: Verify in the preview**

Logged in, on the feed: click Delete on your own listing. Expected: styled modal (red Delete button), focus starts on Cancel, Esc cancels, backdrop-click cancels, Tab cycles between the two buttons, confirming deletes + success toast, and focus returns to the page. `rg "window.confirm" assets/js` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add assets/js/ui.js assets/css/main.css assets/js/feed.js assets/js/admin.js
git commit -m "feat: styled confirm dialog replaces window.confirm"
```

---

## Phase 2 — Unread message notifications

### Task 3: Schema — read markers + RPCs

**Files:**
- Modify: `supabase/schema.sql` (append at end of file)

- [ ] **Step 1: Append this section to `supabase/schema.sql`**

```sql
-- ============================================================
-- Unread tracking: per-side read markers (clients have no UPDATE
-- grant on these; only the RPC below writes them — same model as
-- mark_dealt / dealt_*_at).
-- ============================================================
alter table public.conversations add column if not exists buyer_read_at timestamptz;
alter table public.conversations add column if not exists owner_read_at timestamptz;

-- Sets ONLY the calling party's read marker.
create or replace function public.mark_conversation_read(conv_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = conv_id;
  if not found then raise exception 'Conversation not found'; end if;
  if auth.uid() = c.buyer_id then
    update public.conversations set buyer_read_at = now() where id = conv_id;
  elsif auth.uid() = c.owner_id then
    update public.conversations set owner_read_at = now() where id = conv_id;
  else
    raise exception 'Not authorized';
  end if;
end; $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;

-- Conversations holding a message from the OTHER party newer than my marker.
create or replace function public.my_unread_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.conversations c
  where (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
    and exists (
      select 1 from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(
          case when c.buyer_id = auth.uid() then c.buyer_read_at else c.owner_read_at end,
          'epoch'::timestamptz)
    );
$$;
revoke execute on function public.my_unread_count() from public, anon;
grant  execute on function public.my_unread_count() to authenticated;
```

- [ ] **Step 2: USER ACTION — apply the schema**

Ask the user to re-run `supabase/schema.sql` in the Supabase SQL Editor (it is idempotent). Do not proceed to verification of Tasks 4–6 until they confirm.

- [ ] **Step 3: Verify in the SQL Editor** (user runs, or ask them to paste results)

```sql
select column_name from information_schema.columns
 where table_name = 'conversations' and column_name like '%read%';
```

Expected: `buyer_read_at`, `owner_read_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): conversation read markers + mark_conversation_read/my_unread_count RPCs"
```

### Task 4: API functions

**Files:**
- Modify: `assets/js/api.js` (add after `markDealt`, ~line 264)

- [ ] **Step 1: Add the three functions**

```js
/* ---------------- Unread / notifications ---------------- */
export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc("mark_conversation_read", { conv_id: conversationId });
  if (error) throw error;
}

export async function myUnreadCount() {
  const { data, error } = await supabase.rpc("my_unread_count");
  if (error) return 0; // never break page render over a badge
  return data || 0;
}

/* All message INSERTs visible to me (RLS scopes delivery to my conversations). */
export function subscribeMyMessages(onInsert) {
  const channel = supabase
    .channel("messages:mine")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      function (payload) { onInsert(payload.new); })
    .subscribe();
  return function () { supabase.removeChannel(channel); };
}
```

- [ ] **Step 2: Verify in the preview console** (logged in, schema applied)

```js
const api = await import("/assets/js/api.js");
console.log(await api.myUnreadCount());   // a number (0 is fine)
```

Expected: integer, no thrown error.

- [ ] **Step 3: Commit**

```bash
git add assets/js/api.js
git commit -m "feat(api): markConversationRead, myUnreadCount, subscribeMyMessages"
```

### Task 5: Nav unread badge

**Files:**
- Modify: `assets/js/auth.js` (`navHTML`, `renderNavUser`, imports)
- Modify: `assets/css/main.css` (add `.nav__badge`)

- [ ] **Step 1: Import the count in `auth.js`**

Change the api.js import line to include `myUnreadCount`:

```js
import { signUp, signIn, signOut, getProfile, amIAdmin, myUnreadCount } from "./api.js";
```

- [ ] **Step 2: Render the badge in `navHTML`**

Replace the Messages link line (currently `auth.js:46`) with:

```js
      '<a href="' + base() + 'pages/messages.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--ink-2);text-decoration:none;padding:.5rem .8rem">Messages' +
        '<span class="nav__badge" data-unread' +
        (state.unread > 0 ? ">" + (state.unread > 99 ? "99+" : state.unread) : " hidden>") +
        "</span></a>" +
```

- [ ] **Step 3: Fetch the count during reconcile**

In `renderNavUser`, replace the `if (profile) { ... }` block with:

```js
  if (profile) {
    var isAdmin = false, unread = 0;
    try { isAdmin = await amIAdmin(); } catch (e) { /* not admin */ }
    try { unread = await myUnreadCount(); } catch (e) { /* badge optional */ }
    fresh = { loggedIn: true, name: profile.name, avatar_path: profile.avatar_path || null,
              isAdmin: isAdmin, unread: unread };
  } else {
    fresh = { loggedIn: false };
  }
```

- [ ] **Step 4: Add CSS** (after `.nav__avatar`, ~`main.css:81`)

```css
.nav__badge {
  display: inline-grid; place-items: center; min-width: 18px; height: 18px;
  padding: 0 5px; margin-left: .45ch; border-radius: var(--r-pill);
  background: var(--danger); color: #fff; font-size: 11px; font-weight: 800; line-height: 1;
  vertical-align: middle;
}
.nav__badge[hidden] { display: none; }
```

(The explicit `[hidden]` rule is required — `display: inline-grid` would otherwise override the UA's `hidden` styling.)

- [ ] **Step 5: Verify**

Logged in with no unread: no badge. In the SQL Editor, simulate unread (as another user, message one of your conversations, or temporarily `update conversations set buyer_read_at = null where buyer_id = '<your uid>';`). Reload: red count pill next to "Messages".

- [ ] **Step 6: Commit**

```bash
git add assets/js/auth.js assets/css/main.css
git commit -m "feat: unread count badge on Messages nav link"
```

### Task 6: Global listener (`notify.js`) + chat/inbox integration

**Files:**
- Create: `assets/js/notify.js`
- Modify: `assets/js/auth.js` (init after reconcile)
- Modify: `assets/js/chat.js` (mark read on open/send/close)
- Modify: `assets/js/messages.js` (unread row styling)
- Modify: `assets/css/main.css` (thread unread styles)

- [ ] **Step 1: Create `assets/js/notify.js`**

```js
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
```

- [ ] **Step 2: Wire it from `auth.js`**

Add the import:

```js
import { initNotifications } from "./notify.js";
```

At the end of `renderNavUser` (after `writeNavCache(fresh);`) add:

```js
  if (fresh.loggedIn && profile) {
    initNotifications({
      me: profile.id,
      onCountChange: function (n) {
        var s = readNavCache();
        if (s) { s.unread = n; writeNavCache(s); }
      },
    });
  }
```

- [ ] **Step 3: Mark read from `chat.js`**

Add the import:

```js
import { noteConversationOpened, noteConversationClosed } from "./notify.js";
```

Three call sites:
1. In `close()` (after `seen = {};`): add `noteConversationClosed();`
2. In `openPanel`, inside the `if (conv) {` block at the bottom (before `var msgs = await getMessages(conv.id);`): add `noteConversationOpened(conv.id);`
3. In the form `onsubmit`, after `await sendMessage(conv.id, text);` add `noteConversationOpened(conv.id);` — this keeps the read marker newer than your own messages so they never count as unread.

- [ ] **Step 4: Unread styling in `messages.js`**

Replace `rowHTML` with:

```js
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
```

And in the click wiring, clear the unread look once opened:

```js
  box.querySelectorAll(".thread").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.classList.remove("thread--unread");
      var dot = btn.querySelector(".thread__dot");
      if (dot) dot.remove();
      openChatForConversation(byId[btn.getAttribute("data-id")]);
    });
  });
```

- [ ] **Step 5: Thread CSS** (in `main.css`, next to the existing `.thread*` rules)

```css
.thread--unread .thread__snippet { color: var(--ink); font-weight: 700; }
.thread__dot {
  width: 9px; height: 9px; border-radius: 50%; background: var(--blue-600);
  flex: none; display: inline-block; margin-left: .5ch;
}
```

- [ ] **Step 6: Verify end-to-end** (requires schema applied — Task 3 checkpoint)

Two browser windows (normal + incognito), accounts A and B:
1. B messages A's listing. A (sitting on the feed page) sees within ~2 s: toast "New message from B" with **View**, badge appears, title becomes "(1) Feed — Need-It-Now".
2. A clicks View → messages inbox; B's conversation is bold with a blue dot.
3. A opens it → marks read; reload any page: badge gone, title clean.
4. With A's chat panel open, B sends another message: bubble appears, **no** toast, badge stays at 0 after reload.
5. Privacy: a third account C on the feed page gets no toast during A↔B traffic.

- [ ] **Step 7: Commit**

```bash
git add assets/js/notify.js assets/js/auth.js assets/js/chat.js assets/js/messages.js assets/css/main.css
git commit -m "feat: realtime new-message notifications — toast, badge, title, unread inbox rows"
```

---

## Phase 3 — Password reset

### Task 7: Reset flow

**Files:**
- Modify: `assets/js/api.js` (two functions)
- Create: `pages/reset.html`
- Create: `assets/js/reset.js`
- Modify: `pages/login.html` (forgot link)

- [ ] **Step 1: Add to `assets/js/api.js`** (after `signOut`)

```js
export async function requestPasswordReset(email) {
  // Works on both the local preview and GitHub Pages (sub-path safe).
  const root = location.origin + location.pathname.replace(/pages\/[^/]*$/, "");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: root + "pages/reset.html",
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
```

- [ ] **Step 2: Create `pages/reset.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset password — Need-It-Now</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="preconnect" href="https://yubhbztyprfupvjwxwmm.supabase.co" crossorigin />
  <link rel="preconnect" href="https://esm.sh" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/css/tokens.css" />
  <link rel="stylesheet" href="../assets/css/main.css" />
</head>
<body>
  <nav class="nav">
    <div class="nav__inner">
      <a class="brand" href="../index.html">
        <span class="brand__mark">⚡</span>
        <span class="full"><b>Need</b>-<b>It</b><span style="color:var(--ink)">-Now</span></span>
      </a>
      <div class="nav__links">
        <a href="../index.html">Home</a>
        <a href="feed.html">Browse</a>
        <a href="guidelines.html">Guidelines</a>
      </div>
      <div class="nav__user" data-nav-user></div>
    </div>
  </nav>

  <main class="auth-wrap">
    <form class="card auth-card reveal" data-reset-request novalidate>
      <h1>Reset your password</h1>
      <p class="sub">Enter your account email and we'll send a reset link.</p>
      <div class="field">
        <label for="rp-email">Email</label>
        <input class="input" id="rp-email" name="email" type="email" autocomplete="email" placeholder="you@email.com" />
      </div>
      <p class="form-error" role="alert"></p>
      <button class="btn btn--primary btn--block btn--lg" type="submit">Send reset link</button>
      <p class="auth-foot">Remembered it? <a href="login.html">Log in</a></p>
    </form>

    <form class="card auth-card reveal" data-reset-update hidden novalidate>
      <h1>Choose a new password</h1>
      <p class="sub">You're almost back in.</p>
      <div class="field">
        <label for="rp-pass">New password</label>
        <input class="input" id="rp-pass" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" />
      </div>
      <div class="field">
        <label for="rp-pass2">Repeat it</label>
        <input class="input" id="rp-pass2" name="password2" type="password" autocomplete="new-password" placeholder="Same password again" />
      </div>
      <p class="form-error" role="alert"></p>
      <button class="btn btn--primary btn--block btn--lg" type="submit">Save new password</button>
    </form>
  </main>

  <script type="module" src="../assets/js/auth.js"></script>
  <script type="module" src="../assets/js/reset.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `assets/js/reset.js`**

```js
// Need-It-Now — password reset page (request a link / set a new password).
import { supabase, requestPasswordReset, updatePassword } from "./api.js";
import { toast } from "./ui.js";
import { go } from "./auth.js";

function show(which) {
  document.querySelector("[data-reset-request]").hidden = which !== "request";
  document.querySelector("[data-reset-update]").hidden = which !== "update";
}

document.addEventListener("DOMContentLoaded", function () {
  var reqForm = document.querySelector("[data-reset-request]");
  var updForm = document.querySelector("[data-reset-update]");
  if (!reqForm || !updForm) return;

  // Arriving from the email link carries a recovery token in the hash;
  // supabase-js exchanges it and fires PASSWORD_RECOVERY.
  if (location.hash.indexOf("type=recovery") !== -1) show("update");
  supabase.auth.onAuthStateChange(function (event) {
    if (event === "PASSWORD_RECOVERY") show("update");
  });

  reqForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = reqForm.querySelector(".form-error");
    err.classList.remove("form-error--ok");
    err.textContent = "";
    var email = reqForm.email.value.trim();
    if (!email) { err.textContent = "Enter your email."; return; }
    var btn = reqForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      await requestPasswordReset(email);
      err.classList.add("form-error--ok");
      err.textContent = "If that email has an account, a reset link is on its way.";
    } catch (e2) {
      err.textContent = (e2 && e2.message) || "Couldn't send the reset email.";
    } finally {
      btn.disabled = false; btn.textContent = "Send reset link";
    }
  });

  updForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = updForm.querySelector(".form-error");
    err.textContent = "";
    var p1 = updForm.password.value, p2 = updForm.password2.value;
    if (p1.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
    if (p1 !== p2) { err.textContent = "Passwords don't match."; return; }
    var btn = updForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await updatePassword(p1);
      toast("Password updated — you're logged in.", { type: "success" });
      go("pages/feed.html");
    } catch (e2) {
      err.textContent = (e2 && e2.message) || "Couldn't update the password.";
      btn.disabled = false; btn.textContent = "Save new password";
    }
  });
});
```

- [ ] **Step 4: Forgot link on `pages/login.html`**

After the password `.field` div (line 41), insert:

```html
      <p style="text-align:right;margin:-.4rem 0 var(--sp-4)">
        <a href="reset.html" style="font-size:var(--fs-sm);color:var(--blue-600);font-weight:700;text-decoration:none">Forgot password?</a>
      </p>
```

- [ ] **Step 5: USER ACTION — allow the redirect URL**

Ask the user to add the site origins to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, e.g. `http://localhost:*/**` (or the preview's printed origin) and the GitHub Pages URL `https://<user>.github.io/<repo>/**`. Reset emails will not redirect without this.

- [ ] **Step 6: Verify**

Preview: login page shows "Forgot password?"; reset page shows the request form; submitting a known email shows the green confirmation. Full round-trip (click the email link → update form → new password logs in) — verify on the allowed origin; if the user can't check email now, note it as pending user verification.

- [ ] **Step 7: Commit**

```bash
git add assets/js/api.js assets/js/reset.js pages/reset.html pages/login.html
git commit -m "feat: password reset flow (request link + recovery update)"
```

---

## Phase 4 — UI polish

### Task 8: Skeleton loaders on the feed

**Files:**
- Modify: `assets/css/main.css` (skeleton styles, after the `.empty` rules ~line 267)
- Modify: `assets/js/feed.js` (`render`, new `skeletonHTML`)

- [ ] **Step 1: CSS**

```css
/* Loading skeletons */
.skel { position: relative; overflow: hidden; background: var(--surface-2); border-radius: var(--r-sm); }
.skel::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent);
  transform: translateX(-100%); animation: shimmer 1.4s infinite;
}
@keyframes shimmer { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
```

- [ ] **Step 2: `feed.js` — add `skeletonHTML` (above `render`) and use it**

```js
function skeletonHTML() {
  return '<article class="listing" aria-hidden="true">' +
    '<div class="listing__media skel"></div>' +
    '<div class="listing__body">' +
      '<div class="skel" style="height:14px;width:40%"></div>' +
      '<div class="skel" style="height:22px;width:75%"></div>' +
      '<div class="skel" style="height:14px;width:90%"></div>' +
      '<div class="skel" style="height:14px;width:55%"></div>' +
    "</div></article>";
}
```

Replace the `if (!grid.dataset.loaded) { grid.innerHTML = '<div class="empty">…⏳…</div>'; }` block in `render()` with:

```js
  if (!grid.dataset.loaded) {
    var sk = "";
    for (var i = 0; i < 6; i++) sk += skeletonHTML();
    grid.innerHTML = sk;
  }
```

- [ ] **Step 3: Verify**

Hard-reload the feed (DevTools → Network → throttle to "Slow 4G" to see it): 6 shimmering placeholder cards in the grid layout, replaced by real cards. No ⏳ emoji.

- [ ] **Step 4: Commit**

```bash
git add assets/css/main.css assets/js/feed.js
git commit -m "feat: skeleton loaders for the feed"
```

### Task 9: Filters in the URL

**Files:**
- Modify: `assets/js/feed.js` (`wireControls`, `scheduleRender`, new helpers)

- [ ] **Step 1: Add helpers (above `wireControls`)**

```js
function readStateFromURL() {
  var p = new URLSearchParams(location.search);
  if (p.get("zip")) state.zip = p.get("zip");
  if (p.get("radius")) state.radius = +p.get("radius") || state.radius;
  if (p.get("type") === "sell" || p.get("type") === "buy") state.type = p.get("type");
  if (p.get("q")) state.q = p.get("q");
}
function writeStateToURL() {
  var p = new URLSearchParams();
  if (state.zip) p.set("zip", state.zip);
  if (state.radius !== 25) p.set("radius", String(state.radius));
  if (state.type !== "all") p.set("type", state.type);
  if (state.q) p.set("q", state.q);
  var qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}
```

- [ ] **Step 2: Apply URL state in `wireControls`**

Right after `state.zip = (currentProfile && currentProfile.zip) || "78701";` add:

```js
  readStateFromURL(); // shared/refreshed URLs win over the profile default
  search.value = state.q;
  document.querySelectorAll(".chip").forEach(function (c) {
    c.classList.toggle("active", c.getAttribute("data-filter") === state.type);
  });
```

(The existing `loc.value = state.zip; rad.value = String(state.radius);` lines stay and now reflect URL values.)

- [ ] **Step 3: Write the URL on changes**

`scheduleRender` becomes:

```js
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(function () { writeStateToURL(); render(); }, 250);
}
```

And in the chip click handler add `writeStateToURL();` immediately before `render();`.

- [ ] **Step 4: Verify**

Type a search, pick "For sale", change radius → URL becomes e.g. `feed.html?zip=78701&radius=10&type=sell&q=bike`. Reload: all controls and results match. Open the URL in a new tab: same. Clean `feed.html` still works.

- [ ] **Step 5: Commit**

```bash
git add assets/js/feed.js
git commit -m "feat: feed filters persist in the URL"
```

### Task 10: Optimistic delete

**Files:**
- Modify: `assets/js/feed.js` (`cardHTML` article tag, `confirmDelete`)

- [ ] **Step 1: Tag cards with their id**

In `cardHTML`, change `'<article class="listing">'` to:

```js
    '<article class="listing" data-id="' + row.id + '">' +
```

- [ ] **Step 2: Remove the card before the API call**

Replace `confirmDelete` (as written in Task 2) with:

```js
async function confirmDelete(id) {
  var ok = await confirmDialog({
    title: "Delete this listing?", body: "This can't be undone.",
    confirmLabel: "Delete", danger: true,
  });
  if (!ok) return;
  var grid = document.getElementById("listings");
  var card = grid && grid.querySelector('.listing[data-id="' + id + '"]');
  if (card) card.remove();
  lastRows = lastRows.filter(function (r) { return r.id !== id; });
  try {
    await deleteListing(id);
    toast("Listing deleted.", { type: "success" });
    if (grid && !grid.querySelector(".listing")) render(); // show empty state
  } catch (e) {
    toast((e && e.message) || "Couldn't delete — try again.", { type: "error" });
    render(); // restore the card
  }
}
```

- [ ] **Step 3: Verify**

Delete one of your listings: the card vanishes instantly, success toast follows. Error path: DevTools → Network → Offline, delete another → card vanishes, error toast appears, card comes back via re-render (when back online, the refetch restores truth).

- [ ] **Step 4: Commit**

```bash
git add assets/js/feed.js
git commit -m "feat: optimistic listing delete"
```

### Task 11: Esc-to-close + focus return for chat & report modals

**Files:**
- Modify: `assets/js/ui.js` (add `escToClose`)
- Modify: `assets/js/chat.js` (Esc + focus return)
- Modify: `assets/js/report.js` (Esc)

(`confirmDialog` already has full Esc/trap/return from Task 2.)

- [ ] **Step 1: Add to `ui.js`**

```js
/* Esc closes a .modal-back panel while it is open. Call once per backdrop. */
export function escToClose(backdrop, close) {
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      e.preventDefault();
      close();
    }
  });
}
```

- [ ] **Step 2: `chat.js`**

Add import: `import { escToClose } from "./ui.js";`
Add a module-level var next to the others (line 8): `var lastOpener = null;`
In `modal()`, after the `[data-close]` listener line: `escToClose(m, close);`
In `openPanel`, as the first line: `lastOpener = document.activeElement;`
In `close()`, at the end:

```js
  if (lastOpener && lastOpener.focus) { lastOpener.focus(); lastOpener = null; }
```

- [ ] **Step 3: `report.js`**

Add import: `import { escToClose } from "./ui.js";`
In `build()`, after the `[data-rcancel]` listener: `escToClose(m, function () { m.classList.remove("open"); });`

- [ ] **Step 4: Verify**

Open a chat from the feed → Esc closes it and focus lands back on the "I'm interested" button. Open the report dialog (⚑) → Esc closes it. Esc with nothing open does nothing.

- [ ] **Step 5: Commit**

```bash
git add assets/js/ui.js assets/js/chat.js assets/js/report.js
git commit -m "feat: Esc-to-close and focus return for chat/report modals"
```

---

## Phase 5 — Performance

### Task 12: Parallel nav reconcile

**Files:**
- Modify: `assets/js/auth.js` (`renderNavUser`)

- [ ] **Step 1: Replace the sequential awaits** (the block written in Task 5 Step 3)

```js
  if (profile) {
    var extras = await Promise.all([
      amIAdmin().catch(function () { return false; }),
      myUnreadCount().catch(function () { return 0; }),
    ]);
    fresh = { loggedIn: true, name: profile.name, avatar_path: profile.avatar_path || null,
              isAdmin: extras[0], unread: extras[1] };
  } else {
    fresh = { loggedIn: false };
  }
```

- [ ] **Step 2: Verify**

Network tab on any page while logged in: the `is_admin` (or `amIAdmin` RPC) and `my_unread_count` requests start at the same time instead of back-to-back. Nav renders identically.

- [ ] **Step 3: Commit**

```bash
git add assets/js/auth.js
git commit -m "perf: parallelize nav reconcile lookups"
```

### Task 13: Feed sessionStorage cache

**Files:**
- Modify: `assets/js/feed.js` (`render` refactor + cache helpers)

- [ ] **Step 1: Add cache helpers (below `readStateFromURL`/`writeStateToURL`)**

```js
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
```

- [ ] **Step 2: Extract painting and use the cache — final `render()` shape**

Pull the card painting + button wiring out of `render()` into `paintRows`, then rework `render()`:

```js
function paintRows(rows) {
  var grid = document.getElementById("listings");
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
  grid.querySelectorAll("[data-report]").forEach(function (btn) {
    btn.addEventListener("click", function () { reportListing(btn.getAttribute("data-report")); });
  });
}

var renderToken = 0;
async function render() {
  var grid = document.getElementById("listings");
  var count = document.getElementById("result-count");
  var token = ++renderToken;
  var origin = await resolveZip(state.zip);
  if (token !== renderToken) return; // a newer render superseded this lookup

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
  paintRows(rows);
  writeFeedCache(rows, count ? count.textContent : "");
}
```

- [ ] **Step 3: Verify**

Load the feed, click into a listing owner's profile, press Back (or re-navigate to the feed): cards paint immediately (no skeletons), then refresh silently. Changing any filter still fetches normally. `sessionStorage.getItem("nin_feed_v1")` shows the cached rows.

- [ ] **Step 4: Commit**

```bash
git add assets/js/feed.js
git commit -m "perf: sessionStorage feed cache for instant back-navigation paint"
```

### Task 14: Preconnect hints

**Files:**
- Modify: `index.html`, `pages/feed.html`, `pages/post.html`, `pages/login.html`, `pages/register.html`, `pages/messages.html`, `pages/profile.html`, `pages/admin.html`, `pages/guidelines.html`
  (`pages/reset.html` already has them from Task 7.)

- [ ] **Step 1: In each file's `<head>`, after the two fonts preconnect lines, add:**

```html
  <link rel="preconnect" href="https://yubhbztyprfupvjwxwmm.supabase.co" crossorigin />
  <link rel="preconnect" href="https://esm.sh" crossorigin />
```

- [ ] **Step 2: Verify**

`rg -l "esm.sh\" crossorigin" index.html pages` lists all 10 HTML files. Spot-check one page in the preview — no console errors, network panel shows early connections.

- [ ] **Step 3: Commit**

```bash
git add index.html pages
git commit -m "perf: preconnect to Supabase and esm.sh"
```

### Task 15: Update the CLAUDE.md project map

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Refresh the stale sections**

In **Where things live**, update the app-pages line to:

```markdown
- **App pages** live in `pages/`: `register.html`, `login.html`, `reset.html`,
  `post.html`, `feed.html`, `messages.html`, `profile.html`, `admin.html`,
  `guidelines.html`. Each is standalone HTML.
```

In the scripts list, add after the `auth.js` bullet:

```markdown
  - `ui.js` — shared UI primitives: `toast(msg, opts)` (variants/stacking/actions,
    aria-live), `confirmDialog()` (promise-based styled confirm), `escToClose()`.
  - `notify.js` — global realtime new-message notifications: nav unread badge,
    "(n)" tab-title prefix, toast with View action; chat.js reports open/close
    so the open conversation stays marked read.
  - `chat.js` / `messages.js` — realtime chat panel and the Messages inbox
    (unread rows bold + dot, read markers via `mark_conversation_read`).
  - `reset.js` — password-reset page (request link / recovery update).
```

In **Backend / Supabase**, add to the write-protection paragraph:

```markdown
  `conversations.buyer_read_at`/`owner_read_at` are written only by
  `mark_conversation_read()` (sets the caller's side); unread badges come from
  `my_unread_count()`.
```

- [ ] **Step 2: Verify**

Read the diff — every claim matches something implemented in Tasks 1–14; no stale references remain in the edited sections.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: refresh CLAUDE.md project map (pages, ui/notify modules, read markers)"
```

---

## Final verification sweep

- [ ] `rg "window.confirm" assets/js` → no matches.
- [ ] Spec 1d: submit the post form with a failure (e.g. DevTools offline) — the error surfaces as a friendly inline/`error`-toast message, not a raw console error. If it shows a raw Supabase message, route it through `friendlyError`-style copy in `post.js` as a follow-up fix.
- [ ] Logged-out pass: index, feed, login, register, reset — no console errors, no badge, no realtime subscription.
- [ ] Logged-in pass on every page: nav paints from cache instantly; badge correct.
- [ ] Two-account message round-trip (Task 6 Step 6 checklist) one more time after all phases.
- [ ] Feed photos load with no layout shift (spec's CLS item — already covered by `aspect-ratio`).

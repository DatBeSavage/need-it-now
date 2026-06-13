# Messaging Revamp + Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft per-side conversation delete (⋮ menu on inbox rows) plus a dark-theme polish of the Messages inbox and chat panel (date separators, message grouping, nicer rows/bubbles).

**Architecture:** Two new `conversations` columns + a `delete_conversation` RPC mirroring the existing read-marker pattern; client-side visibility filter in `myConversations`. Inbox rows wrapped so a real ⋮ button sits beside the row-open button (no button-in-button). Chat grouping/date logic is render-only over already-sorted messages — it does NOT touch the subscription lifecycle (the cross-talk fix in commit fd02c48 stays intact).

**Tech Stack:** Supabase Postgres RPC + RLS, vanilla ES modules, CSS. No build step.

**Spec:** `docs/superpowers/specs/2026-06-12-messaging-revamp-delete-design.md`

**Verification note:** preview on port 5500 (`preview_list`). Browser caches modules hard — before each check: `await Promise.all(["/assets/js/api.js","/assets/js/messages.js","/assets/js/chat.js","/assets/css/main.css"].map(u => fetch(u,{cache:"reload"})))` then reload. Real listings/conversations live near ZIP 70611. Schema steps need the Task 1 USER ACTION first; verify the schema applied by probing, never trust "I ran it" (per project memory).

---

### Task 1: Schema — soft-delete markers + RPC

**Files:**
- Modify: `supabase/schema.sql` (append at end)

- [ ] **Step 1: Append exactly this** (mirrors the read-marker block above it):

```sql

-- ============================================================
-- Soft per-side conversation delete: hide a thread from one party's inbox
-- without touching the other side. Same locked-columns model as the read
-- markers — only the RPC writes these. A new message (which bumps
-- last_message_at past my marker) makes the thread reappear for me.
-- ============================================================
alter table public.conversations add column if not exists buyer_deleted_at timestamptz;
alter table public.conversations add column if not exists owner_deleted_at timestamptz;

-- Sets ONLY the caller's deleted marker (and read marker, so a dismissed
-- thread also stops counting toward the unread badge).
create or replace function public.delete_conversation(conv_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = conv_id;
  if not found then raise exception 'Conversation not found'; end if;
  if auth.uid() = c.buyer_id then
    update public.conversations set buyer_deleted_at = now(), buyer_read_at = now() where id = conv_id;
  elsif auth.uid() = c.owner_id then
    update public.conversations set owner_deleted_at = now(), owner_read_at = now() where id = conv_id;
  else
    raise exception 'Not authorized';
  end if;
end; $$;
revoke execute on function public.delete_conversation(uuid) from public, anon;
grant  execute on function public.delete_conversation(uuid) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): soft per-side conversation delete (delete_conversation RPC)"
```

- [ ] **Step 3: USER ACTION** — the controller shows the user a copyable section-only SQL tile and waits for confirmation it ran. (Do not verify Tasks 2+ against the DB until then.)

- [ ] **Step 4: Probe** (controller runs; don't trust the confirmation):
```js
(async () => {
  const api = await import("/assets/js/api.js?v=" + Date.now());
  const { error } = await api.supabase.rpc("delete_conversation", { conv_id: "00000000-0000-0000-0000-000000000000" });
  // Expect a "Conversation not found" application error, NOT a PGRST202 "function not found".
  return JSON.stringify({ reachable: !!error && error.code !== "PGRST202", code: error && error.code, msg: error && error.message });
})()
```
Expected: `reachable: true` (the function exists and raised "Conversation not found").

### Task 2: api.js — deleteConversation + inbox filter

**Files:**
- Modify: `assets/js/api.js` (`deleteConversation` near the other conversation RPCs; filter inside `myConversations`)

- [ ] **Step 1: Add `deleteConversation`** right after `markConversationRead` (api.js ~line 321):

```js
export async function deleteConversation(conversationId) {
  const { error } = await supabase.rpc("delete_conversation", { conv_id: conversationId });
  if (error) throw error;
}
```

- [ ] **Step 2: Filter my-deleted threads in `myConversations`.** Replace the final `return (data || []).map(...)` block with:

```js
  return (data || []).map(function (c) {
    return Object.assign({}, c, { iAmOwner: c.owner_id === profile.id, me: profile });
  }).filter(function (c) {
    var myDel = c.iAmOwner ? c.owner_deleted_at : c.buyer_deleted_at;
    return !myDel || new Date(c.last_message_at) > new Date(myDel);
  });
```

(`select *` already returns `buyer_deleted_at`/`owner_deleted_at`.)

- [ ] **Step 3: Verify** (cache-bust): `typeof api.deleteConversation === "function"`; `await api.deleteConversation("00000000-0000-0000-0000-000000000000")` rejects (not-found) rather than hanging; `myConversations()` still returns an array when logged in. No console errors.

- [ ] **Step 4: Commit**

```bash
git add assets/js/api.js
git commit -m "feat(api): deleteConversation + hide my-deleted threads from the inbox"
```

### Task 3: Inbox — ⋮ delete menu + dark-theme row polish

**Files:**
- Modify: `assets/js/messages.js`
- Modify: `assets/css/main.css`

- [ ] **Step 1: Rewrite `messages.js`** as follows (imports gain confirmDialog/toast/deleteConversation; rows wrapped with a ⋮ menu; empty state extracted; delete wired optimistic):

```js
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
```

- [ ] **Step 2: Add CSS** to `assets/css/main.css` (right after the `.thread__dot` rule, ~line 493):

```css
/* Inbox rows: ⋮ menu + dark polish */
.thread-row { position: relative; }
.thread-row .thread { width: 100%; transition: border-color .15s, box-shadow .15s, transform .08s; }
.thread-row .thread:hover { border-color: var(--border-2); transform: translateY(-1px); box-shadow: var(--shadow-md); }
.thread-row.is-unread .thread { border-color: rgba(95,176,255,.35); box-shadow: var(--glow-blue); }
.thread__top { padding-right: 22px; } /* room for the ⋮ button */
.thread-menu {
  position: absolute; top: 10px; right: 10px; width: 30px; height: 30px;
  border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted);
  font-size: 18px; line-height: 1; cursor: pointer; opacity: 0;
  transition: opacity .15s, background .15s, color .15s; z-index: 2;
}
.thread-row:hover .thread-menu, .thread-menu:focus-visible { opacity: 1; }
.thread-menu:hover { background: var(--surface-3); color: var(--ink); }
@media (pointer: coarse) { .thread-menu { opacity: 1; } }
.thread-pop {
  position: absolute; top: 40px; right: 10px; z-index: 5;
  background: var(--surface-solid); border: 1px solid var(--border-2);
  border-radius: var(--r-sm); box-shadow: var(--shadow-lg); overflow: hidden;
}
.thread-pop[hidden] { display: none; }
.thread-pop__item {
  display: block; width: 100%; text-align: left; border: 0; background: none;
  color: var(--danger); font: inherit; font-weight: 700; padding: .55rem .95rem;
  cursor: pointer; white-space: nowrap;
}
.thread-pop__item:hover { background: var(--surface-3); }
```

(The existing `.thread:hover { border-color: var(--blue-600); }` rule at ~line 481 is now superseded by the more specific `.thread-row .thread:hover`; leave it — it's harmless, the specific rule wins.)

- [ ] **Step 3: Verify (logged-out shows nothing useful — controller runs the logged-in E2E in Task 5).** For now: cache-bust + load `/pages/messages.html` (redirects to login when logged out — expected). Static check: open the page source renders without errors. The full delete E2E runs in Task 5.

- [ ] **Step 4: Commit**

```bash
git add assets/js/messages.js assets/css/main.css
git commit -m "feat: inbox ⋮ delete menu + dark-theme row polish"
```

### Task 4: Chat panel — date separators, grouping, bubble polish

**Files:**
- Modify: `assets/js/chat.js`
- Modify: `assets/css/main.css`

- [ ] **Step 1: Add day helpers + module state in `chat.js`.** Below the `timeShort` function (~line 19) add:

```js
function dayKey(iso) { return new Date(iso).toDateString(); }
function dayLabel(iso) {
  var d = new Date(iso), now = new Date();
  var t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var diff = Math.round((t - that) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
```

Change the module-state line (~line 10) from:
```js
var meId = null, unsub = null, seen = {}, lastOpener = null;
```
to:
```js
var meId = null, unsub = null, seen = {}, lastOpener = null, lastDay = null, lastSender = null;
```

- [ ] **Step 2: Group-aware `bubble` + day-aware `append`.** Replace the existing `bubble` and `append` functions with:

```js
function bubble(msg, cont) {
  var mine = msg.sender_id === meId;
  return '<div class="bub ' + (mine ? "bub--me" : "bub--them") + (cont ? " bub--cont" : "") + '">' +
    (mine || cont ? "" : '<span class="bub__who">' + esc(msg.sender_name) + "</span>") +
    '<span class="bub__body">' + esc(msg.body) + "</span>" +
    '<span class="bub__time">' + timeShort(msg.created_at) + "</span></div>";
}
function append(log, msg) {
  if (seen[msg.id]) return;
  seen[msg.id] = 1;
  var empty = log.querySelector(".chat__empty"); if (empty) empty.remove();
  var dk = dayKey(msg.created_at);
  if (dk !== lastDay) {
    log.insertAdjacentHTML("beforeend", '<div class="chat__day"><span>' + esc(dayLabel(msg.created_at)) + "</span></div>");
    lastDay = dk; lastSender = null; // a day break also breaks grouping
  }
  var cont = msg.sender_id === lastSender;
  log.insertAdjacentHTML("beforeend", bubble(msg, cont));
  lastSender = msg.sender_id;
  log.scrollTop = log.scrollHeight;
}
```

- [ ] **Step 3: Reset the grouping state on open.** In `openPanel`, change the reset line (~line 144) from:
```js
  meId = profile.id; seen = {};
```
to:
```js
  meId = profile.id; seen = {}; lastDay = null; lastSender = null;
```

(The historical render at `log.innerHTML = ""; msgs.forEach(append)` then rebuilds dividers/groups correctly because state was just reset; realtime `append` continues the same running state. The cross-talk teardown added at the top of `openPanel` is untouched.)

- [ ] **Step 4: CSS** in `assets/css/main.css` — replace the `.bub--them` / `.bub--me` block region by ADDING these after line 469 (`.bub--me .bub__time`):

```css
.bub--cont { margin-top: calc(var(--sp-2) * -0.55); } /* tighten grouped messages */
.bub--them { border-bottom-left-radius: 4px; }
.bub--me { border-bottom-right-radius: 4px; }
.chat__day {
  align-self: center; display: flex; align-items: center; gap: var(--sp-2);
  color: var(--muted); font-size: var(--fs-xs); font-weight: 700; margin: var(--sp-2) 0;
}
.chat__day span {
  background: var(--surface-2); border: 1px solid var(--border);
  padding: 2px 10px; border-radius: var(--r-pill);
}
```

And refresh the empty state — replace `.chat__empty { margin: auto; color: var(--muted); font-size: var(--fs-sm); }` (line 462) with:

```css
.chat__empty { margin: auto; color: var(--muted); font-size: var(--fs-sm); text-align: center; padding: var(--sp-6); }
```

- [ ] **Step 5: Verify** (controller-run with the E2E in Task 5; here just confirm no console errors and that opening a conversation still renders messages with a day divider). Critically re-confirm the cross-talk fix still holds (covered in Task 5).

- [ ] **Step 6: Commit**

```bash
git add assets/js/chat.js assets/css/main.css
git commit -m "feat: chat panel polish — date separators, message grouping, bubble/empty refresh"
```

### Task 5: Docs + full E2E + screenshots

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md.** In the write-protection paragraph (Backend/Supabase), after the `mark_conversation_read` sentence, add:
```markdown
  Soft per-side conversation delete is written only by `delete_conversation()`
  (sets the caller's `*_deleted_at` + `*_read_at`); the inbox hides a thread
  until a newer message arrives.
```
Also, in the scripts list, update the `chat.js`/`messages.js` bullet to mention "date separators, message grouping, and per-row delete (⋮)".

- [ ] **Step 2: Full logged-in E2E** (controller runs; DB live). Two isolated accounts O (owner) + U (buyer), plus drive the app UI signed in as U:
  - Create a listing by O; U opens a conversation and exchanges messages across — to test date dividers, optionally backdate is not possible, so just verify a "Today" divider and grouping (two consecutive U messages → second has no name label).
  - On `messages.html` as U: hover a row → ⋮ appears → click → popover with Delete; clicking ⋮ does NOT open the chat. Click Delete → confirm dialog → row disappears. Reload → still gone (U side). 
  - As O (second isolated client) confirm the conversation still exists for O (`myConversations` includes it).
  - O sends a new message → reload U's inbox → the thread reappears for U.
  - Delete U's only thread → empty state shows.
  - Unread→delete: create a fresh thread with an unread message for U, note nav badge ≥1, delete it → reload → badge drops.
  - Regression: open conversation A, then open a fresh listing chat (conv=null), push a message into A → it must NOT appear in the open panel (cross-talk fix holds).
  - Screenshot: inbox with ⋮ open, and the chat panel showing a date divider + grouped bubbles, at desktop and 390px.
  - Cleanup: delete O's listings (cascades). Note throwaway accounts remain.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note soft conversation delete + chat polish"
```

---

## Final verification

- [ ] Probe confirmed `delete_conversation` exists; E2E delete hides only the caller's side; reappears on new message; unread-then-delete drops the badge.
- [ ] ⋮ menu doesn't trigger row-open; confirm + optimistic remove + rollback on error; last-row → empty state.
- [ ] Chat shows date dividers + grouped consecutive messages; legible on dark at desktop + 390px.
- [ ] Cross-talk fix still holds.
- [ ] No console errors anywhere.

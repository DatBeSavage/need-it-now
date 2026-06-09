# Phase 1 — Real-time Chat + Anti-spam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-way `responses` mechanism with real-time, per-listing conversations between a listing's owner and an interested buyer, with database-enforced anti-spam.

**Architecture:** Two new Supabase tables (`conversations`, `messages`) with RLS scoped to the two participants; Postgres Changes for realtime; rate-limit triggers for anti-spam. Front-end gains a reusable `chat.js` panel used by the feed and a new Messages inbox. All data access stays in `api.js`.

**Tech Stack:** Static HTML/CSS/JS (ES modules), `@supabase/supabase-js@2` from esm.sh, Supabase Postgres + Auth + Realtime.

**Verification model:** No JS test runner in this project. Backend tasks are verified with live REST API calls (curl + real JWT, like the Phase-0 auth verification). UI tasks are verified in the live preview with two browser profiles (buyer + owner). The publishable key is `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`; base URL `https://yubhbztyprfupvjwxwmm.supabase.co`.

---

## File structure

- **Modify** `supabase/schema.sql` — drop `responses`; add `conversations`, `messages`, their RLS, triggers (interest count, touch, two rate guards), realtime publication.
- **Modify** `assets/js/api.js` — remove `addResponse`; add conversation/message API + realtime subscribe + `myConversations`.
- **Create** `assets/js/chat.js` — reusable real-time chat panel (lazy conversation creation).
- **Modify** `assets/js/feed.js` — "interested" button opens chat; remove respond-modal wiring.
- **Modify** `pages/feed.html` — remove respond-modal markup (chat panel self-mounts).
- **Create** `pages/messages.html` + **Create** `assets/js/messages.js` — inbox.
- **Modify** `assets/js/auth.js` — add a **Messages** link to the logged-in nav slot.
- **Modify** every page's static `<nav>` — add the Messages link (per CLAUDE.md sync rule): `index.html`, `pages/feed.html`, `pages/post.html`, `pages/login.html`, `pages/register.html`.
- **Modify** `assets/css/main.css` — chat panel + inbox styles (tokens only).

---

## Task 1: Database schema — tables, RLS, triggers, realtime

**Files:**
- Modify: `supabase/schema.sql` (replace the `responses` table block + its trigger near lines 31-38 and 104-122; append the new chat block before the `nearby_listings` section)

- [ ] **Step 1: Remove the responses table + its trigger from `schema.sql`**

Delete the `create table ... public.responses (...)` block, the `responses_listing_idx` index, the `responses` RLS lines, and the `bump_response_count` function + `trg_bump_response_count` trigger. (The `listings.response_count` column stays.)

- [ ] **Step 2: Add the chat schema block**

Insert this block (after the listings/profiles RLS section, before `nearby_listings`):

```sql
-- ============================================================
-- Chat: conversations + messages  (Phase 1)
-- ============================================================
drop trigger if exists trg_bump_response_count on public.responses;
drop function if exists public.bump_response_count();
drop table if exists public.responses;

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings (id) on delete cascade,
  buyer_id        uuid not null references public.profiles (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_body       text not null default '',
  dealt_at        timestamptz,
  unique (listing_id, buyer_id),
  check (buyer_id <> owner_id)
);
create index if not exists conversations_owner_idx   on public.conversations (owner_id);
create index if not exists conversations_buyer_idx   on public.conversations (buyer_id);
create index if not exists conversations_listing_idx on public.conversations (listing_id);
create index if not exists conversations_recent_idx  on public.conversations (last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  sender_name     text not null,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index if not exists messages_convo_idx on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

drop policy if exists "conversations_select_party" on public.conversations;
drop policy if exists "conversations_insert_buyer" on public.conversations;
drop policy if exists "conversations_update_party" on public.conversations;
create policy "conversations_select_party" on public.conversations for select
  using (auth.uid() = buyer_id or auth.uid() = owner_id);
create policy "conversations_insert_buyer" on public.conversations for insert
  with check (
    auth.uid() = buyer_id
    and buyer_id <> owner_id
    and owner_id = (select l.user_id from public.listings l where l.id = listing_id)
  );
create policy "conversations_update_party" on public.conversations for update
  using (auth.uid() = buyer_id or auth.uid() = owner_id)
  with check (auth.uid() = buyer_id or auth.uid() = owner_id);

drop policy if exists "messages_select_party" on public.messages;
drop policy if exists "messages_insert_party" on public.messages;
create policy "messages_select_party" on public.messages for select
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
  ));
create policy "messages_insert_party" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
    )
  );

-- Bump listings.response_count once per new conversation ("people interested").
create or replace function public.bump_interest_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.listings set response_count = response_count + 1 where id = new.listing_id;
  return new;
end; $$;
drop trigger if exists trg_bump_interest_count on public.conversations;
create trigger trg_bump_interest_count after insert on public.conversations
  for each row execute function public.bump_interest_count();

-- Keep last_message_at + last_body fresh for the inbox.
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at, last_body = new.body
   where id = new.conversation_id;
  return new;
end; $$;
drop trigger if exists trg_touch_conversation on public.messages;
create trigger trg_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- Anti-spam: max 5 messages / 10s per sender.
create or replace function public.guard_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent from public.messages
   where sender_id = new.sender_id and created_at > now() - interval '10 seconds';
  if recent >= 5 then raise exception 'Slow down — too many messages. Wait a few seconds.'; end if;
  return new;
end; $$;
drop trigger if exists trg_guard_message_rate on public.messages;
create trigger trg_guard_message_rate before insert on public.messages
  for each row execute function public.guard_message_rate();

-- Anti-spam: max 10 new conversations / hour per buyer.
create or replace function public.guard_conversation_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent from public.conversations
   where buyer_id = new.buyer_id and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'Too many new chats started — try again later.'; end if;
  return new;
end; $$;
drop trigger if exists trg_guard_conversation_rate on public.conversations;
create trigger trg_guard_conversation_rate before insert on public.conversations
  for each row execute function public.guard_conversation_rate();

-- Realtime (idempotent add to the publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then execute 'alter publication supabase_realtime add table public.messages'; end if;
end $$;
```

- [ ] **Step 3: User runs the updated `schema.sql` in the Supabase SQL Editor**

This is the manual checkpoint. Ask the user to paste the whole updated `supabase/schema.sql` into the SQL Editor and run it. Expected: "Success. No rows returned."

- [ ] **Step 4: Verify tables + RLS with live REST (failing-check first)**

Before the user runs the SQL, this returns an error (table missing). After, it should behave as below. Two real accounts are needed — reuse `neednow.verify917@gmail.com` (password `test123456`) as the **buyer**, and create a second account as the **owner** who posts a listing. Script:

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uid () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
# owner account
curl -s "$BASE/auth/v1/signup" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{"email":"neednow.owner01@gmail.com","password":"test123456","data":{"name":"Owner One","zip":"78701"}}' >/dev/null
OT=$(tok neednow.owner01@gmail.com); OID=$(uid "$OT")
BT=$(tok neednow.verify917@gmail.com); BID=$(uid "$BT")
# owner posts a listing
LID=$(curl -s "$BASE/rest/v1/listings" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"user_id\":\"$OID\",\"owner_name\":\"Owner One\",\"type\":\"sell\",\"title\":\"Chat test lamp\",\"description\":\"x\",\"price\":20,\"zip\":\"78701\",\"lat\":30.2711,\"lng\":-97.7437}" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
# buyer opens a conversation
CID=$(curl -s "$BASE/rest/v1/conversations" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"listing_id\":\"$LID\",\"buyer_id\":\"$BID\",\"owner_id\":\"$OID\"}" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
echo "conversation: $CID"
# buyer sends a message
curl -s -w " <- send HTTP %{http_code}\n" "$BASE/rest/v1/messages" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"conversation_id\":\"$CID\",\"sender_id\":\"$BID\",\"sender_name\":\"Verify User\",\"body\":\"Hi, is this available?\"}" -o /dev/null
# owner can read it
echo "owner reads:"; curl -s "$BASE/rest/v1/messages?conversation_id=eq.$CID&select=body" -H "apikey: $KEY" -H "Authorization: Bearer $OT"
```

Expected after SQL: `conversation: <uuid>`, `send HTTP 201`, owner reads `[{"body":"Hi, is this available?"}]`.

- [ ] **Step 5: Verify RLS isolation + forged-owner block + spam guard**

```bash
# third party cannot read the thread
XT=$(tok neednow.test001@gmail.com)   # an unrelated account; create if needed
echo "stranger reads (expect []):"; curl -s "$BASE/rest/v1/messages?conversation_id=eq.$CID&select=body" -H "apikey: $KEY" -H "Authorization: Bearer $XT"
# forged owner_id is rejected by RLS (expect 4xx / row violates policy)
curl -s -w " <- forge HTTP %{http_code}\n" "$BASE/rest/v1/conversations" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"listing_id\":\"$LID\",\"buyer_id\":\"$BID\",\"owner_id\":\"$BID\"}" -o /dev/null
# message rate limit: 6 rapid sends, 6th should fail
for i in 1 2 3 4 5 6; do curl -s -w "msg$i HTTP %{http_code}\n" "$BASE/rest/v1/messages" -H "apikey: $KEY" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" -d "{\"conversation_id\":\"$CID\",\"sender_id\":\"$BID\",\"sender_name\":\"Verify User\",\"body\":\"spam $i\"}" -o /dev/null; done
```

Expected: stranger reads `[]`; forge returns `403`; `msg1..msg5` → `201`, `msg6` → `400` (or `409`). If all pass, the schema is correct.

- [ ] **Step 6: Clean up test rows**

```bash
curl -s -X DELETE "$BASE/rest/v1/listings?id=eq.$LID" -H "apikey: $KEY" -H "Authorization: Bearer $OT" -o /dev/null -w "cleanup HTTP %{http_code}\n"
```

(Cascade removes the conversation + messages.) Do NOT commit yet — schema is committed together with the front end at the end of Phase 1.

---

## Task 2: Data API — conversations, messages, realtime

**Files:**
- Modify: `assets/js/api.js` (remove `addResponse` at lines 72-83; append the new section)

- [ ] **Step 1: Remove `addResponse`**

Delete the `/* ---------------- Responses ---------------- */` block and the `addResponse` function.

- [ ] **Step 2: Append the conversations/messages API**

```js
/* ---------------- Conversations & messages ---------------- */
export async function getOrCreateConversation(listing) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in to start a chat.");
  if (!listing.user_id) throw new Error("This is a sample listing — post your own to start chatting.");
  if (listing.user_id === profile.id) throw new Error("This is your listing — check Messages for replies.");

  const { data: found, error: e1 } = await supabase
    .from("conversations").select("*")
    .eq("listing_id", listing.id).eq("buyer_id", profile.id).maybeSingle();
  if (e1) throw e1;
  if (found) return found;

  const { data, error } = await supabase.from("conversations").insert({
    listing_id: listing.id, buyer_id: profile.id, owner_id: listing.user_id,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from("messages").select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendMessage(conversationId, body) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  const text = String(body || "").trim();
  if (!text) return null;
  const { data, error } = await supabase.from("messages").insert({
    conversation_id: conversationId, sender_id: profile.id,
    sender_name: profile.name, body: text,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export function subscribeMessages(conversationId, onInsert) {
  const channel = supabase
    .channel("messages:" + conversationId)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages",
        filter: "conversation_id=eq." + conversationId },
      function (payload) { onInsert(payload.new); })
    .subscribe();
  return function () { supabase.removeChannel(channel); };
}

export async function myConversations() {
  const profile = await getProfile();
  if (!profile) return [];
  const { data, error } = await supabase
    .from("conversations")
    .select("*, listing:listings(id,title,emoji,type,price), " +
            "buyer:profiles!conversations_buyer_id_fkey(name), " +
            "owner:profiles!conversations_owner_id_fkey(name)")
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(function (c) {
    return Object.assign({}, c, { iAmOwner: c.owner_id === profile.id, me: profile });
  });
}
```

- [ ] **Step 3: Verify the module parses + the FK-embed query works**

In the preview DevTools console on any page, run:

```js
const m = await import("../assets/js/api.js");
console.log(await m.myConversations());
```

Expected: an array (likely `[]` when logged out, or your threads when logged in) and **no PostgREST embed error** about ambiguous relationships. If it errors on the `profiles!...fkey` hint, the FK constraint names differ from the assumed defaults (`conversations_buyer_id_fkey` / `conversations_owner_id_fkey`); look them up in the Supabase dashboard (Database → conversations → Foreign keys) and update the embed hints to match.

---

## Task 3: Reusable chat panel — `chat.js`

**Files:**
- Create: `assets/js/chat.js`

- [ ] **Step 1: Create `chat.js`** (lazy conversation creation — no empty threads on open)

```js
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
```

- [ ] **Step 2: Verify it imports cleanly**

In the preview console: `await import("../assets/js/chat.js")` → resolves without error (no missing-export errors from `auth.js`/`api.js`). Full behavior is verified in Task 4.

---

## Task 4: Wire the feed to chat

**Files:**
- Modify: `assets/js/feed.js` (replace `openRespond` + the respond-modal wiring with chat)
- Modify: `pages/feed.html` (remove the `#respond-modal` markup)

- [ ] **Step 1: Import chat + replace `openRespond`**

In `feed.js`, change the import line to add chat:

```js
import { openChatForListing } from "./chat.js";
```

Replace the entire `openRespond(id)` function with:

```js
function openRespond(id) {
  var row = lastRows.filter(function (r) { return r.id === id; })[0];
  if (!row) return;
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  openChatForListing(row);
}
```

- [ ] **Step 2: Remove the old respond-modal wiring**

In `wireControls()`, delete the block that wires `#respond-modal` (the `var back = document.getElementById("respond-modal");` lines and its close handlers). The chat panel self-mounts and self-closes.

- [ ] **Step 3: Remove `#respond-modal` markup from `feed.html`**

Delete the respond modal `<div id="respond-modal" ...>...</div>` element from `pages/feed.html`. (Verify by searching the file for `respond-modal`.)

- [ ] **Step 4: Verify in the preview (two profiles)**

In the preview: log in as the **buyer** (`neednow.verify917@gmail.com`). Find the owner's "Chat test lamp" listing (post one from a second browser profile logged in as `neednow.owner01@gmail.com` if needed), click **I'm interested**. Expected: chat panel opens, "Say hello". Type a message, Send → bubble appears on the right. In the owner's browser, open the same thread (Task 5 inbox, or temporarily the same listing) → message appears live without refresh. Reply → buyer sees it live.

---

## Task 5: Messages inbox

**Files:**
- Create: `pages/messages.html`
- Create: `assets/js/messages.js`

- [ ] **Step 1: Create `pages/messages.html`** (copy the nav from `feed.html`; mark Messages active)

Match `feed.html` exactly (fonts, `.nav__inner`/`.brand`, `.wrap`/`.feed-head`); only the title, the active nav link, and the main content differ:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Messages — Need-It-Now</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
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
        <a href="post.html">Post</a>
        <a href="messages.html" class="active">Messages</a>
      </div>
      <div class="nav__user" data-nav-user></div>
    </div>
  </nav>

  <main class="wrap">
    <div class="feed-head">
      <h1>Messages</h1>
      <p>Your conversations about local listings.</p>
    </div>
    <div id="threads" class="threads" style="margin-bottom:var(--sp-7)"></div>
  </main>

  <script type="module" src="../assets/js/auth.js"></script>
  <script type="module" src="../assets/js/messages.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `assets/js/messages.js`**

```js
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
```

- [ ] **Step 3: Verify the inbox**

Log in as the **owner** → go to **Messages**. Expected: the buyer's thread appears with the buyer's name, listing title, and last-message snippet. Click it → chat opens with history → reply → buyer's open feed thread updates live.

---

## Task 6: Navigation — add Messages everywhere

**Files:**
- Modify: `assets/js/auth.js` (`renderNavUser`, logged-in branch, ~lines 38-45)
- Modify static nav in: `index.html`, `pages/feed.html`, `pages/post.html`, `pages/login.html`, `pages/register.html`

- [ ] **Step 1: Add a Messages link to the logged-in nav slot in `auth.js`**

In `renderNavUser`, the logged-in `slot.innerHTML` — add a Messages link before the "+ Post" button:

```js
    slot.innerHTML =
      '<a href="' + base() + 'pages/messages.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--ink-2);text-decoration:none;padding:.5rem .8rem">Messages</a>' +
      '<a class="btn btn--money btn--sm" href="' + base() + 'pages/post.html">+ Post</a>' +
      '<span class="nav__avatar" title="' + profile.name + '">' + initials(profile.name) + "</span>" +
      '<a href="#" data-logout style="font-weight:700;font-size:var(--fs-sm);color:var(--muted);text-decoration:none">Log out</a>';
```

- [ ] **Step 2: Add the static Messages link to each page's `<nav>`**

In the `<div class="nav__links">` of each page, add a Messages link next to Browse/Post, matching that page's path depth:
- `pages/feed.html`, `pages/post.html`, `pages/login.html`, `pages/register.html`: `<a href="messages.html">Messages</a>`
- `index.html`: `<a href="pages/messages.html">Messages</a>`

(Match the exact existing nav markup of each page; only add the one link. `messages.html` itself already marks it `active` from Task 5.)

- [ ] **Step 3: Verify nav sync**

Search the repo: every page contains a link to `messages.html`. In the preview, logged in, the **Messages** link shows on every page and routes correctly from both the root and `pages/`.

---

## Task 7: Chat + inbox styles

**Files:**
- Modify: `assets/css/main.css` (append a chat/inbox section)

- [ ] **Step 1: Append styles (tokens only)**

`.modal-back` already exists in `main.css` (backdrop + `display: grid; place-items: center` on `.open`) — **reuse it, do not redefine it.** The `.chat` card is centered by the existing rule. Append only:

```css
/* ---- Chat panel (reuses existing .modal-back) ---- */
.chat { width: 100%; max-width: 460px; height: min(78vh, 620px);
  display: flex; flex-direction: column; overflow: hidden; }
.chat__head { display: flex; align-items: center; justify-content: space-between;
  gap: var(--sp-3); padding: var(--sp-4); border-bottom: 1px solid var(--border); }
.chat__who { display: block; font-size: var(--fs-md); }
.chat__sub { display: block; font-size: var(--fs-sm); }
.chat__close { background: none; border: 0; font-size: 1.1rem; cursor: pointer;
  color: var(--muted); line-height: 1; padding: .25rem; }
.chat__log { flex: 1; overflow-y: auto; padding: var(--sp-4);
  display: flex; flex-direction: column; gap: var(--sp-2); background: var(--bg); }
.chat__empty { margin: auto; color: var(--muted); font-size: var(--fs-sm); }
.bub { max-width: 78%; padding: .5rem .75rem; border-radius: var(--r-md);
  display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-sm); }
.bub__who { font-size: var(--fs-xs); font-weight: 700; color: var(--muted); }
.bub__time { font-size: var(--fs-xs); color: var(--muted); align-self: flex-end; }
.bub--them { align-self: flex-start; background: var(--surface); border: 1px solid var(--border); }
.bub--me { align-self: flex-end; background: var(--blue-600); color: #fff; }
.bub--me .bub__time { color: rgba(255,255,255,.8); }
.chat__form { display: flex; gap: var(--sp-2); padding: var(--sp-3);
  border-top: 1px solid var(--border); background: var(--surface); }
.chat__input { flex: 1; padding: .6rem .8rem; border: 1px solid var(--border);
  border-radius: var(--r-md); font: inherit; }
.chat__input:focus { outline: 2px solid var(--blue-600); outline-offset: 1px; }

/* ---- Inbox ---- */
.threads { display: flex; flex-direction: column; gap: var(--sp-2); max-width: 640px; }
.thread { display: flex; gap: var(--sp-3); align-items: flex-start; text-align: left;
  width: 100%; padding: var(--sp-3); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--r-md); cursor: pointer; }
.thread:hover { border-color: var(--blue-600); }
.thread__emoji { font-size: 1.5rem; line-height: 1; }
.thread__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.thread__top { display: flex; justify-content: space-between; gap: var(--sp-2); }
.thread__time { font-size: var(--fs-xs); white-space: nowrap; }
.thread__listing { font-size: var(--fs-xs); }
.thread__snippet { font-size: var(--fs-sm); color: var(--ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 2: Verify visual + responsive**

In the preview, open a chat: bubbles sit mine-right / theirs-left, the log scrolls, the input bar pins to the bottom, and the panel fits on a narrow (375px) viewport. The inbox rows align and truncate the snippet. Confirm focus outline on the input and that the close ✕ and backdrop both dismiss.

- [ ] **Step 3: Commit Phase 1**

After all live checks pass and on a feature branch (we're on `main`):

```bash
git checkout -b feat/chat-phase1
git add supabase/schema.sql assets/js/api.js assets/js/chat.js assets/js/feed.js \
        assets/js/messages.js assets/js/auth.js assets/css/main.css \
        pages/feed.html pages/messages.html pages/post.html pages/login.html \
        pages/register.html index.html
git commit -m "feat: real-time per-listing chat with DB-enforced anti-spam"
```

(Only when the user asks to commit. The uncommitted Phase-0 Supabase migration is included in this commit unless the user wants it split first.)

---

## Notes for the implementer
- `auth.js` exports `base`, `go`, `toast`, `requireAuth` — `chat.js` and `messages.js` rely on these; don't rename them.
- Realtime echoes the sender's own INSERT, so sent messages render via the subscription; `seen{}` dedupes. No optimistic append needed.
- Conversations are created lazily on first message, so opening and closing a chat without sending creates nothing and doesn't bump the interest count.
- Demo seed listings have `user_id = null`; `getOrCreateConversation` rejects them with a friendly message and the DB RLS blocks them regardless.

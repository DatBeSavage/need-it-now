# Need-It-Now — Chat + Trust & Safety design

Status: approved 2026-06-08. Built in three additive phases on the existing
Supabase project. Each phase re-runs the updated `supabase/schema.sql` (idempotent)
in the SQL Editor and is independently shippable and testable.

## Goal

Replace the current one-way `responses` mechanism with real-time, per-listing
**conversations** between a listing's owner and an interested buyer, then layer on
the trust & safety features a marketplace needs: anti-spam, user reporting, and an
eBay-style star reputation system.

## Confirmed product decisions

1. **Scope = per listing.** A conversation is about one specific item, between the
   listing's owner and one interested buyer. `unique(listing_id, buyer_id)`.
2. **Real-time**, via Supabase Postgres Changes (respects RLS).
3. **Buyer-initiated.** Owners never click "interested" on their own listing; they
   read and reply from a Messages inbox.
4. **Demo seed listings are non-chattable** (they have `user_id = null`, no real
   owner). Clicking interested on one shows a "sample listing — post your own to
   start chatting" note. Real user-posted listings are fully chattable.
5. **Ratings anchor to a "dealt" conversation.** Either participant marks a thread
   "dealt", which unlocks a one-time rating from *both* sides. No orders system.
6. **Anti-spam is enforced in the database** (triggers), not just the client.

---

## Phase 1 — Real-time chat + anti-spam

### Tables

`conversations` — one per (listing + interested buyer)

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| listing_id | uuid not null → listings(id) on delete cascade | |
| buyer_id | uuid not null → profiles(id) on delete cascade | the interested user |
| owner_id | uuid not null → profiles(id) on delete cascade | listing owner, denormalized for RLS |
| created_at | timestamptz not null default now() | |
| last_message_at | timestamptz not null default now() | sorts the inbox |
| dealt_at | timestamptz | null until marked dealt (Phase 3) |

Constraints: `unique(listing_id, buyer_id)`, `check (buyer_id <> owner_id)`.
Indexes: `(owner_id)`, `(buyer_id)`, `(listing_id)`, `(last_message_at desc)`.

`messages`

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| conversation_id | uuid not null → conversations(id) on delete cascade | |
| sender_id | uuid not null → profiles(id) on delete cascade | |
| sender_name | text not null | denormalized for display |
| body | text not null check (char_length(body) between 1 and 2000) | |
| created_at | timestamptz not null default now() | |

Index: `(conversation_id, created_at)`.

### Removed
- Drop the `responses` table and its `bump_response_count` trigger/function.
- `listings.response_count` is **kept** but repurposed to "people interested",
  bumped once per *new conversation* (see triggers).

### RLS

- **conversations**
  - select: `auth.uid() = buyer_id OR auth.uid() = owner_id`
  - insert: `with check` — all of:
    `auth.uid() = buyer_id`,
    `buyer_id <> owner_id`,
    `owner_id = (select l.user_id from public.listings l where l.id = listing_id)`.
    The last clause stops a buyer forging a thread against an arbitrary user, and
    since demo listings have `user_id = null` (and `owner_id` is NOT NULL), it also
    enforces "demo listings are non-chattable" at the database level.
  - update (for `dealt_at` / `last_message_at`): participant only, `using` +
    `with check` both = participant. (Triggers update `last_message_at` via a
    SECURITY DEFINER function so it isn't subject to the buyer/owner check.)
- **messages**
  - select: sender or owner of the parent conversation — implemented as
    `exists (select 1 from conversations c where c.id = conversation_id and (c.buyer_id = auth.uid() or c.owner_id = auth.uid()))`
  - insert: `with check (sender_id = auth.uid() AND exists(... participant ...))`

### Real-time
- `alter publication supabase_realtime add table public.messages;`
- Client subscribes to a channel filtered by `conversation_id=eq.<id>`; on INSERT,
  append the new message. Postgres Changes honors the messages SELECT policy, so a
  user only receives messages for conversations they belong to.

### Anti-spam (DB triggers, tunable constants)
- **Message rate:** before insert on `messages`, count this sender's messages in
  the last 10 seconds; if ≥ 5, `raise exception 'Slow down — too many messages.'`
- **Conversation rate:** before insert on `conversations`, count this buyer's
  conversations created in the last hour; if ≥ 10, raise.
- Constants live at the top of the function bodies for easy tuning.

### Triggers
- `bump_interest_count` — after insert on `conversations`: `response_count + 1` on
  the listing.
- `touch_conversation` — after insert on `messages`: set parent
  `last_message_at = now()`. SECURITY DEFINER, `search_path = public`.

### API (`api.js`)
- `getOrCreateConversation(listingId)` — resolves the current user as buyer, looks
  up `(listing_id, buyer_id)`, creates if absent (filling `owner_id` from the
  listing). Throws a friendly error if the listing has no real owner (demo) or if
  the user is the owner.
- `getMessages(conversationId)` — ordered ascending.
- `sendMessage(conversationId, body)` — insert; sender fields from profile.
- `subscribeMessages(conversationId, onInsert)` — returns an unsubscribe function.
- `myConversations()` — conversations where I'm buyer or owner, newest activity
  first, joined to listing title/emoji and the other party's name.
- Remove `addResponse`.

### Front-end
- **`chat.js`** (new) — reusable chat panel: render thread, wire input + send,
  open/teardown the realtime subscription, optimistic append. Exposes
  `openChatForListing(listing)` and `openChatForConversation(conv)`.
- **`feed.js`** — "I'm interested" / "I have one" calls into `chat.js` (logged-out →
  login; own listing → toast/redirect to inbox; demo listing → "sample listing"
  note). Old respond-modal markup replaced by the chat panel container.
- **`pages/messages.html` + `messages.js`** (new) — inbox: list of conversations
  (other party, listing title, last-message snippet, time); clicking opens the
  thread. Guarded by `requireAuth()`.
- **Nav** — add a **Messages** link for logged-in users, rendered by `auth.js` in
  the nav user slot, on every page. Update the static nav per CLAUDE.md sync rule.
- **CSS** (`main.css`) — chat panel (bubbles mine/theirs, input bar), inbox list;
  all from existing tokens.

---

## Phase 2 — Reporting

### Table
`reports`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| reporter_id | uuid not null → profiles(id) | |
| reported_user_id | uuid not null → profiles(id) | |
| reason | text not null check (reason in ('spam','harassment','scam','other')) | |
| details | text not null default '' | |
| message_id | uuid → messages(id) on delete set null | optional context |
| listing_id | uuid → listings(id) on delete set null | optional context |
| conversation_id | uuid → conversations(id) on delete set null | optional context |
| created_at | timestamptz not null default now() | |

### RLS
- insert: `with check (reporter_id = auth.uid() AND reporter_id <> reported_user_id)`
- select: own reports only (`reporter_id = auth.uid()`). Moderation review is done
  in the Supabase dashboard for the prototype.

### Optional auto-hide (wired, disabled by default)
- Add `listings.hidden boolean not null default false`.
- A trigger can set `hidden = true` once a listing/user reaches ≥ N distinct
  reporters. Ships disabled (threshold effectively off) until requested. When
  enabled, `nearby_listings` filters `where not hidden`.

### UI
- "Report" action in the chat header (reports the other participant, carries
  `conversation_id`) and on listing cards (reports the listing + its owner).
- Small modal: reason (select) + details (textarea). Goes through a new
  `createReport(...)` in `api.js`.

---

## Phase 3 — Reputation (eBay-style stars)

### Unlock
- "Mark as dealt" action on a conversation (either participant) sets
  `conversations.dealt_at = now()` via `markDealt(conversationId)`.
- Once dealt, each participant may leave exactly one rating of the other.

### Table
`ratings`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| conversation_id | uuid not null → conversations(id) on delete cascade | |
| rater_id | uuid not null → profiles(id) on delete cascade | |
| ratee_id | uuid not null → profiles(id) on delete cascade | |
| stars | int not null check (stars between 1 and 5) | |
| comment | text not null default '' | |
| created_at | timestamptz not null default now() | |

Constraint: `unique(conversation_id, rater_id)`.

### RLS
- insert: `with check` — rater is a participant of the conversation, the
  conversation is dealt (`dealt_at is not null`), `rater_id = auth.uid()`, and
  `ratee_id` is the *other* participant.
- select: public (`using (true)`). Feedback is public, like eBay.

### Aggregate
- Add `profiles.rating_avg numeric(3,2) not null default 0` and
  `profiles.rating_count int not null default 0`.
- Trigger `recompute_rating` after insert/update/delete on `ratings`: recompute
  avg + count for the affected `ratee_id`.

### Display
- A `★★★★☆ 4.8 (12)` star component shown on the profile, the chat header, and
  **listing cards**.
- `nearby_listings` gains two output columns `owner_rating` and
  `owner_rating_count` by left-joining `profiles` on `listings.user_id`.

---

## Per-phase manual step

Each phase, the user re-runs the updated `supabase/schema.sql` once in the Supabase
SQL Editor (it is idempotent: `create ... if not exists`, `drop policy if exists`,
`create or replace function`). Realtime enablement for `messages` is part of the
Phase 1 SQL. After each phase, verify end-to-end against the live API before commit.

## Testing approach

- **Phase 1:** two browser profiles (buyer + owner). Buyer opens a real listing →
  sends a message → owner sees it live in the inbox → replies → buyer sees it live.
  Verify anti-spam by sending 6 messages fast (6th is rejected). Verify RLS: a
  third account cannot read the thread (checked via REST with its token).
- **Phase 2:** file a report from a thread; confirm it lands in `reports` and that
  another user cannot read it.
- **Phase 3:** mark a thread dealt; both sides rate; confirm aggregate updates on
  the profile and the stars render on the listing card; confirm you cannot rate
  before "dealt" or rate twice.

# Design: Messaging revamp + delete

**Date:** 2026-06-12
**Status:** Approved (user picked: soft per-side delete; polish inbox + chat
panel; per-row ⋮ menu). The chat cross-talk bug was fixed separately
(commit fd02c48).

## Problem

Users can't remove conversations from their inbox, and the Messages inbox +
chat panel were styled for the old light theme. Add a safe delete and polish
both surfaces for the "Frosted Glass Deep" dark theme.

## A. Soft per-side conversation delete

### Schema (`supabase/schema.sql`, idempotent; mirrors the read markers)

```sql
alter table public.conversations add column if not exists buyer_deleted_at timestamptz;
alter table public.conversations add column if not exists owner_deleted_at timestamptz;
```

RPC `delete_conversation(conv_id uuid)` — `security definer set search_path =
public`, like `mark_conversation_read`: verifies the caller is the buyer or
owner, then sets **only the caller's** side:
- buyer caller → `buyer_deleted_at = now()`, `buyer_read_at = now()`.
- owner caller → `owner_deleted_at = now()`, `owner_read_at = now()`.

(Setting the read marker too means a dismissed thread also stops counting
toward `my_unread_count`.) `revoke ... from public, anon; grant execute to
authenticated;`. No client UPDATE grant on the new columns (locked-columns
model preserved).

### Visibility rule

A conversation is hidden for me only while my `*_deleted_at` is set AND no
newer message has arrived. Show test (client-side, where the inbox already
computes unread): `myDeletedAt == null || new Date(last_message_at) > new
Date(myDeletedAt)`. `touch_conversation` bumps `last_message_at` on every new
message, so a reply naturally un-hides the thread on the next inbox load. The
other party's copy is untouched.

### API (`assets/js/api.js`)

- `deleteConversation(id)` → `supabase.rpc("delete_conversation", { conv_id: id })`; throws on error.
- `myConversations()` — after the existing map, filter out rows where I've
  deleted and nothing is newer: compute `myDeletedAt = iAmOwner ?
  owner_deleted_at : buyer_deleted_at` and keep when null or `last_message_at >
  myDeletedAt`. (`select *` already returns the new columns.)

## B. Inbox polish + delete UX (`messages.js`, `messages.html`, `main.css`)

- **Per-row ⋮ overflow menu**, top-right of each `.thread`: a frosted icon
  button; click toggles a small popover containing **Delete**. Hover-reveal on
  desktop (always visible on mobile via a coarse-pointer media query). The
  menu button and popover sit above the row's click target (the row opens the
  chat); clicking ⋮ must not open the chat (stop propagation).
- **Delete flow:** ⋮ → Delete → `confirmDialog({ title: "Delete this
  conversation?", body: "It'll come back if they message you again.",
  confirmLabel: "Delete", danger: true })` → `deleteConversation(id)` →
  optimistically remove the row (and show the empty state if it was the last);
  on error, re-render + error toast. If the open chat panel is that
  conversation, close it first (chat.js exposes a close path; simplest:
  call a small exported `closeChat()` or check/remove `#chat-modal.open`).
- **Row layout refinement (dark theme):** keep avatar + unread bold/dot; add a
  clearer frosted hover and a subtle accent edge on unread rows. Line
  hierarchy: **name** · time (top), muted **listing context** "Re: ⟨emoji⟩
  Title" (sub-line), snippet (bottom). `myConversations` already returns
  `listing.{title,emoji,type,price}`.
- Restyle the existing empty state to match; no structural change.

## C. Chat panel polish (`chat.js`, `main.css`)

Pure render-time changes over the already-sorted messages — no data change:
- **Date separators:** a centered divider ("Today" / "Yesterday" /
  locale date) inserted when the calendar day changes between consecutive
  messages. Applied in both the historical render (`getMessages` loop) and on
  realtime `append` (track the last-rendered day).
- **Consecutive grouping:** when a message has the same `sender_id` as the
  previous rendered one AND is within the same day, drop the `bub__who` name
  label and tighten the top margin (a `bub--cont` modifier). First-of-group
  from the other party keeps the name.
- **Bubble + empty-state refresh:** softer corners, a tail on the first bubble
  of a group, stronger `bub--them` contrast on the frosted theme, a friendlier
  empty state block.
- Header keeps its existing "Re: …" context, restyled. Delete is NOT added
  here (it lives on the inbox row per the chosen UX).

Implementation note: `append(log, msg)` currently dedupes via `seen`. The
grouping/date logic needs the previously-rendered message's sender + day;
track them in module state reset on open (alongside `seen`), and compute from
the last `.bub` when appending. Keep it simple and render-only.

## Data flow & edge cases

- Delete optimistic with rollback (re-render) on RPC failure.
- Deleting an unread thread clears its unread (RPC sets read) → badge drops on
  next reconcile.
- Inbox is static (no realtime there); a reappearing thread shows on reload —
  consistent with today.
- Grouping/date logic must not break the cross-talk fix: it's render-only and
  doesn't touch subscription lifecycle.

## USER ACTION (mid-build)

Run the new schema section (delivered as a copyable section-only SQL tile —
the approach that applied cleanly last time). Verified by probing
`delete_conversation` from the preview before relying on it.

## Files

`supabase/schema.sql`, `assets/js/api.js`, `assets/js/messages.js`,
`assets/js/chat.js`, `assets/css/main.css`. No new pages/modules. CLAUDE.md
gets one line noting soft-delete markers + `delete_conversation`.

## Testing (manual via preview)

- Two-account E2E: A deletes a thread → gone for A, still present for B; B
  replies → reappears for A on reload; deleting an unread thread drops A's
  nav badge.
- Delete UX: ⋮ opens popover, clicking ⋮ doesn't open the chat, confirm
  dialog, optimistic removal, rollback on simulated failure, last-row → empty
  state, deleting the currently-open thread closes the panel.
- Chat polish: date dividers across a day boundary; consecutive grouping;
  bubbles/empty state legible on dark at desktop + 390px.
- No console errors; cross-talk fix still holds (open A, open a fresh listing
  chat, push into A → does not appear).

## Out of scope

Per-message delete, hard delete, two-pane desktop redesign, realtime inbox
refresh.

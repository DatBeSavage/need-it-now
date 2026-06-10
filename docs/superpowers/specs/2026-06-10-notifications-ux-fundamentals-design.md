# Design: Notifications & UX Fundamentals

**Date:** 2026-06-10
**Status:** Approved (brainstorm with user; in-app-only notifications, conversation read-markers chosen over per-message receipts and localStorage)

## Problem

The marketplace has no way to tell a user that someone messaged them — the core
loop (post → respond → deal) silently stalls unless users poll the Messages
page. Supporting UX is also thin: the toast is a single overwriting pill that
screen readers can't hear, destructive actions use native `window.confirm`,
there is no password-reset flow (forgotten password = permanent lockout), and
the feed lacks loading skeletons, URL-persisted filters, and a few cheap
performance wins.

## Scope

Five independently shippable phases, in dependency order:

1. UX primitives (toast v2 + confirm dialog)
2. Unread message notifications (in-app only)
3. Password reset
4. UI polish batch
5. Performance batch

Out of scope: browser/OS push notifications, per-message read receipts
("Seen at…"), email notifications, cross-tab badge sync, feed pagination.

---

## Phase 1 — UX primitives

New module `assets/js/ui.js` exporting `toast()` and `confirmDialog()`.

### Toast v2

- Signature: `toast(msg, opts?)` with
  `opts = { type: "info"|"success"|"error", duration?, actionLabel?, onAction? }`.
- Backward compatible: `toast("string")` behaves as `type:"info"`. The
  function moves from `auth.js` to `ui.js`; `auth.js` re-exports it so the
  existing `import { toast } from "./auth.js"` sites keep working unchanged.
- Rendering: a single fixed `.toasts` container (bottom-center, stacks newest
  on top, max 3 visible — older ones drop off), with
  `role="status" aria-live="polite"` on the container.
- Each toast: variant icon (✓ success / ⚠ error / none info), message text,
  optional action button (e.g. **View**), dismiss ×.
- Durations: info/success 2400 ms, error 5500 ms; dismiss × always available.
- CSS in `main.css`: keep the current `.toast` pill look as the base; add
  `.toasts` container, `.toast--success` / `.toast--error` variants, and keep
  the bottom-nav offset rule (currently `main.css:522`) targeting the
  container. Respect `prefers-reduced-motion`.

### Confirm dialog

- Signature: `confirmDialog({ title, body, confirmLabel = "OK",
  cancelLabel = "Cancel", danger = false }) → Promise<boolean>`.
- Reuses existing `.modal-back` / `.modal` CSS. `danger:true` renders the
  confirm button with a new `.btn--danger` style (red, from a new token or
  hard value consistent with `tokens.css`).
- Behavior: Esc and backdrop-click resolve `false`; initial focus on the
  Cancel button; Tab cycles within the dialog; focus returns to the trigger
  element on close.
- Replace the three `window.confirm` call sites: `feed.js` (listing delete),
  `admin.js` (permanent listing delete), `admin.js` (category delete).

---

## Phase 2 — Unread message notifications

### Schema (`supabase/schema.sql`, idempotent)

- `alter table public.conversations add column if not exists buyer_read_at timestamptz;`
  and `owner_read_at timestamptz` — mirrors the existing
  `dealt_buyer_at` / `dealt_owner_at` pattern.
- These columns get **no** client UPDATE grant (locked-columns model).
- RPC `mark_conversation_read(conv_id uuid)` — `security definer`; verifies
  `auth.uid()` is the conversation's buyer or owner, then sets **only the
  caller's side** to `now()` (same shape as `mark_dealt()`).
- Function `my_unread_count() returns int` — counts conversations where the
  caller is a participant and a message from the **other** party is newer than
  the caller's read marker (null marker = epoch). `grant execute to authenticated`.
- No publication change needed: `messages` is already in `supabase_realtime`
  (schema.sql "Realtime" block).

### API (`assets/js/api.js`)

- `markConversationRead(conversationId)` — calls the RPC.
- `myUnreadCount()` — calls the function; returns 0 when logged out/error.
- `subscribeMyMessages(onInsert)` — like `subscribeMessages` but with no
  `conversation_id` filter; participant-scoped RLS on `messages` means
  realtime only delivers rows from the caller's conversations. Returns an
  unsubscribe function.

### Nav badge + title (`assets/js/auth.js`)

- The "Messages" nav link gains an unread-count pill (`.nav__badge`), hidden
  when count is 0.
- Count is part of the nav-cache state: painted instantly from cache, then
  reconciled (existing `readNavCache`/`writeNavCache` pattern) by fetching
  `myUnreadCount()` during the nav reconcile. (Phase 5 later parallelizes
  this fetch with the profile/admin lookups; Phase 2 alone may fetch it
  sequentially.)
- `document.title` is prefixed with `"(n) "` while n > 0.

### Global listener (new `assets/js/notify.js`)

- Wired from `auth.js` on every page after the nav reconcile confirms a
  logged-in user.
- On an inserted message where `sender_id !== me`:
  - If the chat panel for that conversation is currently open (chat.js exposes
    the open conversation id), skip the toast and call
    `markConversationRead` — the panel's own subscription renders the bubble.
  - Otherwise: `toast("New message from <name>", { actionLabel: "View" })` —
    the action opens the conversation (chat panel where available, else
    navigate to `pages/messages.html`); increment the badge count and title
    prefix. Sender names resolved via `getProfileById` with a small in-memory
    cache.

### Read marking (`assets/js/chat.js`, `assets/js/messages.js`)

- `chat.js`: opening a panel calls `markConversationRead`; an incoming message
  while the panel is open marks read again.
- `messages.js`: conversations with unread messages render bold with an
  unread dot (compare `last_message_at` vs the caller's read marker, both
  already/now present on the `myConversations()` rows via `select *`).

### Edge cases

- Logged out: no subscription, no badge.
- Multi-tab: each tab receives events; badges reconcile on next page load
  (no cross-tab sync — accepted).
- Realtime failure/disconnect: silent degrade; on-load `my_unread_count()`
  keeps badges correct.

---

## Phase 3 — Password reset

- `login.html`: "Forgot password?" link under the password field →
  `pages/reset.html`.
- New `pages/reset.html` (standard page chrome; **not** added to the nav, like
  login/register it lives in the auth flow):
  - Default state: email form → `requestPasswordReset(email)` → confirmation
    copy ("If that email has an account, a reset link is on its way").
  - Recovery state (arrived via the email link, Supabase recovery session
    present): new-password form (min 6 chars, matching confirm field) →
    `updatePassword(pass)` → success toast → redirect to feed.
- `api.js`: `requestPasswordReset(email)` wraps
  `supabase.auth.resetPasswordForEmail(email, { redirectTo })` with
  `redirectTo` computed at runtime from `location` (works on local preview and
  GitHub Pages); `updatePassword(newPass)` wraps
  `supabase.auth.updateUser({ password })`.
- Recovery detection: listen for the `PASSWORD_RECOVERY` auth event / check
  the URL hash on `reset.html`.

---

## Phase 4 — UI polish batch

- **Skeleton loaders**: `.skeleton` shimmer styles + a placeholder card
  matching the `.listing` layout; feed first load shows 6 of them instead of
  the ⏳ empty-state. Reduced-motion: no shimmer animation.
- **Filters in URL**: on feed load, initialize `state` (zip/radius/type/q)
  from query params; on change, mirror into the URL with
  `history.replaceState` (debounced with the existing render debounce).
  Refresh-safe, shareable, back-button-friendly.
- **Optimistic delete**: remove the listing card from the DOM immediately
  after confirm; on API error, error-toast and re-render.
- **Shared modal behavior**: one helper (in `ui.js`) providing Esc-to-close,
  light focus trap, and focus-return; applied to the chat panel, report
  dialog, and confirm dialog.
- **Image CLS**: reserve listing-photo space (`aspect-ratio` on the media
  box/img) so cards don't shift as covers load.

---

## Phase 5 — Performance batch

- Nav reconcile: `getProfile()`, then `amIAdmin()` + `myUnreadCount()` in
  parallel (`Promise.all`) instead of sequential awaits.
- Feed sessionStorage cache: cache the last rows keyed by filter state; on
  load with a matching key, paint instantly, then refresh from the network
  (nav-cache pattern).
- `<link rel="preconnect">` to the Supabase project origin and `https://esm.sh`
  in all 9 page heads.
- Update the stale project map in `CLAUDE.md` (predates messages / profile /
  admin / guidelines pages and the conversations/ratings/reports API).

---

## Error handling

- New `api.js` functions throw on Supabase errors; UI callers catch and show
  friendly `error`-variant toasts (reusing `friendlyError` where it applies).
- `myUnreadCount()` and subscription setup never break page render — failures
  log and degrade to "no badge".

## Testing

No test framework (static site). Manual verification per phase via the local
preview:

- **Phase 1**: stack 3+ toasts, each variant, action + dismiss; screen-reader
  announcement (aria-live present); confirm dialog Esc/backdrop/focus behavior;
  all three replaced call sites.
- **Phase 2**: two logged-in browser profiles — B messages A's listing; A sees
  badge + toast + title prefix on a different page; opening the chat clears
  the badge; unread bold state on the messages page; logged-out pages clean.
- **Phase 3**: full email round-trip on the deployed origin; wrong/expired
  link shows the request form, not the update form.
- **Phases 4–5**: skeletons on cold load; URL round-trip of filters;
  optimistic delete + error path (kill network); preconnect present; nav
  reconcile request waterfall shortened (network tab).

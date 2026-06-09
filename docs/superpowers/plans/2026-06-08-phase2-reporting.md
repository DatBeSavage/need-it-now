# Phase 2 — Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user report another user (from a listing card, a chat, or a profile) with a reason + optional details; reports are stored for review (moderation happens in the Supabase dashboard).

**Architecture:** A `reports` table with insert-own / select-own RLS (you can file reports and see your own; you can't report yourself). A shared `report.js` modal opened from three entry points. No schema changes beyond the table — auto-hide-after-N-reports is deliberately deferred (see Notes).

**Tech Stack:** Static HTML/CSS/JS (ES modules), `@supabase/supabase-js@2`, Supabase Postgres + Auth.

**Verification model:** No JS test runner. Backend via live REST (curl + real JWT); UI in the preview. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`. Test accounts (password `test123456`): `neednow.verify917@gmail.com`, `neednow.owner01@gmail.com`.

---

## File structure
- **Modify** `supabase/schema.sql` — `reports` table + RLS.
- **Modify** `assets/js/api.js` — `createReport`.
- **Create** `assets/js/report.js` — shared report modal (`openReport`).
- **Modify** `assets/js/feed.js` — report control on others' listing cards.
- **Modify** `assets/js/chat.js` — report control in the chat header.
- **Modify** `assets/js/profile.js` — report button on someone else's profile.
- **Modify** `assets/css/main.css` — report modal + small report-button styles.

---

## Task 1: Schema — reports table + RLS

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Append the reports section** (after the ratings block)

```sql
-- ============================================================
-- Reporting: reports  (Phase 2)
-- ============================================================
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  reason           text not null check (reason in ('spam','harassment','scam','other')),
  details          text not null default '',
  listing_id       uuid references public.listings (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  message_id       uuid references public.messages (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists reports_reported_idx on public.reports (reported_user_id, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert with check (
  reporter_id = auth.uid() and reporter_id <> reported_user_id
);
create policy "reports_select_own" on public.reports for select using (reporter_id = auth.uid());
```

- [ ] **Step 2: User runs the updated `supabase/schema.sql`** (manual checkpoint). Expected "Success. No rows returned."

- [ ] **Step 3: Verify via REST**

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
uidf () { curl -s "$BASE/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $1" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
RT=$(tok neednow.verify917@gmail.com); RID=$(uidf "$RT")
OT=$(tok neednow.owner01@gmail.com); OID=$(uidf "$OT")
# 1) file a report against another user
curl -s -o /dev/null -w "1) report other: %{http_code}\n" "$BASE/rest/v1/reports" -H "apikey: $KEY" -H "Authorization: Bearer $RT" -H "Content-Type: application/json" -d "{\"reporter_id\":\"$RID\",\"reported_user_id\":\"$OID\",\"reason\":\"spam\",\"details\":\"test\"}"
# 2) reporting yourself is rejected
curl -s -o /dev/null -w "2) self-report (want 4xx): %{http_code}\n" "$BASE/rest/v1/reports" -H "apikey: $KEY" -H "Authorization: Bearer $RT" -H "Content-Type: application/json" -d "{\"reporter_id\":\"$RID\",\"reported_user_id\":\"$RID\",\"reason\":\"other\"}"
# 3) reporter sees own report; 4) other user cannot see it
echo -n "3) reporter sees own: "; curl -s "$BASE/rest/v1/reports?select=reason&reported_user_id=eq.$OID" -H "apikey: $KEY" -H "Authorization: Bearer $RT"; echo ""
echo -n "4) reported user sees (want []): "; curl -s "$BASE/rest/v1/reports?select=reason&reported_user_id=eq.$OID" -H "apikey: $KEY" -H "Authorization: Bearer $OT"; echo ""
# cleanup the reporter's own test rows
curl -s -o /dev/null -X DELETE "$BASE/rest/v1/reports?reporter_id=eq.$RID" -H "apikey: $KEY" -H "Authorization: Bearer $RT"
```

Expected: 1) 201, 2) 4xx (check constraint/RLS), 3) `[{"reason":"spam"}]`, 4) `[]` (RLS hides others' reports). (Delete needs a select+delete policy match; if cleanup returns 0 rows that's fine — they're harmless test rows for the dashboard.)

---

## Task 2: createReport API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Append** (after the Reputation section)

```js
/* ---------------- Reporting ---------------- */
export async function createReport({ reportedUserId, reason, details, listingId, conversationId, messageId }) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  if (reportedUserId === profile.id) throw new Error("You can't report yourself.");
  const { error } = await supabase.from("reports").insert({
    reporter_id: profile.id,
    reported_user_id: reportedUserId,
    reason: reason,
    details: (details || "").trim(),
    listing_id: listingId || null,
    conversation_id: conversationId || null,
    message_id: messageId || null,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Verify** — preview console: `const m = await import("../assets/js/api.js"); typeof m.createReport` → `"function"`.

---

## Task 3: Shared report modal

**Files:** Create `assets/js/report.js`

- [ ] **Step 1: Create `report.js`**

```js
// Need-It-Now — shared "Report" modal (reused by feed, chat, profile).
import { createReport } from "./api.js";
import { toast } from "./auth.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function build() {
  var m = document.createElement("div");
  m.id = "report-modal"; m.className = "modal-back";
  m.innerHTML =
    '<form class="card report" role="dialog" aria-modal="true">' +
      '<h3 data-rtitle>Report</h3>' +
      '<p class="muted" data-rsub style="margin-bottom:var(--sp-3)"></p>' +
      '<div class="field"><label for="r-reason">Reason</label>' +
        '<select class="select" id="r-reason">' +
          '<option value="spam">Spam</option>' +
          '<option value="harassment">Harassment or abuse</option>' +
          '<option value="scam">Scam / not as described</option>' +
          '<option value="other">Other</option></select></div>' +
      '<div class="field"><label for="r-details">Details (optional)</label>' +
        '<textarea class="textarea" id="r-details" maxlength="500" placeholder="What happened?"></textarea></div>' +
      '<div style="display:flex;gap:var(--sp-3);justify-content:flex-end">' +
        '<button type="button" class="btn btn--ghost" data-rcancel>Cancel</button>' +
        '<button type="submit" class="btn btn--primary">Submit report</button></div>' +
    "</form>";
  document.body.appendChild(m);
  m.addEventListener("click", function (e) { if (e.target === m) m.classList.remove("open"); });
  m.querySelector("[data-rcancel]").addEventListener("click", function () { m.classList.remove("open"); });
  return m;
}

// ctx: { reportedUserId, reportedName, listingId?, conversationId?, messageId? }
export function openReport(ctx) {
  if (!ctx || !ctx.reportedUserId) return;
  var m = document.getElementById("report-modal") || build();
  m.querySelector("[data-rtitle]").textContent = "Report " + (ctx.reportedName || "user");
  m.querySelector("[data-rsub]").textContent = ctx.listingId
    ? "Flags this listing and its owner for review."
    : "Flags this user for review.";
  var form = m.querySelector("form");
  form.querySelector("#r-reason").value = "spam";
  form.querySelector("#r-details").value = "";
  form.onsubmit = async function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await createReport({
        reportedUserId: ctx.reportedUserId,
        reason: form.querySelector("#r-reason").value,
        details: form.querySelector("#r-details").value,
        listingId: ctx.listingId, conversationId: ctx.conversationId, messageId: ctx.messageId,
      });
      m.classList.remove("open");
      toast("Thanks — we'll review this.");
    } catch (e2) {
      toast((e2 && e2.message) || "Couldn't submit report.");
    } finally {
      btn.disabled = false; btn.textContent = "Submit report";
    }
  };
  m.classList.add("open");
}
```

- [ ] **Step 2: Verify** — `await import("../assets/js/report.js")` resolves; calling `openReport({reportedUserId:"x",reportedName:"Test"})` shows the modal (then close it).

---

## Task 4: Report from listing cards

**Files:** Modify `assets/js/feed.js`

- [ ] **Step 1: Import** — add:

```js
import { openReport } from "./report.js";
```

- [ ] **Step 2: Add a report control to the foot of others' listings** — in `cardHTML`, change the `listing__foot` to include a report flag for real, non-own listings:

```js
      '<div class="listing__foot">' + actionHTML(row) +
        '<span class="muted" style="font-size:var(--fs-xs);white-space:nowrap">' +
          (row.response_count || 0) + " ↩</span>" +
        ((row.user_id && !isMine(row))
          ? '<button class="link-report" data-report="' + row.id + '" title="Report listing">⚑</button>' : "") +
      "</div>" +
```

- [ ] **Step 3: Wire the report buttons** — in `render()`, after the `[data-delete]` wiring, add:

```js
  grid.querySelectorAll("[data-report]").forEach(function (btn) {
    btn.addEventListener("click", function () { reportListing(btn.getAttribute("data-report")); });
  });
```

And add this function near `confirmDelete`:

```js
function reportListing(id) {
  var row = lastRows.filter(function (r) { return r.id === id; })[0];
  if (!row) return;
  if (!currentProfile) { go("pages/login.html?next=/pages/feed.html"); return; }
  openReport({ reportedUserId: row.user_id, reportedName: row.owner_name, listingId: row.id });
}
```

- [ ] **Step 4: Verify** — preview, logged in: others' listing cards show a small ⚑; clicking opens the report modal titled "Report <owner>"; submitting toasts "Thanks — we'll review this." Your own cards and demo listings show no ⚑.

---

## Task 5: Report from the chat header

**Files:** Modify `assets/js/chat.js`

- [ ] **Step 1: Import** — add:

```js
import { openReport } from "./report.js";
```

- [ ] **Step 2: Add a report button to the header** — in `modal()`, put it just before the close button:

```js
        '<button class="chat__report" data-report-user title="Report user">⚑</button>' +
        '<button class="chat__close" data-close aria-label="Close">✕</button></header>' +
```

- [ ] **Step 3: Wire it in `openPanel`** — after setting the header avatar/who/sub, add:

```js
  var reporteeId = conv ? (conv.buyer_id === meId ? conv.owner_id : conv.buyer_id)
                        : (opts.listing && opts.listing.user_id);
  m.querySelector("[data-report-user]").onclick = function () {
    if (reporteeId) openReport({ reportedUserId: reporteeId, reportedName: person.name,
      conversationId: conv && conv.id });
  };
```

- [ ] **Step 4: Verify** — open a chat with another user → ⚑ in the header → opens "Report <name>" → submit works. (For a brand-new thread the report still files against the listing owner with no conversation id.)

---

## Task 6: Report from a public profile

**Files:** Modify `assets/js/profile.js`

- [ ] **Step 1: Import** — add:

```js
import { openReport } from "./report.js";
```

- [ ] **Step 2: Add a Report button to the public profile header** — in `renderPublic`, add a button after the rating div (inside the `<div>` that holds name/meta/bio/rating):

```js
        '<div class="profile-rating">' + starsHTML(p.rating_avg, p.rating_count, "md") + "</div>" +
        '<button class="btn btn--ghost btn--sm" data-report-user style="margin-top:var(--sp-3)">⚑ Report</button>' +
```

Then after `renderReviews(...)`, wire it:

```js
  var rb = root.querySelector("[data-report-user]");
  if (rb) rb.addEventListener("click", function () {
    openReport({ reportedUserId: p.id, reportedName: p.name });
  });
```

- [ ] **Step 3: Verify** — visiting `profile.html?u=<other id>` shows a ⚑ Report button that opens the modal for that user; your own profile (editable view) has no Report button.

---

## Task 7: Styles

**Files:** Modify `assets/css/main.css`

- [ ] **Step 1: Append**

```css
/* ---- Reporting ---- */
.report { width: 100%; max-width: 440px; padding: var(--sp-6); }
.report h3 { font-size: var(--fs-lg); margin-bottom: var(--sp-2); }
.link-report { background: none; border: 0; cursor: pointer; color: var(--muted);
  font-size: var(--fs-sm); margin-left: var(--sp-1); padding: 2px 7px; border-radius: var(--r-sm); }
.link-report:hover { color: var(--danger); background: var(--surface-2); }
.chat__report { background: none; border: 0; cursor: pointer; color: var(--muted);
  font-size: 1rem; line-height: 1; padding: .25rem; }
.chat__report:hover { color: var(--danger); }
```

- [ ] **Step 2: Verify** — the report modal centers (reuses `.modal-back`), reads cleanly, and submits; the ⚑ controls are subtle gray and turn red on hover; everything fits a 375px viewport.

- [ ] **Step 3: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/report.js assets/js/feed.js \
        assets/js/chat.js assets/js/profile.js assets/css/main.css docs/superpowers/
git commit -m "feat: reporting — report users/listings from cards, chat, and profiles"
```

---

## Notes for the implementer
- `.modal-back` already exists and centers its child — the report modal reuses it; do NOT redefine it.
- RLS does the real enforcement: `reporter_id = auth.uid()` and `reporter_id <> reported_user_id`. The UI only shows Report on other people.
- `openReport` is the single entry point; all three callers pass `reportedUserId` + `reportedName` and optional context ids.
- **Deferred (not in this plan):** auto-hide a listing/user after N distinct reports. If wanted later: add `listings.hidden boolean default false`, a count-distinct-reporters trigger, and `and not l.hidden` in `nearby_listings`. Moderation today = read the `reports` table in the Supabase dashboard.

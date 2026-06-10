# Admin D2 — Editable Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the listing category list DB-driven and admin-editable; the post form's dropdown + emoji come from the `categories` table.

**Architecture:** A public-read/admin-write `categories` table (seeded with the current 8), API getters/mutators, a post-form that populates its `<select>` from the DB, and an admin Categories tab editor.

**Tech Stack:** Static HTML/CSS/JS (ES modules), Supabase Postgres + Auth (RLS).

**Verification model:** No JS test runner. RLS via live REST (admin + non-admin); UI in the preview. Base `https://yubhbztyprfupvjwxwmm.supabase.co`; key `sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz`. Admin `neednow.verify917@gmail.com`; non-admin `neednow.third01@gmail.com`.

---

## File structure
- **Modify** `supabase/schema.sql` — `categories` table + policies + seed.
- **Modify** `assets/js/api.js` — `getCategories`, `adminSaveCategory`, `adminDeleteCategory`.
- **Modify** `assets/js/post.js` — populate the category `<select>` + emoji from the DB.
- **Modify** `pages/admin.html` — a Categories tab button.
- **Modify** `assets/js/admin.js` — `renderCategories` + imports + `RENDER.categories`.

---

## Task 1: Schema — categories table

**Files:** Modify `supabase/schema.sql`

- [ ] **Step 1: Append** (after the settings block)

```sql
-- ============================================================
-- Categories  (Admin D2 — editable)
-- ============================================================
create table if not exists public.categories (
  value      text primary key,
  label      text not null,
  emoji      text not null default '📦',
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
drop policy if exists "categories_select_all"  on public.categories;
drop policy if exists "categories_insert_admin" on public.categories;
drop policy if exists "categories_update_admin" on public.categories;
drop policy if exists "categories_delete_admin" on public.categories;
create policy "categories_select_all"  on public.categories for select using (true);
create policy "categories_insert_admin" on public.categories for insert with check (public.is_admin());
create policy "categories_update_admin" on public.categories for update using (public.is_admin()) with check (public.is_admin());
create policy "categories_delete_admin" on public.categories for delete using (public.is_admin());

insert into public.categories (value, label, emoji, sort) values
  ('car','Cars & vehicles','🚗',1),
  ('bike','Bikes','🚲',2),
  ('phone','Phones & electronics','📱',3),
  ('furniture','Furniture','🛋️',4),
  ('game','Games & consoles','🎮',5),
  ('tool','Tools','🛠️',6),
  ('garden','Garden & outdoor','🌱',7),
  ('other','Other','📦',8)
on conflict (value) do nothing;
```

- [ ] **Step 2: User runs the updated `schema.sql`** (manual checkpoint). Expected "Success."

- [ ] **Step 3: Verify via REST**

```bash
BASE=https://yubhbztyprfupvjwxwmm.supabase.co
KEY=sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz
tok () { curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"test123456\"}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'; }
AT=$(tok neednow.verify917@gmail.com); NT=$(tok neednow.third01@gmail.com)
echo -n "anyone reads categories (want 8): "; curl -s "$BASE/rest/v1/categories?select=value" -H "apikey: $KEY" -H "Authorization: Bearer $NT" | grep -oc '"value"'
curl -s -o /dev/null -w "non-admin add category (want 4xx): %{http_code}\n" "$BASE/rest/v1/categories" -H "apikey: $KEY" -H "Authorization: Bearer $NT" -H "Content-Type: application/json" -d '{"value":"hax","label":"Hax","emoji":"💀","sort":99}'
curl -s -o /dev/null -w "admin add category (want 201): %{http_code}\n" "$BASE/rest/v1/categories" -H "apikey: $KEY" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d '{"value":"books","label":"Books","emoji":"📚","sort":9}'
echo -n "category list after add (want 9): "; curl -s "$BASE/rest/v1/categories?select=value" -H "apikey: $KEY" -H "Authorization: Bearer $AT" | grep -oc '"value"'
curl -s -o /dev/null -w "admin delete category (want 204): %{http_code}\n" -X DELETE "$BASE/rest/v1/categories?value=eq.books" -H "apikey: $KEY" -H "Authorization: Bearer $AT"
```

Expected: read → 8; non-admin add → 4xx; admin add → 201; list → 9; admin delete → 204.

---

## Task 2: Categories API

**Files:** Modify `assets/js/api.js`

- [ ] **Step 1: Append** (after the settings functions)

```js
export async function getCategories() {
  const { data, error } = await supabase.from("categories")
    .select("value,label,emoji,sort").order("sort", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function adminSaveCategory({ value, label, emoji, sort }) {
  const { error } = await supabase.from("categories")
    .upsert({ value: value, label: label, emoji: emoji || "📦", sort: sort || 0 });
  if (error) throw error;
}

export async function adminDeleteCategory(value) {
  const { error } = await supabase.from("categories").delete().eq("value", value);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify** — preview console: `await (await import("../assets/js/api.js")).getCategories()` returns an array of 8.

---

## Task 3: DB-driven category dropdown on the post form

**Files:** Modify `assets/js/post.js`

- [ ] **Step 1: Import `getCategories`** — change line 2:

```js
import { createListing, getListing, updateListing, getCategories } from "./api.js";
```

- [ ] **Step 2: Add an `emojiByCat` map** — after the `EMOJI` const (line 7-8), add:

```js
var emojiByCat = {};
```

- [ ] **Step 3: Populate the select from the DB** — right after `checkZip();` (the first one, ~line 21), add:

```js
  try {
    var cats = await getCategories();
    if (cats.length) {
      form.category.innerHTML = cats.map(function (c) {
        return '<option value="' + c.value + '">' +
          String(c.label).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</option>";
      }).join("");
      cats.forEach(function (c) { emojiByCat[c.value] = c.emoji; });
    }
  } catch (e) { /* keep the hard-coded options as a fallback */ }
```

(This runs before the edit-mode block, so `form.category.value = existing.category` still finds its option.)

- [ ] **Step 4: Derive emoji from the chosen category** — change the `emoji:` line in `fields` (~line 85):

```js
      category: cat, emoji: emojiByCat[cat] || EMOJI[cat] || "📦",
```

- [ ] **Step 5: Verify** — the post form's Category dropdown shows the DB categories; posting stores the category's emoji; editing a listing pre-selects its category.

---

## Task 4: Admin Categories tab

**Files:** Modify `pages/admin.html`, `assets/js/admin.js`

- [ ] **Step 1: Add the tab button** in `pages/admin.html` (after the Settings tab):

```html
        <button class="tab" data-tab="categories">Categories</button>
```

- [ ] **Step 2: Extend `admin.js` imports** — add the three category functions to the api.js import:

```js
         getSettings, adminSetSetting,
         getCategories, adminSaveCategory, adminDeleteCategory } from "./api.js";
```

(Append to the existing multi-line import — keep everything already imported.)

- [ ] **Step 3: Add `renderCategories`** (near the other render functions)

```js
async function renderCategories(panel) {
  panel.innerHTML = '<p class="muted">Loading categories…</p>';
  var cats = [];
  try { cats = await getCategories(); } catch (e) { /* */ }
  var sortByValue = {};
  cats.forEach(function (c) { sortByValue[c.value] = c.sort; });
  var rows = cats.map(function (c) {
    return '<div class="admin-row"><span class="admin-emoji">' + esc(c.emoji) + "</span>" +
      '<div class="admin-row__main"><div class="admin-meta">' +
        '<input class="input" data-cat-emoji="' + esc(c.value) + '" value="' + esc(c.emoji) + '" style="width:70px" />' +
        '<input class="input" data-cat-label="' + esc(c.value) + '" value="' + esc(c.label) + '" />' +
        '<span class="muted">' + esc(c.value) + "</span>" +
        '<button class="btn btn--ghost btn--sm" data-cat-save="' + esc(c.value) + '">Save</button>' +
        '<button class="btn btn--ghost btn--sm" data-cat-del="' + esc(c.value) + '">Delete</button>' +
      "</div></div></div>";
  }).join("");
  var addRow = '<div class="admin-row"><span class="admin-emoji">➕</span>' +
    '<div class="admin-row__main"><div class="admin-meta">' +
      '<input class="input" id="newcat-emoji" placeholder="📦" style="width:70px" />' +
      '<input class="input" id="newcat-label" placeholder="Label" />' +
      '<input class="input" id="newcat-value" placeholder="slug" style="width:120px" />' +
      '<button class="btn btn--primary btn--sm" id="newcat-add">Add</button>' +
    "</div></div></div>";
  panel.innerHTML = rows + addRow;

  panel.querySelectorAll("[data-cat-save]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var v = btn.getAttribute("data-cat-save");
      var label = panel.querySelector('[data-cat-label="' + v + '"]').value.trim();
      var emoji = panel.querySelector('[data-cat-emoji="' + v + '"]').value.trim() || "📦";
      if (!label) { toast("Label required."); return; }
      try { await adminSaveCategory({ value: v, label: label, emoji: emoji, sort: sortByValue[v] || 0 }); toast("Saved."); }
      catch (e) { toast("Couldn't save category."); }
    });
  });
  panel.querySelectorAll("[data-cat-del]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (!window.confirm("Delete this category?")) return;
      try { await adminDeleteCategory(btn.getAttribute("data-cat-del")); renderCategories(panel); }
      catch (e) { toast("Couldn't delete category."); }
    });
  });
  var add = panel.querySelector("#newcat-add");
  if (add) add.addEventListener("click", async function () {
    var v = panel.querySelector("#newcat-value").value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    var label = panel.querySelector("#newcat-label").value.trim();
    var emoji = panel.querySelector("#newcat-emoji").value.trim() || "📦";
    if (!v || !label) { toast("Slug and label are required."); return; }
    try { await adminSaveCategory({ value: v, label: label, emoji: emoji, sort: 99 }); renderCategories(panel); }
    catch (e) { toast("Couldn't add category."); }
  });
}
```

- [ ] **Step 4: Register it in `RENDER`** — extend the map:

```js
var RENDER = { reports: renderReports, users: renderUsers, listings: renderListings, settings: renderSettings, categories: renderCategories };
```

- [ ] **Step 5: Verify** — the Categories tab lists the 8 categories with editable emoji/label + Save/Delete and an add row; adding "Books 📚" makes it appear in the post form's dropdown; deleting removes it; editing an emoji + Save persists.

- [ ] **Step 6: Commit** (only when the user asks; we're on `feat/chat-phase1`)

```bash
git add supabase/schema.sql assets/js/api.js assets/js/post.js assets/js/admin.js \
        pages/admin.html index.html docs/superpowers/
git commit -m "feat: admin editable categories (DB-driven post-form category list)"
```

---

## Notes for the implementer
- `categories` is public-readable so the post form works for any logged-in user; writes are admin-only by RLS.
- `post.js` keeps the hard-coded `<select>` options + `EMOJI` map as a fallback if the fetch fails — the DB list overrides them when present.
- Save preserves a category's existing `sort` (via `sortByValue`); new categories append with `sort = 99`.
- The `index.html` footer copy fix is already applied in the working tree; just include it in the commit.

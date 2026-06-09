// Need-It-Now — auth + shared nav state (Supabase-backed).
import { signUp, signIn, signOut, getProfile } from "./api.js";
import { resolveZip } from "./config.js";
import { wireZipInput } from "./zips.js";
import { avatarHTML, initials } from "./avatar.js";

/* Resolve relative path depending on page depth (root vs /pages/). */
export function base() {
  return location.pathname.indexOf("/pages/") !== -1 ? "../" : "";
}
export function go(path) { location.href = base() + path; }

export function toast(msg) {
  var t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2400);
}

function friendlyError(e) {
  var m = (e && e.message) || "Something went wrong. Try again.";
  if (/already registered|already exists|duplicate/i.test(m)) return "An account with that email already exists.";
  if (/invalid login|invalid credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first, then log in.";
  if (/rate limit/i.test(m)) return "Too many attempts — wait a moment and try again.";
  return m;
}

/* Render the user side of the nav on every page. */
async function renderNavUser() {
  var slot = document.querySelector("[data-nav-user]");
  if (!slot) return;
  var profile = null;
  try { profile = await getProfile(); } catch (e) { /* offline / not logged in */ }
  if (profile) {
    slot.innerHTML =
      '<a href="' + base() + 'pages/messages.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--ink-2);text-decoration:none;padding:.5rem .8rem">Messages</a>' +
      '<a class="btn btn--money btn--sm" href="' + base() + 'pages/post.html">+ Post</a>' +
      '<a href="' + base() + 'pages/profile.html" class="nav__avatar-link" title="' + profile.name + '">' +
        avatarHTML(profile, "sm") + "</a>" +
      '<a href="#" data-logout style="font-weight:700;font-size:var(--fs-sm);color:var(--muted);text-decoration:none">Log out</a>';
    slot.querySelector("[data-logout]").addEventListener("click", async function (e) {
      e.preventDefault(); await signOut(); go("pages/login.html");
    });
  } else {
    slot.innerHTML =
      '<a href="' + base() + 'pages/login.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--ink-2);text-decoration:none;padding:.5rem .8rem">Log in</a>' +
      '<a class="btn btn--primary" href="' + base() + 'pages/register.html">Sign up</a>';
  }
}

/* Guard: redirect to login if not signed in. Returns the profile or null. */
export async function requireAuth() {
  var profile = await getProfile();
  if (!profile) { go("pages/login.html?next=" + encodeURIComponent(location.pathname)); return null; }
  return profile;
}

function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = busyLabel; }
  else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
}

function wireRegister() {
  var form = document.querySelector("[data-register]");
  if (!form) return;
  var err = form.querySelector(".form-error");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    var name = form.name_.value.trim();
    var email = form.email.value.trim();
    var zip = form.zip.value.trim();
    var pass = form.password.value;
    if (!name || !email || !pass) { err.textContent = "Please fill in name, email and password."; return; }
    if (pass.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
    if (!(await resolveZip(zip))) { err.textContent = "Enter a valid US ZIP code."; return; }
    var btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true, "Creating…");
    try {
      var res = await signUp({ name: name, email: email, zip: zip, password: pass });
      if (res && res.session) {
        // Instant sign-in (email confirmation OFF) — we're logged in.
        go("pages/feed.html");
      } else {
        // Email confirmation is ON: account made, but no session yet.
        err.classList.add("form-error--ok");
        err.textContent = "Account created! Check your email to confirm it, then log in.";
        setBusy(btn, false);
      }
    } catch (e2) {
      err.classList.remove("form-error--ok");
      err.textContent = friendlyError(e2);
      setBusy(btn, false);
    }
  });
}

function wireLogin() {
  var form = document.querySelector("[data-login]");
  if (!form) return;
  var err = form.querySelector(".form-error");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    var email = form.email.value.trim();
    var pass = form.password.value;
    if (!email || !pass) { err.textContent = "Enter your email and password."; return; }
    var btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true, "Logging in…");
    try {
      await signIn({ email: email, password: pass });
      var next = new URLSearchParams(location.search).get("next");
      if (next && next.indexOf("/pages/") !== -1) {
        location.href = base() + "pages/" + next.split("/pages/")[1];
      } else { go("pages/feed.html"); }
    } catch (e2) {
      err.textContent = friendlyError(e2);
      setBusy(btn, false);
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  renderNavUser();
  wireRegister();
  wireLogin();
  var rz = document.getElementById("r-zip");
  if (rz) wireZipInput(rz);
});

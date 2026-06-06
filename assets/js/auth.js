/* Need-It-Now — auth & shared nav state.
   Prototype: passwords are stored in plain localStorage. Not for real use. */
(function () {
  "use strict";
  var NIN = window.NIN;

  /* Resolve relative path depending on page depth (root vs /pages/). */
  function base() {
    return location.pathname.indexOf("/pages/") !== -1 ? "../" : "";
  }
  function go(path) { location.href = base() + path; }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p[0]; }).join("").toUpperCase();
  }

  /* Render the user side of the nav on every page. */
  function renderNavUser() {
    var slot = document.querySelector("[data-nav-user]");
    if (!slot) return;
    var user = NIN.getSession();
    if (user) {
      slot.innerHTML =
        '<a class="btn btn--money btn--sm" href="' + base() + 'pages/post.html">+ Post</a>' +
        '<span class="nav__avatar" title="' + user.name + '">' + initials(user.name) + "</span>" +
        '<a href="#" data-logout style="font-weight:700;font-size:var(--fs-sm);color:var(--muted);text-decoration:none">Log out</a>';
      var lo = slot.querySelector("[data-logout]");
      lo.addEventListener("click", function (e) {
        e.preventDefault(); NIN.clearSession(); go("pages/login.html");
      });
    } else {
      slot.innerHTML =
        '<a href="' + base() + 'pages/login.html" style="font-weight:700;font-size:var(--fs-sm);color:var(--ink-2);text-decoration:none;padding:.5rem .8rem">Log in</a>' +
        '<a class="btn btn--primary" href="' + base() + 'pages/register.html">Sign up</a>';
    }
  }

  /* Guard: redirect to login if not signed in. Returns the user or null. */
  function requireAuth() {
    var user = NIN.getSession();
    if (!user) { go("pages/login.html?next=" + encodeURIComponent(location.pathname)); return null; }
    return user;
  }

  function toast(msg) {
    var t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---- Register form ---- */
  function wireRegister() {
    var form = document.querySelector("[data-register]");
    if (!form) return;
    var err = form.querySelector(".form-error");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.textContent = "";
      var name = form.name_.value.trim();
      var email = form.email.value.trim();
      var zip = form.zip.value.trim();
      var pass = form.password.value;
      if (!name || !email || !pass) { err.textContent = "Please fill in name, email and password."; return; }
      if (pass.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
      if (!NIN.zipCoord(zip)) {
        err.textContent = "Pick a ZIP from the list (this demo knows the Austin, TX area).";
        return;
      }
      if (NIN.findUser(email)) { err.textContent = "An account with that email already exists."; return; }
      var user = NIN.addUser({ name: name, email: email, zip: zip, password: pass });
      NIN.setSession(user.id);
      go("pages/feed.html");
    });
  }

  /* ---- Login form ---- */
  function wireLogin() {
    var form = document.querySelector("[data-login]");
    if (!form) return;
    var err = form.querySelector(".form-error");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.textContent = "";
      var email = form.email.value.trim();
      var pass = form.password.value;
      var user = NIN.findUser(email);
      if (!user || user.password !== pass) { err.textContent = "Wrong email or password."; return; }
      NIN.setSession(user.id);
      var next = new URLSearchParams(location.search).get("next");
      if (next && next.indexOf("/pages/") !== -1) {
        location.href = base() + "pages/" + next.split("/pages/")[1];
      } else { go("pages/feed.html"); }
    });
    var demo = form.querySelector("[data-demo-fill]");
    if (demo) demo.addEventListener("click", function (e) {
      e.preventDefault();
      form.email.value = "demo@needitnow.app"; form.password.value = "demo1234";
    });
  }

  window.NINAuth = { base: base, go: go, requireAuth: requireAuth, initials: initials, toast: toast };

  document.addEventListener("DOMContentLoaded", function () {
    renderNavUser();
    wireRegister();
    wireLogin();
  });
})();

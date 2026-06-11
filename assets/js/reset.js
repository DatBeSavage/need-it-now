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

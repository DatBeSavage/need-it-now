// Need-It-Now — create/edit listing page (Supabase).
import { createListing, getListing, updateListing } from "./api.js";
import { resolveZip } from "./config.js";
import { requireAuth, go } from "./auth.js";
import { wireZipInput } from "./zips.js";

var EMOJI = { car: "🚗", bike: "🚲", phone: "📱", furniture: "🛋️", game: "🎮",
              tool: "🛠️", garden: "🌱", other: "📦" };

document.addEventListener("DOMContentLoaded", async function () {
  var form = document.querySelector("[data-post]");
  if (!form) return;

  var profile = await requireAuth();
  if (!profile) return; // redirected to login

  var editId = new URLSearchParams(location.search).get("id");

  form.zip.value = profile.zip || "";
  var checkZip = wireZipInput(form.zip);
  checkZip();

  var priceLabel = document.getElementById("price-label");
  function syncType() {
    var t = form.querySelector('input[name="type"]:checked').value;
    priceLabel.textContent = t === "sell" ? "Asking price ($)" : "Your budget ($)";
  }
  form.querySelectorAll('input[name="type"]').forEach(function (r) {
    r.addEventListener("change", syncType);
  });
  syncType();

  var submitBtn = form.querySelector('button[type="submit"]');
  var heading = document.querySelector("main h1");

  // ----- Edit mode: load the listing and prefill -----
  if (editId) {
    var existing = null;
    try { existing = await getListing(editId); } catch (e) { /* handled below */ }
    if (!existing || existing.user_id !== profile.id) {
      // Not yours (or gone) — bounce back to the feed.
      go("pages/feed.html");
      return;
    }
    if (heading) heading.textContent = "Edit listing";
    submitBtn.textContent = "Save changes";
    form.querySelectorAll('input[name="type"]').forEach(function (r) {
      r.checked = r.value === existing.type;
    });
    syncType();
    form.title_.value = existing.title;
    form.desc.value = existing.description;
    form.price.value = existing.price;
    form.zip.value = existing.zip || "";
    form.category.value = existing.category || "other";
    checkZip();
  }

  var err = form.querySelector(".form-error");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    var type = form.querySelector('input[name="type"]:checked').value;
    var title = form.title_.value.trim();
    var desc = form.desc.value.trim();
    var price = parseInt(form.price.value, 10);
    var zip = form.zip.value.trim();
    var cat = form.category.value;
    if (!title || !desc) { err.textContent = "Add a title and a few details."; return; }
    if (isNaN(price) || price < 0) { err.textContent = "Enter a valid price or budget."; return; }

    var busyLabel = editId ? "Saving…" : "Publishing…";
    var restLabel = editId ? "Save changes" : "Publish listing";
    submitBtn.disabled = true; submitBtn.textContent = busyLabel;

    var coord = await resolveZip(zip);
    if (!coord) {
      err.textContent = "Enter a valid US ZIP code.";
      submitBtn.disabled = false; submitBtn.textContent = restLabel;
      return;
    }

    var fields = {
      type: type, title: title, description: desc, price: price,
      category: cat, emoji: EMOJI[cat] || "📦",
      zip: zip, lat: coord.lat, lng: coord.lng,
    };
    try {
      if (editId) {
        await updateListing(editId, fields);
        go("pages/feed.html");
      } else {
        await createListing(fields);
        go("pages/feed.html?posted=1");
      }
    } catch (e2) {
      err.textContent = (e2 && e2.message) || "Couldn't save — try again.";
      submitBtn.disabled = false; submitBtn.textContent = restLabel;
    }
  });
});

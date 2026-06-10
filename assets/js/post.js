// Need-It-Now — create/edit listing page (Supabase).
import { createListing, getListing, updateListing, getCategories,
         uploadListingPhoto, listingPhotoUrl } from "./api.js";
import { resolveZip } from "./config.js";
import { requireAuth, go, toast } from "./auth.js";
import { wireZipInput } from "./zips.js";

var MAX_PHOTOS = 4;

var EMOJI = { car: "🚗", bike: "🚲", phone: "📱", furniture: "🛋️", game: "🎮",
              tool: "🛠️", garden: "🌱", other: "📦" };
var emojiByCat = {};

document.addEventListener("DOMContentLoaded", async function () {
  var form = document.querySelector("[data-post]");
  if (!form) return;

  var profile = await requireAuth();
  if (!profile) return; // redirected to login

  var editId = new URLSearchParams(location.search).get("id");

  form.zip.value = profile.zip || "";
  var checkZip = wireZipInput(form.zip);
  checkZip();

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

  // ----- Photos: existing (kept paths) + newly chosen (File objects) -----
  var photoBox = form.querySelector("[data-photos]");
  var photoInput = form.querySelector("[data-photo-input]");
  var keptPaths = [];   // existing stored paths we keep on save
  var newFiles = [];    // File objects to upload on save

  function renderPhotos() {
    var thumbs = keptPaths.map(function (p, i) {
      return '<div class="photo-thumb"><img src="' + listingPhotoUrl(p) + '" alt="" />' +
        '<button type="button" class="photo-thumb__x" data-rm-kept="' + i + '" aria-label="Remove photo">✕</button></div>';
    });
    newFiles.forEach(function (f, i) {
      thumbs.push('<div class="photo-thumb"><img src="' + URL.createObjectURL(f) + '" alt="" />' +
        '<button type="button" class="photo-thumb__x" data-rm-new="' + i + '" aria-label="Remove photo">✕</button></div>');
    });
    photoBox.innerHTML = thumbs.join("");
    photoBox.querySelectorAll("[data-rm-kept]").forEach(function (b) {
      b.onclick = function () { keptPaths.splice(+b.getAttribute("data-rm-kept"), 1); renderPhotos(); };
    });
    photoBox.querySelectorAll("[data-rm-new]").forEach(function (b) {
      b.onclick = function () { newFiles.splice(+b.getAttribute("data-rm-new"), 1); renderPhotos(); };
    });
  }
  photoInput.addEventListener("change", function () {
    var room = MAX_PHOTOS - (keptPaths.length + newFiles.length);
    var picked = Array.prototype.slice.call(photoInput.files || []);
    if (picked.length > room) { toast("You can add up to " + MAX_PHOTOS + " photos."); picked = picked.slice(0, Math.max(0, room)); }
    newFiles = newFiles.concat(picked);
    photoInput.value = "";
    renderPhotos();
  });

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
    keptPaths = (existing.photos || []).slice();
    renderPhotos();
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

    var photos = keptPaths.slice();
    try {
      for (var i = 0; i < newFiles.length; i++) {
        submitBtn.textContent = "Uploading photo " + (i + 1) + "/" + newFiles.length + "…";
        photos.push(await uploadListingPhoto(newFiles[i]));
      }
    } catch (e3) {
      err.textContent = (e3 && e3.message) || "Couldn't upload a photo — try again.";
      submitBtn.disabled = false; submitBtn.textContent = restLabel;
      return;
    }
    submitBtn.textContent = busyLabel;

    var fields = {
      type: type, title: title, description: desc, price: price,
      category: cat, emoji: emojiByCat[cat] || EMOJI[cat] || "📦",
      zip: zip, lat: coord.lat, lng: coord.lng, photos: photos,
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

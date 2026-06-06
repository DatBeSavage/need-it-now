/* Need-It-Now — create-listing page. */
(function () {
  "use strict";
  var NIN = window.NIN, Auth = window.NINAuth;

  var EMOJI = { car: "🚗", bike: "🚲", phone: "📱", furniture: "🛋️", game: "🎮",
                tool: "🛠️", garden: "🌱", other: "📦" };

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.querySelector("[data-post]");
    if (!form) return;
    var user = Auth.requireAuth();
    if (!user) return;

    // Build ZIP datalist + default to user's zip
    var dl = document.getElementById("zip-list");
    if (dl) dl.innerHTML = Object.keys(NIN.ZIPS).map(function (z) {
      return '<option value="' + z + '">' + NIN.ZIPS[z].city + "</option>";
    }).join("");
    form.zip.value = user.zip || "";

    // Live label flip between "Price" and "Budget"
    var priceLabel = document.getElementById("price-label");
    function syncType() {
      var t = form.querySelector('input[name="type"]:checked').value;
      priceLabel.textContent = t === "sell" ? "Asking price ($)" : "Your budget ($)";
    }
    form.querySelectorAll('input[name="type"]').forEach(function (r) {
      r.addEventListener("change", syncType);
    });
    syncType();

    var err = form.querySelector(".form-error");
    form.addEventListener("submit", function (e) {
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
      if (!NIN.zipCoord(zip)) { err.textContent = "Pick a ZIP from the list (demo covers the Austin, TX area)."; return; }
      NIN.addListing({
        type: type, title: title, desc: desc, price: price, zip: zip,
        emoji: EMOJI[cat] || "📦", ownerName: user.name,
      });
      Auth.go("pages/feed.html?posted=1");
    });
  });
})();

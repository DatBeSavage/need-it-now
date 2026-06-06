/* Need-It-Now — feed page: location + radius filtering, search, respond. */
(function () {
  "use strict";
  var NIN = window.NIN, Auth = window.NINAuth;

  var state = { zip: "78701", radius: 25, type: "all", q: "" };

  function timeAgo(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }
  function money(n) { return "$" + Number(n).toLocaleString("en-US"); }

  function buildZipList() {
    var dl = document.getElementById("zip-list");
    if (!dl) return;
    dl.innerHTML = Object.keys(NIN.ZIPS).map(function (z) {
      return '<option value="' + z + '">' + NIN.ZIPS[z].city + "</option>";
    }).join("");
  }

  function decorate(listings) {
    var origin = NIN.zipCoord(state.zip);
    return listings.map(function (l) {
      var c = NIN.zipCoord(l.zip);
      var d = origin && c ? NIN.distanceMiles(origin, c) : null;
      return { l: l, dist: d };
    });
  }

  function filterSort(items) {
    var q = state.q.toLowerCase();
    return items.filter(function (it) {
      if (state.type !== "all" && it.l.type !== state.type) return false;
      if (it.dist !== null && it.dist > state.radius) return false;
      if (q && (it.l.title + " " + it.l.desc).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var da = a.dist === null ? 1e9 : a.dist, db = b.dist === null ? 1e9 : b.dist;
      if (Math.abs(da - db) > 0.1) return da - db;
      return b.l.createdAt - a.l.createdAt;
    });
  }

  function cardHTML(it) {
    var l = it.l;
    var badge = l.type === "sell"
      ? '<span class="badge badge--sell">For sale</span>'
      : '<span class="badge badge--buy">Looking to buy</span>';
    var distTxt = it.dist === null ? l.zip : (it.dist < 1 ? "<1 mi away" : Math.round(it.dist) + " mi away");
    var priceLabel = l.type === "sell" ? money(l.price) : "Budget " + money(l.price);
    return '' +
      '<article class="listing">' +
        '<div class="listing__media">' + (l.emoji || "📦") + "</div>" +
        '<div class="listing__body">' +
          '<div class="listing__top">' + badge +
            '<span class="price listing__price">' + priceLabel + "</span>" +
          "</div>" +
          '<h3 class="listing__title">' + escapeHTML(l.title) + "</h3>" +
          '<p class="listing__desc">' + escapeHTML(l.desc) + "</p>" +
          '<div class="listing__meta">' +
            "<span>" + escapeHTML(l.ownerName) + " · " + timeAgo(l.createdAt) + "</span>" +
            '<span class="pin">📍 ' + distTxt + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="listing__foot">' +
          '<button class="btn btn--ghost btn--block" data-respond="' + l.id + '">' +
            (l.type === "sell" ? "I'm interested" : "I have one") + "</button>" +
          '<span class="muted" style="font-size:var(--fs-xs);white-space:nowrap">' +
            (l.responses || 0) + " ↩</span>" +
        "</div>" +
      "</article>";
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function render() {
    var grid = document.getElementById("listings");
    var count = document.getElementById("result-count");
    var items = filterSort(decorate(NIN.getListings()));
    if (count) {
      var loc = NIN.zipCoord(state.zip);
      count.textContent = items.length + " result" + (items.length === 1 ? "" : "s") +
        (loc ? " within " + state.radius + " mi of " + loc.city : "");
    }
    if (!items.length) {
      grid.innerHTML = '<div class="empty"><div class="em">🔍</div>' +
        "<p>Nothing here yet. Try widening your radius or clearing filters — " +
        'or <a href="post.html" style="color:var(--blue-600);font-weight:700">post what you need</a>.</p></div>';
      return;
    }
    grid.innerHTML = items.map(cardHTML).join("");
    grid.querySelectorAll("[data-respond]").forEach(function (btn) {
      btn.addEventListener("click", function () { openRespond(btn.getAttribute("data-respond")); });
    });
  }

  /* ---- Respond modal ---- */
  function openRespond(id) {
    var l = NIN.getListing(id);
    if (!l) return;
    if (!NIN.getSession()) { Auth.go("pages/login.html?next=/pages/feed.html"); return; }
    var back = document.getElementById("respond-modal");
    var verb = l.type === "sell" ? "Message the seller" : "Offer what they need";
    back.querySelector("[data-modal-title]").textContent = verb;
    back.querySelector("[data-modal-sub]").innerHTML =
      "Re: <strong>" + escapeHTML(l.title) + "</strong>";
    var form = back.querySelector("form");
    form.message.value = "";
    form.onsubmit = function (e) {
      e.preventDefault();
      var user = NIN.getSession();
      NIN.addResponse(id, { fromName: user.name, message: form.message.value.trim() });
      back.classList.remove("open");
      Auth.toast("Sent! In a real app the poster would get notified.");
      render();
    };
    back.classList.add("open");
  }

  function wireControls() {
    var loc = document.getElementById("ctl-zip");
    var rad = document.getElementById("ctl-radius");
    var radVal = document.getElementById("radius-val");
    var search = document.getElementById("ctl-search");

    var user = NIN.getSession();
    state.zip = (user && user.zip) || "78701";
    loc.value = state.zip;
    rad.value = state.radius;
    radVal.textContent = state.radius;

    loc.addEventListener("input", function () { state.zip = loc.value.trim(); render(); });
    rad.addEventListener("input", function () { state.radius = +rad.value; radVal.textContent = rad.value; render(); });
    search.addEventListener("input", function () { state.q = search.value; render(); });

    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        state.type = chip.getAttribute("data-filter");
        render();
      });
    });

    var back = document.getElementById("respond-modal");
    back.addEventListener("click", function (e) { if (e.target === back) back.classList.remove("open"); });
    back.querySelector("[data-modal-close]").addEventListener("click", function () { back.classList.remove("open"); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("listings")) return;
    buildZipList();
    wireControls();
    render();
    // flash banner after posting
    if (new URLSearchParams(location.search).get("posted")) {
      var b = document.getElementById("flash");
      if (b) { b.style.display = "flex"; }
    }
  });
})();

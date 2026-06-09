// Need-It-Now — shared ZIP input behavior: cache-powered autocomplete + live verify.
import { resolveZip, cachedZips } from "./config.js";

// Fill a <datalist> with every ZIP we currently know (seeded cities + resolved).
export function fillZipDatalist(dl) {
  if (!dl) return;
  var map = cachedZips();
  dl.innerHTML = Object.keys(map).sort().map(function (z) {
    return '<option value="' + z + '">' + (map[z].city || z) + "</option>";
  }).join("");
}

// Wire a ZIP <input>: cache-backed autocomplete + debounced live verification.
// Inserts a status line under the input. Returns a check() you can call manually
// (e.g. after pre-filling the field in edit mode).
//   opts: { datalist?, onResolve?(coord|null) }
export function wireZipInput(input, opts) {
  opts = opts || {};
  var dl = opts.datalist
    || document.getElementById(input.getAttribute("list") || "")
    || document.getElementById("zip-list");
  fillZipDatalist(dl);

  var hint = document.createElement("p");
  hint.className = "zip-hint";
  hint.setAttribute("aria-live", "polite");
  input.insertAdjacentElement("afterend", hint);

  function show(text, mod) {
    hint.textContent = text;
    hint.className = "zip-hint" + (mod ? " zip-hint--" + mod : "");
  }

  var t;
  function check() {
    var raw = input.value.trim();
    var z = raw.replace(/[^0-9]/g, "").slice(0, 5);
    if (raw === "") { show(""); if (opts.onResolve) opts.onResolve(null); return Promise.resolve(null); }
    if (z.length < 5) { show("Enter a 5-digit ZIP.", "bad"); if (opts.onResolve) opts.onResolve(null); return Promise.resolve(null); }
    show("Checking ZIP…");
    return resolveZip(z).then(function (coord) {
      if (coord) { show("📍 " + coord.city, "ok"); fillZipDatalist(dl); }
      else { show("That's not a valid US ZIP.", "bad"); }
      if (opts.onResolve) opts.onResolve(coord);
      return coord;
    });
  }

  input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(check, 350); });
  input.addEventListener("blur", check);
  return check;
}

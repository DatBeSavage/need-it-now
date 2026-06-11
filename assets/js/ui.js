// Need-It-Now — shared UI primitives: toasts, confirm dialog, modal helpers.

var ICONS = { success: "✓", error: "⚠", info: "" };
var DURATION = { success: 2400, info: 2400, error: 5500 };

function container() {
  var c = document.querySelector(".toasts");
  if (!c) {
    c = document.createElement("div");
    c.className = "toasts";
    c.setAttribute("role", "status");
    c.setAttribute("aria-live", "polite");
    document.body.appendChild(c);
  }
  return c;
}

/* toast("Saved.")  or  toast("Gone.", { type: "error", actionLabel: "Undo", onAction: fn }) */
export function toast(msg, opts) {
  opts = opts || {};
  var type = ICONS.hasOwnProperty(opts.type) ? opts.type : "info";
  var c = container();
  var t = document.createElement("div");
  t.className = "toast" + (type !== "info" ? " toast--" + type : "");
  if (ICONS[type]) {
    var ic = document.createElement("span");
    ic.className = "toast__icon"; ic.setAttribute("aria-hidden", "true"); ic.textContent = ICONS[type];
    t.appendChild(ic);
  }
  var m = document.createElement("span");
  m.className = "toast__msg"; m.textContent = msg;
  t.appendChild(m);
  if (opts.actionLabel) {
    var a = document.createElement("button");
    a.className = "toast__action"; a.type = "button"; a.textContent = opts.actionLabel;
    a.addEventListener("click", function () {
      dismiss();
      try { if (opts.onAction) opts.onAction(); }
      catch (e) { console.error("toast onAction:", e); }
    });
    t.appendChild(a);
  }
  var x = document.createElement("button");
  x.className = "toast__x"; x.type = "button"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "✕";
  x.addEventListener("click", function () { dismiss(); });
  t.appendChild(x);
  c.appendChild(t);
  while (c.children.length > 3) c.removeChild(c.firstChild);
  requestAnimationFrame(function () { t.classList.add("show"); });
  var timer = setTimeout(dismiss, opts.duration || DURATION[type]);
  function dismiss() {
    clearTimeout(timer);
    if (!t.parentNode) return;
    t.classList.remove("show");
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 200);
  }
  return dismiss;
}

var _dialogOpen = false;
var _dialogCount = 0;

/* confirmDialog({title, body, confirmLabel, cancelLabel, danger}) -> Promise<boolean> */
export function confirmDialog(opts) {
  if (_dialogOpen) return Promise.resolve(false);
  _dialogOpen = true;
  opts = opts || {};
  return new Promise(function (resolve) {
    var uid = "confirm-title-" + (++_dialogCount);
    var back = document.createElement("div");
    back.className = "modal-back open";
    back.innerHTML =
      '<div class="modal card" role="dialog" aria-modal="true" aria-labelledby="' + uid + '">' +
        '<h3 id="' + uid + '"></h3>' +
        '<p class="muted" data-body></p>' +
        '<div class="confirm__actions">' +
          '<button type="button" class="btn btn--ghost" data-cancel></button>' +
          '<button type="button" class="btn" data-ok></button>' +
        "</div></div>";
    back.querySelector("h3").textContent = opts.title || "Are you sure?";
    back.querySelector("[data-body]").textContent = opts.body || "";
    if (!opts.body) back.querySelector("[data-body]").hidden = true;
    var cancel = back.querySelector("[data-cancel]");
    var ok = back.querySelector("[data-ok]");
    cancel.textContent = opts.cancelLabel || "Cancel";
    ok.textContent = opts.confirmLabel || "OK";
    ok.classList.add(opts.danger ? "btn--danger" : "btn--primary");
    var prevFocus = document.activeElement;
    function done(val) {
      _dialogOpen = false;
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(val);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Tab") {
        var f = [cancel, ok];
        var i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }
    back.addEventListener("click", function (e) { if (e.target === back) done(false); });
    cancel.addEventListener("click", function () { done(false); });
    ok.addEventListener("click", function () { done(true); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    cancel.focus();
  });
}

/* Esc closes a .modal-back panel while it is open. Call once per backdrop.
   Only the topmost open backdrop (last in DOM order) responds, so stacked
   modals (report over chat) close one at a time. */
export function escToClose(backdrop, close) {
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !backdrop.classList.contains("open")) return;
    var open = document.querySelectorAll(".modal-back.open");
    if (open[open.length - 1] !== backdrop) return;
    e.preventDefault();
    close();
  });
}

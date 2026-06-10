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
  t.className = "toast toast--" + type;
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
    a.addEventListener("click", function () { dismiss(); if (opts.onAction) opts.onAction(); });
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

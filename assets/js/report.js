// Need-It-Now — shared "Report" modal (reused by feed, chat, profile).
import { createReport } from "./api.js";
import { toast } from "./auth.js";
import { escToClose } from "./ui.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function build() {
  var m = document.createElement("div");
  m.id = "report-modal"; m.className = "modal-back";
  m.innerHTML =
    '<form class="card report" role="dialog" aria-modal="true">' +
      '<h3 data-rtitle>Report</h3>' +
      '<p class="muted" data-rsub style="margin-bottom:var(--sp-3)"></p>' +
      '<div class="field"><label for="r-reason">Reason</label>' +
        '<select class="select" id="r-reason">' +
          '<option value="spam">Spam</option>' +
          '<option value="harassment">Harassment or abuse</option>' +
          '<option value="scam">Scam / not as described</option>' +
          '<option value="other">Other</option></select></div>' +
      '<div class="field"><label for="r-details">Details (optional)</label>' +
        '<textarea class="textarea" id="r-details" maxlength="500" placeholder="What happened?"></textarea></div>' +
      '<div style="display:flex;gap:var(--sp-3);justify-content:flex-end">' +
        '<button type="button" class="btn btn--ghost" data-rcancel>Cancel</button>' +
        '<button type="submit" class="btn btn--primary">Submit report</button></div>' +
    "</form>";
  document.body.appendChild(m);
  m.addEventListener("click", function (e) { if (e.target === m) m.classList.remove("open"); });
  m.querySelector("[data-rcancel]").addEventListener("click", function () { m.classList.remove("open"); });
  escToClose(m, function () { m.classList.remove("open"); });
  return m;
}

// ctx: { reportedUserId, reportedName, listingId?, conversationId?, messageId? }
export function openReport(ctx) {
  if (!ctx || !ctx.reportedUserId) return;
  var m = document.getElementById("report-modal") || build();
  m.querySelector("[data-rtitle]").textContent = "Report " + (ctx.reportedName || "user");
  m.querySelector("[data-rsub]").textContent = ctx.listingId
    ? "Flags this listing and its owner for review."
    : "Flags this user for review.";
  var form = m.querySelector("form");
  form.querySelector("#r-reason").value = "spam";
  form.querySelector("#r-details").value = "";
  form.onsubmit = async function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await createReport({
        reportedUserId: ctx.reportedUserId,
        reason: form.querySelector("#r-reason").value,
        details: form.querySelector("#r-details").value,
        listingId: ctx.listingId, conversationId: ctx.conversationId, messageId: ctx.messageId,
      });
      m.classList.remove("open");
      toast("Thanks — we'll review this.");
    } catch (e2) {
      toast((e2 && e2.message) || "Couldn't submit report.");
    } finally {
      btn.disabled = false; btn.textContent = "Submit report";
    }
  };
  m.classList.add("open");
}

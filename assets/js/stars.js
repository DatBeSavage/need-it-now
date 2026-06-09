// Need-It-Now — star rating rendering.
export function starsHTML(avg, count, size) {
  size = size || "md";
  count = count || 0;
  if (!count) {
    return '<span class="stars stars--' + size + ' stars--empty">No ratings yet</span>';
  }
  var filled = Math.round(Number(avg));
  var s = "";
  for (var i = 1; i <= 5; i++) {
    s += '<span class="star' + (i <= filled ? " star--on" : "") + '">★</span>';
  }
  return '<span class="stars stars--' + size + '">' + s +
    '<span class="stars__num">' + Number(avg).toFixed(1) + " (" + count + ")</span></span>";
}

// Compact one-liner for tight spots (listing cards). Shows a "New seller" tag
// when the seller has no ratings yet, so a post never looks rating-less.
export function starBadge(avg, count) {
  if (!count) return '<span class="star-badge star-badge--new">New seller</span>';
  return '<span class="star-badge">★ ' + Number(avg).toFixed(1) + " (" + count + ")</span>";
}

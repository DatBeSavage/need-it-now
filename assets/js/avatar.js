// Need-It-Now — avatar rendering (photo, or initials fallback).
import { SUPABASE_URL } from "./config.js";

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2)
    .map(function (p) { return p[0]; }).join("").toUpperCase();
}

// Build the public URL for a stored avatar path, or null.
export function avatarUrl(path) {
  return path ? SUPABASE_URL + "/storage/v1/object/public/avatars/" + path : null;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

// person: { name, avatarUrl? | avatar_path? }   size: "sm" | "md" | "lg"
export function avatarHTML(person, size) {
  size = size || "md";
  var url = person && (person.avatarUrl || avatarUrl(person.avatar_path));
  if (url) {
    return '<img class="avatar avatar--' + size + '" src="' + esc(url) +
      '" alt="' + esc(person && person.name) + '" loading="lazy" />';
  }
  return '<span class="avatar avatar--initials avatar--' + size + '">' +
    initials(person && person.name) + "</span>";
}

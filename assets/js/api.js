// Need-It-Now — Supabase client + data API. All other modules go through this.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------------- Auth ---------------- */
export async function signUp({ name, email, zip, password }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, zip } },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* Current auth user (or null). */
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

/* Current user + their profile row, merged. Null if logged out. */
export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  return {
    id: user.id,
    email: user.email,
    name: (data && data.name) || "Neighbor",
    zip: (data && data.zip) || "",
    bio: (data && data.bio) || "",
    avatar_path: (data && data.avatar_path) || null,
    avatarUrl: (data && data.avatar_path)
      ? SUPABASE_URL + "/storage/v1/object/public/avatars/" + data.avatar_path : null,
    rating_avg: (data && Number(data.rating_avg)) || 0,
    rating_count: (data && data.rating_count) || 0,
  };
}

/* ---------------- Listings ---------------- */
export async function nearbyListings({ lat, lng, radius, type, q }) {
  const { data, error } = await supabase.rpc("nearby_listings", {
    origin_lat: lat,
    origin_lng: lng,
    radius_mi: radius,
    type_filter: type || "all",
    q: q || "",
  });
  if (error) throw error;
  return data || [];
}

export async function createListing(listing) {
  const profile = await getProfile();
  if (!profile) throw new Error("You must be logged in to post.");
  const { error } = await supabase.from("listings").insert({
    ...listing,
    user_id: profile.id,
    owner_name: profile.name,
  });
  if (error) throw error;
}

export async function getListing(id) {
  const { data, error } = await supabase
    .from("listings").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// Public URL for a stored listing photo path (or null).
export function listingPhotoUrl(path) {
  return path ? SUPABASE_URL + "/storage/v1/object/public/listings/" + path : null;
}

// Resize keeping aspect ratio (longest edge = maxEdge), as a JPEG blob.
function _resizeContain(file, maxEdge) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error("Image processing failed.")); }, "image/jpeg", 0.82);
    };
    img.onerror = function () { reject(new Error("Couldn't read that image.")); };
    img.src = URL.createObjectURL(file);
  });
}

// Upload one listing photo to the caller's folder; returns the stored path.
export async function uploadListingPhoto(file) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG, or WebP image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Each image must be under 10 MB.");
  const blob = await _resizeContain(file, 1280);
  const path = profile.id + "/" + Date.now() + "-" + Math.round(performance.now()) + ".jpg";
  const up = await supabase.storage.from("listings").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw up.error;
  return path;
}

export async function updateListing(id, patch) {
  const profile = await getProfile();
  if (!profile) throw new Error("You must be logged in.");
  const { error } = await supabase.from("listings").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteListing(id) {
  const { error } = await supabase.from("listings").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- Profiles & avatars ---------------- */
export async function updateProfile(patch) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  const fields = {};
  if (patch.name != null) fields.name = patch.name;
  if (patch.zip != null) fields.zip = patch.zip;
  if (patch.bio != null) fields.bio = patch.bio;
  const { error } = await supabase.from("profiles").update(fields).eq("id", profile.id);
  if (error) throw error;
}

export async function getProfileById(userId) {
  const { data, error } = await supabase.from("profiles")
    .select("id,name,zip,bio,avatar_path,created_at,rating_avg,rating_count").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listingsByUser(userId) {
  const { data, error } = await supabase.from("listings")
    .select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

function _resizeToBlob(file, size) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () {
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error("Image processing failed.")); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { reject(new Error("Couldn't read that image.")); };
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadAvatar(file) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG, or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB.");
  const blob = await _resizeToBlob(file, 512);
  const path = profile.id + "/" + Date.now() + ".jpg";
  const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", profile.id);
  if (error) throw error;
  if (profile.avatar_path) supabase.storage.from("avatars").remove([profile.avatar_path]);
  return SUPABASE_URL + "/storage/v1/object/public/avatars/" + path;
}

/* ---------------- Conversations & messages ---------------- */
export async function getOrCreateConversation(listing) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in to start a chat.");
  if (!listing.user_id) throw new Error("This is a sample listing — post your own to start chatting.");
  if (listing.user_id === profile.id) throw new Error("This is your listing — check Messages for replies.");

  const { data: found, error: e1 } = await supabase
    .from("conversations").select("*")
    .eq("listing_id", listing.id).eq("buyer_id", profile.id).maybeSingle();
  if (e1) throw e1;
  if (found) return found;

  const { data, error } = await supabase.from("conversations").insert({
    listing_id: listing.id, buyer_id: profile.id, owner_id: listing.user_id,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from("messages").select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendMessage(conversationId, body) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  const text = String(body || "").trim();
  if (!text) return null;
  const { data, error } = await supabase.from("messages").insert({
    conversation_id: conversationId, sender_id: profile.id,
    sender_name: profile.name, body: text,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export function subscribeMessages(conversationId, onInsert) {
  const channel = supabase
    .channel("messages:" + conversationId)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages",
        filter: "conversation_id=eq." + conversationId },
      function (payload) { onInsert(payload.new); })
    .subscribe();
  return function () { supabase.removeChannel(channel); };
}

export async function myConversations() {
  const profile = await getProfile();
  if (!profile) return [];
  const { data, error } = await supabase
    .from("conversations")
    .select("*, listing:listings(id,title,emoji,type,price), " +
            "buyer:profiles!conversations_buyer_id_fkey(name,avatar_path), " +
            "owner:profiles!conversations_owner_id_fkey(name,avatar_path)")
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(function (c) {
    return Object.assign({}, c, { iAmOwner: c.owner_id === profile.id, me: profile });
  });
}

/* ---------------- Reputation ---------------- */
// Confirm the deal from the caller's side only. Returns the updated conversation
// row; dealt_at is non-null once BOTH parties have confirmed.
export async function markDealt(conversationId) {
  const { data, error } = await supabase.rpc("mark_dealt", { conv_id: conversationId });
  if (error) throw error;
  return data;
}

/* ---------------- Unread / notifications ---------------- */
export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc("mark_conversation_read", { conv_id: conversationId });
  if (error) throw error;
}

export async function myUnreadCount() {
  const { data, error } = await supabase.rpc("my_unread_count");
  if (error) return null; // unknown — callers keep their current value
  return data || 0;
}

/* All message INSERTs visible to me (RLS scopes delivery to my conversations). */
export function subscribeMyMessages(onInsert) {
  const channel = supabase
    .channel("messages:mine")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      function (payload) { onInsert(payload.new); })
    .subscribe();
  return function () { supabase.removeChannel(channel); };
}

export async function getMyRating(conversationId) {
  const profile = await getProfile();
  if (!profile) return null;
  const { data } = await supabase.from("ratings")
    .select("stars,comment").eq("conversation_id", conversationId)
    .eq("rater_id", profile.id).maybeSingle();
  return data || null;
}

export async function createRating({ conversationId, rateeId, stars, comment }) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  const { error } = await supabase.from("ratings").insert({
    conversation_id: conversationId, rater_id: profile.id, ratee_id: rateeId,
    stars: stars, comment: (comment || "").trim(),
  });
  if (error) throw error;
}

export async function ratingsForUser(userId) {
  const { data, error } = await supabase.from("ratings")
    .select("stars,comment,created_at,rater:profiles!ratings_rater_id_fkey(name,avatar_path)")
    .eq("ratee_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

/* ---------------- Reporting ---------------- */
export async function createReport({ reportedUserId, reason, details, listingId, conversationId, messageId }) {
  const profile = await getProfile();
  if (!profile) throw new Error("Please log in.");
  if (reportedUserId === profile.id) throw new Error("You can't report yourself.");
  const { error } = await supabase.from("reports").insert({
    reporter_id: profile.id,
    reported_user_id: reportedUserId,
    reason: reason,
    details: (details || "").trim(),
    listing_id: listingId || null,
    conversation_id: conversationId || null,
    message_id: messageId || null,
  });
  if (error) throw error;
}

/* ---------------- Admin (read-only monitoring; RLS-gated) ---------------- */
export async function amIAdmin() {
  const user = await getUser();
  if (!user) return false;
  const { data } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !!data;
}

export async function adminListReports() {
  const { data, error } = await supabase.from("reports")
    .select("*, reporter:profiles!reports_reporter_id_fkey(name,avatar_path), " +
            "reported:profiles!reports_reported_user_id_fkey(name,avatar_path), " +
            "listing:listings(id,title)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function adminListUsers() {
  const { data, error } = await supabase.from("profiles")
    .select("id,name,zip,avatar_path,rating_avg,rating_count,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function adminListListings() {
  const { data, error } = await supabase.from("listings")
    .select("id,user_id,owner_name,type,title,price,zip,emoji,hidden,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function adminGetConversation(conversationId) {
  const { data, error } = await supabase.from("messages")
    .select("sender_name,sender_id,body,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function setReportStatus(reportId, status) {
  const { error } = await supabase.from("reports").update({ status: status }).eq("id", reportId);
  if (error) throw error;
}

export async function setListingHidden(listingId, hidden) {
  const { error } = await supabase.rpc("admin_set_listing_hidden", { listing_id: listingId, make_hidden: hidden });
  if (error) throw error;
}

export async function adminDeleteListing(listingId) {
  const { error } = await supabase.from("listings").delete().eq("id", listingId);
  if (error) throw error;
}

export async function banUser(userId, reason) {
  const { error } = await supabase.from("banned_users").insert({ user_id: userId, reason: (reason || "").trim() });
  if (error) throw error;
}

export async function unbanUser(userId) {
  const { error } = await supabase.from("banned_users").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function adminListBanned() {
  const { data, error } = await supabase.from("banned_users").select("user_id,reason");
  if (error) throw error;
  return data || [];
}

/* ---------------- Site settings ---------------- */
export async function getSettings() {
  const { data, error } = await supabase.from("app_settings").select("key,value");
  if (error) throw error;
  const out = {};
  (data || []).forEach(function (r) { out[r.key] = r.value; });
  return out;
}

export async function adminSetSetting(key, value) {
  const { error } = await supabase.from("app_settings")
    .upsert({ key: key, value: value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/* ---------------- Categories ---------------- */
export async function getCategories() {
  const { data, error } = await supabase.from("categories")
    .select("value,label,emoji,sort").order("sort", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function adminSaveCategory({ value, label, emoji, sort }) {
  const { error } = await supabase.from("categories")
    .upsert({ value: value, label: label, emoji: emoji || "📦", sort: sort || 0 });
  if (error) throw error;
}

export async function adminDeleteCategory(value) {
  const { error } = await supabase.from("categories").delete().eq("value", value);
  if (error) throw error;
}

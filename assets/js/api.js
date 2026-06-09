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
    .select("id,name,zip,bio,avatar_path,created_at").eq("id", userId).maybeSingle();
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

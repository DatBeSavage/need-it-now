// Need-It-Now — front-end config.
// The publishable key is meant to be public; Row-Level Security protects data.
export const SUPABASE_URL = "https://yubhbztyprfupvjwxwmm.supabase.co";
export const SUPABASE_KEY = "sb_publishable_1buvJuRw3P6XyrD8sObfSA_uxEU0Tnz";

// Sample ZIP -> coordinates table for the demo (Austin, TX metro + a few far ones).
export const ZIPS = {
  "78701": { city: "Austin (Downtown), TX", lat: 30.2711, lng: -97.7437 },
  "78704": { city: "Austin (South), TX",     lat: 30.2426, lng: -97.7684 },
  "78745": { city: "Austin (Southwest), TX", lat: 30.2073, lng: -97.7990 },
  "78758": { city: "Austin (North), TX",     lat: 30.3896, lng: -97.7102 },
  "78660": { city: "Pflugerville, TX",       lat: 30.4394, lng: -97.6200 },
  "78664": { city: "Round Rock, TX",         lat: 30.5083, lng: -97.6789 },
  "78626": { city: "Georgetown, TX",         lat: 30.6333, lng: -97.6772 },
  "78610": { city: "Buda, TX",               lat: 30.0855, lng: -97.8403 },
  "78640": { city: "Kyle, TX",               lat: 29.9891, lng: -97.8772 },
  "78205": { city: "San Antonio, TX",        lat: 29.4246, lng: -98.4951 },
  "75201": { city: "Dallas, TX",             lat: 32.7876, lng: -96.7990 },
  "77002": { city: "Houston, TX",            lat: 29.7589, lng: -95.3677 },
};

// ZIP resolution — every US ZIP via Zippopotam.us, with caching.
// The known ZIPS above seed an instant, offline cache; anything else is fetched
// once and remembered (in-memory + localStorage) so repeat lookups are instant.
var _mem = Object.assign({}, ZIPS);
var LS_KEY = "nin_zipcache_v1";

function _loadLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) { return {}; }
}
function _saveLS() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_ls)); } catch (e) { /* quota/full */ }
}
var _ls = _loadLS();

function _norm(zip) {
  return String(zip || "").replace(/[^0-9]/g, "").slice(0, 5);
}

// Synchronous: returns a coord only if it's already known/cached (no network).
export function zipCoord(zip) {
  var z = _norm(zip);
  return _mem[z] || _ls[z] || null;
}

// Everything we can suggest right now: seeded cities + every ZIP resolved so far.
export function cachedZips() {
  return Object.assign({}, _ls, _mem);
}

// Async: resolves ANY valid US ZIP to { city, lat, lng }, or null if invalid.
// Checks the in-memory + localStorage cache first; only hits the network on a miss.
export async function resolveZip(zip) {
  var z = _norm(zip);
  if (z.length !== 5) return null;
  var hit = _mem[z] || _ls[z];
  if (hit) return hit;
  try {
    var res = await fetch("https://api.zippopotam.us/us/" + z);
    if (!res.ok) return null; // 404 = not a real US ZIP
    var data = await res.json();
    var p = data.places && data.places[0];
    if (!p) return null;
    var coord = {
      city: p["place name"] + ", " + p["state abbreviation"],
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
    };
    _mem[z] = coord; _ls[z] = coord; _saveLS();
    return coord;
  } catch (e) {
    return null; // offline / network error
  }
}

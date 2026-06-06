/* Need-It-Now — data layer (browser localStorage)
   Prototype only: this is NOT secure storage. A real app needs a server. */
(function (global) {
  "use strict";

  var KEYS = {
    users: "nin_users",
    listings: "nin_listings",
    responses: "nin_responses",
    session: "nin_session",
  };

  function read(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---- ZIP coordinates (sample set for the demo) ---- */
  var ZIPS = {
    "78701": { city: "Austin (Downtown), TX",  lat: 30.2711, lng: -97.7437 },
    "78704": { city: "Austin (South), TX",      lat: 30.2426, lng: -97.7684 },
    "78745": { city: "Austin (Southwest), TX",  lat: 30.2073, lng: -97.7990 },
    "78758": { city: "Austin (North), TX",      lat: 30.3896, lng: -97.7102 },
    "78660": { city: "Pflugerville, TX",        lat: 30.4394, lng: -97.6200 },
    "78664": { city: "Round Rock, TX",          lat: 30.5083, lng: -97.6789 },
    "78626": { city: "Georgetown, TX",          lat: 30.6333, lng: -97.6772 },
    "78610": { city: "Buda, TX",                lat: 30.0855, lng: -97.8403 },
    "78640": { city: "Kyle, TX",                lat: 29.9891, lng: -97.8772 },
    "78205": { city: "San Antonio, TX",         lat: 29.4246, lng: -98.4951 },
    "75201": { city: "Dallas, TX",              lat: 32.7876, lng: -96.7990 },
    "77002": { city: "Houston, TX",             lat: 29.7589, lng: -95.3677 },
  };

  function toRad(d) { return (d * Math.PI) / 180; }
  function distanceMiles(a, b) {
    if (!a || !b) return null;
    var R = 3958.8;
    var dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function zipCoord(zip) { return ZIPS[String(zip).trim()] || null; }

  var NIN = {
    KEYS: KEYS,
    ZIPS: ZIPS,
    zipCoord: zipCoord,
    distanceMiles: distanceMiles,

    /* users */
    getUsers: function () { return read(KEYS.users, []); },
    findUser: function (email) {
      email = String(email || "").toLowerCase().trim();
      return this.getUsers().filter(function (u) { return u.email === email; })[0] || null;
    },
    addUser: function (user) {
      var users = this.getUsers();
      user.id = uid();
      user.email = String(user.email).toLowerCase().trim();
      users.push(user);
      write(KEYS.users, users);
      return user;
    },

    /* session */
    getSession: function () {
      var s = read(KEYS.session, null);
      if (!s) return null;
      return this.getUsers().filter(function (u) { return u.id === s.userId; })[0] || null;
    },
    setSession: function (userId) { write(KEYS.session, { userId: userId }); },
    clearSession: function () { localStorage.removeItem(KEYS.session); },

    /* listings */
    getListings: function () { return read(KEYS.listings, []); },
    addListing: function (data) {
      var listings = this.getListings();
      data.id = uid();
      data.createdAt = Date.now();
      data.responses = 0;
      listings.unshift(data);
      write(KEYS.listings, listings);
      return data;
    },
    getListing: function (id) {
      return this.getListings().filter(function (l) { return l.id === id; })[0] || null;
    },

    /* responses */
    addResponse: function (listingId, payload) {
      var responses = read(KEYS.responses, []);
      payload.id = uid();
      payload.listingId = listingId;
      payload.createdAt = Date.now();
      responses.push(payload);
      write(KEYS.responses, responses);
      var listings = this.getListings();
      for (var i = 0; i < listings.length; i++) {
        if (listings[i].id === listingId) { listings[i].responses = (listings[i].responses || 0) + 1; }
      }
      write(KEYS.listings, listings);
      return payload;
    },

    seed: function (users, listings) {
      if (!localStorage.getItem(KEYS.users)) write(KEYS.users, users);
      if (!localStorage.getItem(KEYS.listings)) write(KEYS.listings, listings);
    },
    reset: function () {
      Object.keys(KEYS).forEach(function (k) { localStorage.removeItem(KEYS[k]); });
    },
  };

  global.NIN = NIN;
})(window);

/* Need-It-Now — sample data so the feed looks alive on first visit. */
(function () {
  "use strict";
  var HOUR = 3600 * 1000;
  var now = Date.now();

  var users = [
    { id: "u_demo",  name: "Demo User",   email: "demo@needitnow.app", zip: "78701", password: "demo1234" },
    { id: "u_maria", name: "Maria Lopez", email: "maria@example.com",  zip: "78704", password: "x" },
    { id: "u_devon", name: "Devon Reed",  email: "devon@example.com",  zip: "78664", password: "x" },
    { id: "u_aisha", name: "Aisha Khan",  email: "aisha@example.com",  zip: "78758", password: "x" },
    { id: "u_sam",   name: "Sam Carter",  email: "sam@example.com",    zip: "78610", password: "x" },
  ];

  // type: "sell" (for sale) | "buy" (looking to buy)
  var listings = [
    { id: "l1", type: "sell", title: "2015 Honda Civic EX", emoji: "🚗",
      desc: "One owner, 78k miles, clean title, new tires. Runs great, no issues.",
      price: 8500, ownerName: "Maria Lopez", zip: "78704", createdAt: now - 2 * HOUR, responses: 3 },
    { id: "l2", type: "buy", title: "Looking for a used road bike", emoji: "🚲",
      desc: "Want a 54–56cm road bike for commuting. Prefer Trek or Specialized. Cash ready.",
      price: 300, ownerName: "Devon Reed", zip: "78664", createdAt: now - 5 * HOUR, responses: 1 },
    { id: "l3", type: "sell", title: "IKEA sofa — barely used", emoji: "🛋️",
      desc: "Gray 3-seater, super comfy, moving out so it has to go. You haul.",
      price: 180, ownerName: "Aisha Khan", zip: "78758", createdAt: now - 26 * HOUR, responses: 0 },
    { id: "l4", type: "buy", title: "Need a working lawn mower", emoji: "🌱",
      desc: "Gas or electric, just needs to cut grass. Under $120 ideally. Can pick up this weekend.",
      price: 120, ownerName: "Sam Carter", zip: "78610", createdAt: now - 30 * HOUR, responses: 2 },
    { id: "l5", type: "sell", title: "iPhone 13 — 128GB, unlocked", emoji: "📱",
      desc: "Midnight black, 88% battery, no scratches, includes case + charger.",
      price: 360, ownerName: "Maria Lopez", zip: "78704", createdAt: now - 8 * HOUR, responses: 5 },
    { id: "l6", type: "sell", title: "Solid oak dining table + 4 chairs", emoji: "🪑",
      desc: "Heavy, real wood, seats 6 with a leaf. Great condition.",
      price: 240, ownerName: "Devon Reed", zip: "78626", createdAt: now - 49 * HOUR, responses: 1 },
    { id: "l7", type: "buy", title: "Wanted: PS5 (disc edition)", emoji: "🎮",
      desc: "Looking for a PS5 in good shape, controller a plus. Local pickup, paying fair price.",
      price: 400, ownerName: "Aisha Khan", zip: "78758", createdAt: now - 3 * HOUR, responses: 4 },
    { id: "l8", type: "sell", title: "Trek mountain bike — 27.5\"", emoji: "🚵",
      desc: "Hardtail, hydraulic disc brakes, recently tuned. Selling — Dallas pickup only.",
      price: 520, ownerName: "Sam Carter", zip: "75201", createdAt: now - 12 * HOUR, responses: 0 },
  ];

  if (window.NIN) { window.NIN.seed(users, listings); }
})();

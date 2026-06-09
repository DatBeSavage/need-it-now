-- Need-It-Now — sample listings so the feed looks alive.
-- Run AFTER schema.sql. Re-running clears demo rows (user_id is null) and re-inserts.

delete from public.listings where user_id is null;

insert into public.listings
  (user_id, owner_name, type, title, description, price, category, emoji, zip, lat, lng, response_count, created_at)
values
  (null, 'Maria Lopez', 'sell', '2015 Honda Civic EX',
   'One owner, 78k miles, clean title, new tires. Runs great, no issues.',
   8500, 'car', '🚗', '78704', 30.2426, -97.7684, 3, now() - interval '2 hours'),

  (null, 'Devon Reed', 'buy', 'Looking for a used road bike',
   'Want a 54–56cm road bike for commuting. Prefer Trek or Specialized. Cash ready.',
   300, 'bike', '🚲', '78664', 30.5083, -97.6789, 1, now() - interval '5 hours'),

  (null, 'Aisha Khan', 'sell', 'IKEA sofa — barely used',
   'Gray 3-seater, super comfy, moving out so it has to go. You haul.',
   180, 'furniture', '🛋️', '78758', 30.3896, -97.7102, 0, now() - interval '26 hours'),

  (null, 'Sam Carter', 'buy', 'Need a working lawn mower',
   'Gas or electric, just needs to cut grass. Under $120 ideally. Can pick up this weekend.',
   120, 'garden', '🌱', '78610', 30.0855, -97.8403, 2, now() - interval '30 hours'),

  (null, 'Maria Lopez', 'sell', 'iPhone 13 — 128GB, unlocked',
   'Midnight black, 88% battery, no scratches, includes case + charger.',
   360, 'phone', '📱', '78704', 30.2426, -97.7684, 5, now() - interval '8 hours'),

  (null, 'Devon Reed', 'sell', 'Solid oak dining table + 4 chairs',
   'Heavy, real wood, seats 6 with a leaf. Great condition.',
   240, 'furniture', '🪑', '78626', 30.6333, -97.6772, 1, now() - interval '49 hours'),

  (null, 'Aisha Khan', 'buy', 'Wanted: PS5 (disc edition)',
   'Looking for a PS5 in good shape, controller a plus. Local pickup, paying fair price.',
   400, 'game', '🎮', '78758', 30.3896, -97.7102, 4, now() - interval '3 hours'),

  (null, 'Sam Carter', 'sell', 'Trek mountain bike — 27.5"',
   'Hardtail, hydraulic disc brakes, recently tuned. Selling — Dallas pickup only.',
   520, 'bike', '🚵', '75201', 32.7876, -96.7990, 0, now() - interval '12 hours');

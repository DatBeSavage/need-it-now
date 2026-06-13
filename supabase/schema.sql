-- Need-It-Now — Supabase schema
-- Run this in the Supabase SQL Editor (one time). Safe to re-run.

-- ============================================================
-- Tables
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  zip         text,
  created_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists rating_avg numeric(3,2) not null default 0;
alter table public.profiles add column if not exists rating_count int not null default 0;

create table if not exists public.listings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.profiles (id) on delete set null,
  owner_name     text not null,
  type           text not null check (type in ('sell','buy')),
  title          text not null,
  description    text not null default '',
  price          integer not null default 0,
  category       text,
  emoji          text,
  zip            text,
  lat            double precision,
  lng            double precision,
  response_count integer not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.listings add column if not exists hidden boolean not null default false;
-- Up to a few photo paths (in the public 'listings' storage bucket), first is the cover.
alter table public.listings add column if not exists photos text[] not null default '{}';

create index if not exists listings_type_idx       on public.listings (type);
create index if not exists listings_created_idx     on public.listings (created_at desc);

-- ============================================================
-- Row-Level Security
-- ============================================================
alter table public.profiles  enable row level security;
alter table public.listings  enable row level security;

-- profiles: world-readable; you manage only your own
drop policy if exists "profiles_select_all"   on public.profiles;
drop policy if exists "profiles_insert_own"    on public.profiles;
drop policy if exists "profiles_update_own"    on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Column-level lock: a user may only edit these fields on their own profile.
-- RLS is row-level only, so without this a user could PATCH rating_avg /
-- rating_count (forging reputation) or inject markup into avatar_path.
-- rating_avg / rating_count are written solely by the recompute_rating trigger.
revoke update on public.profiles from anon, authenticated;
grant  update (name, zip, bio, avatar_path) on public.profiles to authenticated;

-- listings: world-readable; insert/update/delete only your own
drop policy if exists "listings_select_all"  on public.listings;
drop policy if exists "listings_insert_own"  on public.listings;
drop policy if exists "listings_update_own"  on public.listings;
drop policy if exists "listings_delete_own"  on public.listings;
create policy "listings_select_all" on public.listings for select using (true);
create policy "listings_insert_own" on public.listings for insert with check (auth.uid() = user_id);
-- Owner-only update. WITH CHECK stops a user reassigning user_id / owner_name to
-- another account. Admin moderation (hide/unhide) goes through admin_set_listing_hidden()
-- so an owner can't simply un-hide a listing a moderator hid.
create policy "listings_update_own" on public.listings for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "listings_delete_own" on public.listings for delete
  using (auth.uid() = user_id or public.is_admin());

-- ============================================================
-- Admin identity  (Admin Increment A)
-- ============================================================
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- security definer: bypasses RLS on admins (avoids recursion with the policy
-- below) and only ever reports on the calling user.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins enable row level security;
drop policy if exists "admins_select" on public.admins;
create policy "admins_select" on public.admins
  for select using (user_id = auth.uid() or public.is_admin());
-- NO insert/update/delete policies: only the SQL Editor (service role) can add admins.

-- ============================================================
-- Ban identity  (Admin Increment C)
-- ============================================================
create table if not exists public.banned_users (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_banned()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.banned_users where user_id = auth.uid());
$$;

alter table public.banned_users enable row level security;
drop policy if exists "banned_select_admin" on public.banned_users;
drop policy if exists "banned_insert_admin" on public.banned_users;
drop policy if exists "banned_delete_admin" on public.banned_users;
create policy "banned_select_admin" on public.banned_users for select using (public.is_admin());
create policy "banned_insert_admin" on public.banned_users for insert with check (public.is_admin());
create policy "banned_delete_admin" on public.banned_users for delete using (public.is_admin());

-- Re-create the listings insert policy WITH the ban check (its original definition
-- sits earlier in the file, before is_banned() exists).
drop policy if exists "listings_insert_own" on public.listings;
create policy "listings_insert_own" on public.listings for insert
  with check (auth.uid() = user_id and not public.is_banned());

-- ============================================================
-- Triggers
-- ============================================================
-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, zip)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', 'Neighbor'),
    new.raw_user_meta_data ->> 'zip'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Chat: conversations + messages  (Phase 1)
-- ============================================================
-- Remove the old one-way responses mechanism (idempotent: cascade drops its trigger).
drop table if exists public.responses cascade;
drop function if exists public.bump_response_count();

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings (id) on delete cascade,
  buyer_id        uuid not null references public.profiles (id) on delete cascade,
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_body       text not null default '',
  dealt_at        timestamptz,
  unique (listing_id, buyer_id),
  check (buyer_id <> owner_id)
);
create index if not exists conversations_owner_idx   on public.conversations (owner_id);
create index if not exists conversations_buyer_idx   on public.conversations (buyer_id);
create index if not exists conversations_listing_idx on public.conversations (listing_id);
create index if not exists conversations_recent_idx  on public.conversations (last_message_at desc);

-- Two-sided deal confirmation: each party confirms their own side. dealt_at is
-- set (by the mark_dealt RPC) only once BOTH have confirmed, which in turn gates
-- who may leave a rating. Prevents one party unilaterally "closing" a deal.
alter table public.conversations add column if not exists dealt_buyer_at timestamptz;
alter table public.conversations add column if not exists dealt_owner_at timestamptz;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  sender_name     text not null,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index if not exists messages_convo_idx on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

drop policy if exists "conversations_select_party" on public.conversations;
drop policy if exists "conversations_insert_buyer" on public.conversations;
drop policy if exists "conversations_update_party" on public.conversations;
create policy "conversations_select_party" on public.conversations for select
  using (auth.uid() = buyer_id or auth.uid() = owner_id or public.is_admin());
create policy "conversations_insert_buyer" on public.conversations for insert
  with check (
    auth.uid() = buyer_id
    and buyer_id <> owner_id
    and owner_id = (select l.user_id from public.listings l where l.id = listing_id)
    and not public.is_banned()
  );
-- No direct client UPDATE on conversations. The only field a party changes is the
-- deal confirmation, and that goes through mark_dealt() (a SECURITY DEFINER RPC that
-- only ever sets the *caller's* side). last_message_at / last_body are maintained by
-- the touch_conversation trigger. With no UPDATE policy, RLS denies all client updates.

drop policy if exists "messages_select_party" on public.messages;
drop policy if exists "messages_insert_party" on public.messages;
create policy "messages_select_party" on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
    )
    or public.is_admin()
  );
create policy "messages_insert_party" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and not public.is_banned()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
    )
  );

-- Bump listings.response_count once per new conversation ("people interested").
create or replace function public.bump_interest_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.listings set response_count = response_count + 1 where id = new.listing_id;
  return new;
end; $$;
drop trigger if exists trg_bump_interest_count on public.conversations;
create trigger trg_bump_interest_count after insert on public.conversations
  for each row execute function public.bump_interest_count();

-- Keep last_message_at + last_body fresh for the inbox.
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at, last_body = new.body
   where id = new.conversation_id;
  return new;
end; $$;
drop trigger if exists trg_touch_conversation on public.messages;
create trigger trg_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- Anti-spam: max 5 messages / 10s per sender.
create or replace function public.guard_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent from public.messages
   where sender_id = new.sender_id and created_at > now() - interval '10 seconds';
  if recent >= 5 then raise exception 'Slow down — too many messages. Wait a few seconds.'; end if;
  return new;
end; $$;
drop trigger if exists trg_guard_message_rate on public.messages;
create trigger trg_guard_message_rate before insert on public.messages
  for each row execute function public.guard_message_rate();

-- Anti-spam: max 10 new conversations / hour per buyer.
create or replace function public.guard_conversation_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent from public.conversations
   where buyer_id = new.buyer_id and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'Too many new chats started — try again later.'; end if;
  return new;
end; $$;
drop trigger if exists trg_guard_conversation_rate on public.conversations;
create trigger trg_guard_conversation_rate before insert on public.conversations
  for each row execute function public.guard_conversation_rate();

-- Realtime (idempotent add to the publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then execute 'alter publication supabase_realtime add table public.messages'; end if;
end $$;

-- ============================================================
-- Reputation: ratings  (Phase 3)
-- ============================================================
create table if not exists public.ratings (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  rater_id        uuid not null references public.profiles (id) on delete cascade,
  ratee_id        uuid not null references public.profiles (id) on delete cascade,
  stars           int  not null check (stars between 1 and 5),
  comment         text not null default '',
  created_at      timestamptz not null default now(),
  unique (conversation_id, rater_id)
);
create index if not exists ratings_ratee_idx on public.ratings (ratee_id, created_at desc);

alter table public.ratings enable row level security;

drop policy if exists "ratings_select_all"   on public.ratings;
drop policy if exists "ratings_insert_party" on public.ratings;
create policy "ratings_select_all" on public.ratings for select using (true);
create policy "ratings_insert_party" on public.ratings for insert with check (
  rater_id = auth.uid()
  and not public.is_banned()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.dealt_at is not null
      and (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
      and ratee_id = case when c.buyer_id = auth.uid() then c.owner_id else c.buyer_id end
  )
);

-- Keep profiles.rating_avg / rating_count in sync.
create or replace function public.recompute_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  target := coalesce(new.ratee_id, old.ratee_id);
  update public.profiles p set
    rating_count = (select count(*) from public.ratings r where r.ratee_id = target),
    rating_avg   = coalesce((select round(avg(r.stars)::numeric, 2) from public.ratings r where r.ratee_id = target), 0)
  where p.id = target;
  return null;
end; $$;
drop trigger if exists trg_recompute_rating on public.ratings;
create trigger trg_recompute_rating
  after insert or update or delete on public.ratings
  for each row execute function public.recompute_rating();

-- ============================================================
-- Reporting: reports  (Phase 2)
-- ============================================================
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  reason           text not null check (reason in ('spam','harassment','scam','other')),
  details          text not null default '',
  listing_id       uuid references public.listings (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  message_id       uuid references public.messages (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists reports_reported_idx on public.reports (reported_user_id, created_at desc);

alter table public.reports  add column if not exists status text not null default 'open'
  check (status in ('open','resolved','dismissed'));

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert with check (
  reporter_id = auth.uid() and reporter_id <> reported_user_id
);
create policy "reports_select_own" on public.reports for select
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports for update
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- Location/radius API: nearby_listings()
-- Returns listings within radius_mi of (origin_lat, origin_lng),
-- filtered by type + search, with a computed distance, nearest first.
-- ============================================================
drop function if exists public.nearby_listings(
  double precision, double precision, double precision, text, text);

create or replace function public.nearby_listings(
  origin_lat   double precision,
  origin_lng   double precision,
  radius_mi    double precision default 25,
  type_filter  text default 'all',
  q            text default ''
)
returns table (
  id uuid, user_id uuid, owner_name text, type text, title text, description text,
  price integer, category text, emoji text, zip text, lat double precision,
  lng double precision, response_count integer, created_at timestamptz, photos text[],
  owner_avatar text, owner_rating numeric, owner_rating_count int, distance_mi double precision
)
language sql stable as $$
  select *
  from (
    select
      l.id, l.user_id, l.owner_name, l.type, l.title, l.description,
      l.price, l.category, l.emoji, l.zip, l.lat, l.lng,
      l.response_count, l.created_at, l.photos,
      p.avatar_path as owner_avatar,
      p.rating_avg  as owner_rating,
      p.rating_count as owner_rating_count,
      case
        when l.lat is null or l.lng is null
          or origin_lat is null or origin_lng is null then null
        else 3958.8 * 2 * asin(sqrt(
          power(sin(radians(l.lat - origin_lat) / 2), 2)
          + cos(radians(origin_lat)) * cos(radians(l.lat))
          * power(sin(radians(l.lng - origin_lng) / 2), 2)
        ))
      end as distance_mi
    from public.listings l
    left join public.profiles p on p.id = l.user_id
    where (type_filter = 'all' or l.type = type_filter)
      and not l.hidden
      and (
        coalesce(q, '') = ''
        or l.title ilike '%' || q || '%'
        or l.description ilike '%' || q || '%'
      )
  ) sub
  where sub.distance_mi is null or sub.distance_mi <= radius_mi
  order by sub.distance_mi asc nulls last, sub.created_at desc;
$$;

grant execute on function public.nearby_listings(
  double precision, double precision, double precision, text, text
) to anon, authenticated;

-- ============================================================
-- Avatars storage bucket (public read; users write only their own folder)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_insert_own"  on storage.objects;
drop policy if exists "avatars_update_own"  on storage.objects;
drop policy if exists "avatars_delete_own"  on storage.objects;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

-- ============================================================
-- Site settings + rules  (Admin Increment D)
-- ============================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings_select_all"  on public.app_settings;
drop policy if exists "settings_insert_admin" on public.app_settings;
drop policy if exists "settings_update_admin" on public.app_settings;
create policy "settings_select_all"  on public.app_settings for select using (true);
create policy "settings_insert_admin" on public.app_settings for insert with check (public.is_admin());
create policy "settings_update_admin" on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values
  ('max_listings_per_day', '0'),
  ('banned_words', ''),
  ('guidelines', 'Be respectful. No scams or illegal items. Meet in public, well-lit places and trust your instincts.')
on conflict (key) do nothing;

-- Daily listing limit (0/blank = unlimited; admins exempt).
create or replace function public.guard_daily_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int;
begin
  select nullif(btrim(value), '')::int into lim from public.app_settings where key = 'max_listings_per_day';
  if lim is null or lim <= 0 then return new; end if;
  if public.is_admin() then return new; end if;
  select count(*) into cnt from public.listings
    where user_id = new.user_id and created_at > now() - interval '24 hours';
  if cnt >= lim then raise exception 'Daily listing limit reached (% per day).', lim; end if;
  return new;
end; $$;
drop trigger if exists trg_daily_listing_limit on public.listings;
create trigger trg_daily_listing_limit before insert on public.listings
  for each row execute function public.guard_daily_listing_limit();

-- Banned-words filter on listing title + description.
create or replace function public.guard_banned_words()
returns trigger language plpgsql security definer set search_path = public as $$
declare words text; w text; hay text;
begin
  select value into words from public.app_settings where key = 'banned_words';
  if words is null or btrim(words) = '' then return new; end if;
  hay := lower(coalesce(new.title,'') || ' ' || coalesce(new.description,''));
  foreach w in array string_to_array(lower(words), ',') loop
    w := btrim(w);
    if w <> '' and position(w in hay) > 0 then
      raise exception 'Your listing contains a blocked word.';
    end if;
  end loop;
  return new;
end; $$;
drop trigger if exists trg_banned_words on public.listings;
create trigger trg_banned_words before insert on public.listings
  for each row execute function public.guard_banned_words();

-- ============================================================
-- Categories  (Admin D2 — editable)
-- ============================================================
create table if not exists public.categories (
  value      text primary key,
  label      text not null,
  emoji      text not null default '📦',
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
drop policy if exists "categories_select_all"  on public.categories;
drop policy if exists "categories_insert_admin" on public.categories;
drop policy if exists "categories_update_admin" on public.categories;
drop policy if exists "categories_delete_admin" on public.categories;
create policy "categories_select_all"  on public.categories for select using (true);
create policy "categories_insert_admin" on public.categories for insert with check (public.is_admin());
create policy "categories_update_admin" on public.categories for update using (public.is_admin()) with check (public.is_admin());
create policy "categories_delete_admin" on public.categories for delete using (public.is_admin());

insert into public.categories (value, label, emoji, sort) values
  ('car','Cars & vehicles','🚗',1),
  ('bike','Bikes','🚲',2),
  ('phone','Phones & electronics','📱',3),
  ('furniture','Furniture','🛋️',4),
  ('game','Games & consoles','🎮',5),
  ('tool','Tools','🛠️',6),
  ('garden','Garden & outdoor','🌱',7),
  ('other','Other','📦',8)
on conflict (value) do nothing;

-- ============================================================
-- Hardening: column-level write lock on listings
-- ============================================================
-- A user may only edit the content fields of their own listing. Without this,
-- the row-level policy alone would still let them rewrite owner_name / user_id /
-- response_count / hidden directly via the REST API.
-- response_count is maintained by bump_interest_count; hidden by admin_set_listing_hidden.
revoke update on public.listings from anon, authenticated;
grant  update (type, title, description, price, category, emoji, zip, lat, lng, photos)
  on public.listings to authenticated;

-- ============================================================
-- Admin moderation: hide/unhide a listing (admin-only, bypasses the column lock)
-- ============================================================
create or replace function public.admin_set_listing_hidden(listing_id uuid, make_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.listings set hidden = make_hidden where id = listing_id;
end; $$;
revoke execute on function public.admin_set_listing_hidden(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_listing_hidden(uuid, boolean) to authenticated;

-- ============================================================
-- Two-sided deal confirmation RPC
-- ============================================================
-- Sets ONLY the calling party's confirmation, then promotes dealt_at once both
-- sides are in. Returns the updated conversation row.
create or replace function public.mark_dealt(conv_id uuid)
returns public.conversations
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = conv_id;
  if not found then raise exception 'Conversation not found'; end if;
  if auth.uid() <> c.buyer_id and auth.uid() <> c.owner_id then
    raise exception 'Not authorized';
  end if;

  if auth.uid() = c.buyer_id then
    update public.conversations set dealt_buyer_at = coalesce(dealt_buyer_at, now()) where id = conv_id;
  else
    update public.conversations set dealt_owner_at = coalesce(dealt_owner_at, now()) where id = conv_id;
  end if;

  update public.conversations
     set dealt_at = case when dealt_buyer_at is not null and dealt_owner_at is not null
                         then coalesce(dealt_at, now()) end
   where id = conv_id
   returning * into c;
  return c;
end; $$;
revoke execute on function public.mark_dealt(uuid) from public, anon;
grant  execute on function public.mark_dealt(uuid) to authenticated;

-- ============================================================
-- Listing photos storage bucket (public read; users write only their own folder)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('listings', 'listings', true)
on conflict (id) do nothing;

drop policy if exists "listings_photos_read"   on storage.objects;
drop policy if exists "listings_photos_insert"  on storage.objects;
drop policy if exists "listings_photos_update"  on storage.objects;
drop policy if exists "listings_photos_delete"  on storage.objects;

create policy "listings_photos_read" on storage.objects
  for select using (bucket_id = 'listings');
create policy "listings_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listings' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "listings_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'listings' and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'listings' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "listings_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'listings' and (storage.foldername(name))[1] = (auth.uid())::text);

-- ============================================================
-- Unread tracking: per-side read markers (clients have no UPDATE
-- grant on these; only the RPC below writes them — same model as
-- mark_dealt / dealt_*_at).
-- ============================================================
alter table public.conversations add column if not exists buyer_read_at timestamptz;
alter table public.conversations add column if not exists owner_read_at timestamptz;

-- Sets ONLY the calling party's read marker.
create or replace function public.mark_conversation_read(conv_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = conv_id;
  if not found then raise exception 'Conversation not found'; end if;
  if auth.uid() = c.buyer_id then
    update public.conversations set buyer_read_at = now() where id = conv_id;
  elsif auth.uid() = c.owner_id then
    update public.conversations set owner_read_at = now() where id = conv_id;
  else
    raise exception 'Not authorized';
  end if;
end; $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;

-- Conversations holding a message from the OTHER party newer than my marker.
create or replace function public.my_unread_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.conversations c
  where (c.buyer_id = auth.uid() or c.owner_id = auth.uid())
    and exists (
      select 1 from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(
          case when c.buyer_id = auth.uid() then c.buyer_read_at else c.owner_read_at end,
          'epoch'::timestamptz)
    );
$$;
revoke execute on function public.my_unread_count() from public, anon;
grant  execute on function public.my_unread_count() to authenticated;

-- ============================================================
-- Saves (favorites): each user's saved listings. Owner-only rows.
-- ============================================================
create table if not exists public.saves (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.saves enable row level security;
drop policy if exists "saves_select_own" on public.saves;
drop policy if exists "saves_insert_own" on public.saves;
drop policy if exists "saves_delete_own" on public.saves;
create policy "saves_select_own" on public.saves for select using (auth.uid() = user_id);
create policy "saves_insert_own" on public.saves for insert
  with check (auth.uid() = user_id and not public.is_banned());
create policy "saves_delete_own" on public.saves for delete using (auth.uid() = user_id);
grant select, insert, delete on public.saves to authenticated;

-- Realtime: new-listing INSERTs power the feed's "Show N new" pill.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listings'
  ) then execute 'alter publication supabase_realtime add table public.listings'; end if;
end $$;

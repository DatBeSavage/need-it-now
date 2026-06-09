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
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- listings: world-readable; insert/update/delete only your own
drop policy if exists "listings_select_all"  on public.listings;
drop policy if exists "listings_insert_own"  on public.listings;
drop policy if exists "listings_update_own"  on public.listings;
drop policy if exists "listings_delete_own"  on public.listings;
create policy "listings_select_all" on public.listings for select using (true);
create policy "listings_insert_own" on public.listings for insert with check (auth.uid() = user_id);
create policy "listings_update_own" on public.listings for update using (auth.uid() = user_id);
create policy "listings_delete_own" on public.listings for delete using (auth.uid() = user_id);

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
  );
create policy "conversations_update_party" on public.conversations for update
  using (auth.uid() = buyer_id or auth.uid() = owner_id)
  with check (auth.uid() = buyer_id or auth.uid() = owner_id);

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

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert with check (
  reporter_id = auth.uid() and reporter_id <> reported_user_id
);
create policy "reports_select_own" on public.reports for select
  using (reporter_id = auth.uid() or public.is_admin());

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
  lng double precision, response_count integer, created_at timestamptz,
  owner_avatar text, owner_rating numeric, owner_rating_count int, distance_mi double precision
)
language sql stable as $$
  select *
  from (
    select
      l.id, l.user_id, l.owner_name, l.type, l.title, l.description,
      l.price, l.category, l.emoji, l.zip, l.lat, l.lng,
      l.response_count, l.created_at,
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

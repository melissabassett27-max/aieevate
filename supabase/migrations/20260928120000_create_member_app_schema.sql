-- migration: create the ai elevate member app schema
-- purpose: real data layer for member accounts, bot evaluations and payouts.
--          the public sell-account and join flows are handled by Netlify Functions, so this
--          migration covers the signed-in member dashboard only.
-- affected tables: profiles, managed_accounts, bot_evaluations, task_payouts (all new)

-- ---------------------------------------------------------------------------
-- profiles: one row per member, extends auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  country text,
  phone text,
  payout_method text,
  wallet_address text,
  stars int not null default 0 check (stars between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- a member can read only their own profile
create policy "Members can view own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- a member can create their own profile row (normally done by the signup trigger)
create policy "Members can insert own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- a member can update only their own profile
create policy "Members can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- managed_accounts: the platform logins assigned to a member
-- ---------------------------------------------------------------------------
create table public.managed_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  account_ref text,
  status text not null default 'In verification',
  stars int not null default 0 check (stars between 0 and 5),
  tasks_this_week int not null default 0,
  monthly_earnings numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index managed_accounts_user_id_idx on public.managed_accounts(user_id);

alter table public.managed_accounts enable row level security;

create policy "Members can view own accounts"
  on public.managed_accounts for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Members can create own accounts"
  on public.managed_accounts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Members can update own accounts"
  on public.managed_accounts for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Members can delete own accounts"
  on public.managed_accounts for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- bot_evaluations: the qa/verification bot's log for a member's accounts
-- ---------------------------------------------------------------------------
create table public.bot_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.managed_accounts(id) on delete cascade,
  account_ref text,
  verdict text not null,
  detail text,
  quality int check (quality between 0 and 100),
  created_at timestamptz not null default now()
);

create index bot_evaluations_user_id_idx on public.bot_evaluations(user_id);

alter table public.bot_evaluations enable row level security;

create policy "Members can view own evaluations"
  on public.bot_evaluations for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Members can create own evaluations"
  on public.bot_evaluations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Members can delete own evaluations"
  on public.bot_evaluations for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- task_payouts: weekly payouts with the 90/10 split already applied
-- ---------------------------------------------------------------------------
create table public.task_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  gross numeric(10, 2) not null default 0,
  member_share numeric(10, 2) not null default 0,
  platform_fee numeric(10, 2) not null default 0,
  method text,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create index task_payouts_user_id_idx on public.task_payouts(user_id);

alter table public.task_payouts enable row level security;

create policy "Members can view own payouts"
  on public.task_payouts for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Members can create own payouts"
  on public.task_payouts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- signup trigger: create a profile row for every new member
-- security definer runs as the owner, so pin search_path and revoke execute.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

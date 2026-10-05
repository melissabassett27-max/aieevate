alter table public.team_applications
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  add column payment_status text not null default 'not_due'
    check (payment_status in ('not_due', 'pending', 'paid', 'rejected')),
  add column payment_reference text unique,
  add column payment_checkout_url text,
  add column payment_checkout_started_at timestamptz,
  add column payment_amount bigint,
  add column payment_currency text,
  add column approved_at timestamptz,
  add column paid_at timestamptz;

alter table public.account_sale_submissions
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  add column seller_payment_status text not null default 'not_due'
    check (seller_payment_status in ('not_due', 'pending', 'paid', 'rejected')),
  add column reviewed_at timestamptz,
  add column seller_paid_at timestamptz;

alter table public.profiles
  add column membership_status text not null default 'unpaid'
    check (membership_status in ('unpaid', 'active'));

drop policy if exists "Members can insert own profile" on public.profiles;
drop policy if exists "Members can update own profile" on public.profiles;
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "Members can view own accounts" on public.managed_accounts;
create policy "Paid members can view own accounts"
  on public.managed_accounts for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and membership_status = 'active'
    )
  );

drop policy if exists "Members can view own evaluations" on public.bot_evaluations;
create policy "Paid members can view own evaluations"
  on public.bot_evaluations for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and membership_status = 'active'
    )
  );

drop policy if exists "Members can view own payouts" on public.task_payouts;
create policy "Paid members can view own payouts"
  on public.task_payouts for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and membership_status = 'active'
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, membership_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (
      select 1
      from public.team_applications application
      where lower(application.data ->> 'email') = lower(new.email)
        and application.payment_status = 'paid'
    ) then 'active' else 'unpaid' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant select, insert, update on table public.team_applications to service_role;
grant select, insert, update on table public.account_sale_submissions to service_role;
grant select, insert, update on table public.profiles to service_role;
create table public.account_sale_submissions (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table public.team_applications (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.account_sale_submissions enable row level security;
alter table public.team_applications enable row level security;

revoke all on public.account_sale_submissions from anon, authenticated;
revoke all on public.team_applications from anon, authenticated;
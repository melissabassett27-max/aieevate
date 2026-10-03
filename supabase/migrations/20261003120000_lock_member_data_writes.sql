-- Operational account, evaluation, and payout records must be written by trusted server workflows.
drop policy if exists "Members can create own accounts" on public.managed_accounts;
drop policy if exists "Members can update own accounts" on public.managed_accounts;
drop policy if exists "Members can delete own accounts" on public.managed_accounts;
drop policy if exists "Members can create own evaluations" on public.bot_evaluations;
drop policy if exists "Members can delete own evaluations" on public.bot_evaluations;
drop policy if exists "Members can create own payouts" on public.task_payouts;

revoke insert, update, delete on table public.managed_accounts from authenticated;
revoke insert, update, delete on table public.bot_evaluations from authenticated;
revoke insert, update, delete on table public.task_payouts from authenticated;
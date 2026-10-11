-- Switch team membership checkout from the earlier Paystack prototype to AllPays.
-- AllPays returns a per-payment-link secret; it stays server-side in this RLS-protected table.
alter table public.team_applications
  add column payment_provider text
    check (payment_provider = 'allpays'),
  add column payment_provider_id text,
  add column payment_provider_secret text,
  add column payment_attempt_hash text,
  add column payment_fee_payer text not null default 'merchant'
    check (payment_fee_payer in ('customer', 'merchant'));

-- Old pending references came from the Paystack prototype and cannot be verified with AllPays.
update public.team_applications
set payment_status = 'not_due',
    payment_reference = null,
    payment_checkout_url = null,
    payment_checkout_started_at = null,
    payment_amount = null,
    payment_currency = null
where payment_status = 'pending'
  and payment_provider_id is null;

revoke all on public.team_applications from anon, authenticated;
grant select, insert, update on public.team_applications to service_role;

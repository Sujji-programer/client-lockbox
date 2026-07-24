# ClientLockbox — Phase 2 SQL Migration

> **Idempotent. Safe to re-run.** Paste the SQL block below into
> **Supabase Dashboard → SQL Editor → New query → Run**.
>
> ⚠️ **Review by user required before running — do NOT auto-execute.**
> This migration:
> 1. Adds Stripe Connect columns to `profiles`.
> 2. Reshapes `invoices` for the 60-second clientflow (scope_of_work, currency, due_date, terms, signature, accepted_at, reminders_sent).
> 3. Drops the Phase-1 GEO clutter + relaxes the file_path NOT-NULL.
> 4. Creates `fee_ledger` + `fee_transactions` tables + RLS.
> 5. Defines the `compute_fee_cents()` security-definer RPC that atomically
>    enforces the **5% fee capped at $30 per freelancer per calendar month**.

```sql
-- ============================================================================
-- ClientLockbox — Phase 2 SQL Migration (Stripe Connect + Capped 5% fee ledger)
-- Idempotent; safe to re-run.
-- ============================================================================

-- 0. extensions --------------------------------------------------------------
create extension if not exists pgcrypto;

-- 1. profiles additions ------------------------------------------------------
alter table public.profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_account_status text not null default 'PENDING'
    check (stripe_account_status in ('PENDING','RESTRICTED','ENABLED')),
  -- Boolean mirror of stripe_account_status == 'ENABLED': true once Stripe
  -- reports charges_enabled=true AND details_submitted=true (set by the
  -- `account.updated` webhook). Kept as a cheap, index-friendly predicate for
  -- the dashboard "Connect Stripe" gate so we don't have to re-derive the
  -- enum on every read.
  add column if not exists stripe_onboarding_complete boolean not null default false;

-- 2. invoices reshape --------------------------------------------------------
alter table public.invoices
  add column if not exists scope_of_work text,
  add column if not exists currency       text not null default 'usd',
  add column if not exists due_date        date,
  add column if not exists terms           text,
  add column if not exists signature       text,
  add column if not exists accepted_at     timestamptz,
  add column if not exists reminders_sent  int[] not null default '{}',
  -- Stripe bookkeeping: persist the PaymentIntent + Destination Charge Transfer
  -- ids on the invoice row at payment time so the webhook can reconcile without
  -- extra joins. Both nullable until the invoice transitions to PAID.
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_transfer_id      text;

-- Quick idempotency / reconciliation lookup on the PaymentIntent id.
create index if not exists invoices_stripe_payment_intent_idx
  on public.invoices (stripe_payment_intent_id);

-- Drop Phase-1 GEO clutter (no longer part of the 60-second clientflow).
alter table public.invoices drop column if exists target_keywords;
alter table public.invoices drop column if exists ai_engines;
alter table public.invoices drop column if exists share_of_voice;
alter table public.invoices drop column if exists citation_snippet;

-- file_path kept for backwards compat with legacy PAID rows, but no longer mandatory.
alter table public.invoices alter column file_path drop not null;

-- Relax the total constraint (legacy had a NOT VALID version).
do $$
begin
  if exists (select 1 from pg_constraint where conname='invoices_total_matches_components') then
    alter table public.invoices
      drop constraint if exists invoices_total_matches_components;
  end if;
end$$;

alter table public.invoices
  add constraint invoices_total_matches_components
    check (total_charged = (amount + platform_fee)) not valid;

create index if not exists invoices_due_date_idx          on public.invoices (due_date);
create index if not exists invoices_freelancer_status_idx on public.invoices (freelancer_id, status);

-- 3. fee_ledger + fee_transactions -------------------------------------------

create table if not exists public.fee_ledger (
  freelancer_id           uuid primary key references public.profiles(id) on delete cascade,
  period_month            int  not null check (period_month between 1 and 12),
  period_year             int  not null,
  fees_accumulated_cents  bigint not null default 0,
  cap_cents               bigint not null default 3000,
  updated_at              timestamptz not null default now()
);
create unique index if not exists fee_ledger_period_uniq
  on public.fee_ledger (freelancer_id, period_year, period_month);

create table if not exists public.fee_transactions (
  id                    uuid primary key default gen_random_uuid(),
  freelancer_id         uuid not null references public.profiles(id) on delete cascade,
  invoice_id            uuid references public.invoices(id) on delete set null,
  payment_intent_id     text,
  gross_cents           bigint not null,
  fee_cents             bigint not null,
  cumulative_cents      bigint not null,
  period_month          int not null,
  period_year           int not null,
  kind                  text not null check (kind in ('CHARGE','REFUND')),
  created_at            timestamptz not null default now()
);
create index if not exists fee_transactions_fl_idx
  on public.fee_transactions (freelancer_id, period_year, period_month);
create index if not exists fee_transactions_pi_idx
  on public.fee_transactions (payment_intent_id);

-- 4. RLS on new tables --------------------------------------------------------
alter table public.fee_ledger        enable row level security;
alter table public.fee_transactions  enable row level security;

drop policy if exists "fee_ledger_select_own"        on public.fee_ledger;
drop policy if exists "fee_transactions_select_own"  on public.fee_transactions;

create policy "fee_ledger_select_own"
  on public.fee_ledger for select using (auth.uid() = freelancer_id);
create policy "fee_transactions_select_own"
  on public.fee_transactions for select using (auth.uid() = freelancer_id);

-- 5. compute_fee_cents RPC ---------------------------------------------------
-- SECURITY DEFINER so the webhook (service-role capable) can call it while anon
-- RLS on fee_ledger/fee_transactions stays read-only to the freelancer.
create or replace function public.compute_fee_cents(
  p_freelancer_id      uuid,
  p_gross_cents        bigint,
  p_kind               text   default 'CHARGE',
  p_invoice_id         uuid   default null,
  p_payment_intent_id  text   default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  v_month int  := extract(month from v_now);
  v_year  int  := extract(year  from v_now);
  v_accum bigint;
  v_cap   bigint := 3000;
  v_fee   bigint;
  v_cum   bigint;
begin
  -- upsert the ledger row for the current month
  insert into public.fee_ledger
    (freelancer_id, period_month, period_year, fees_accumulated_cents, cap_cents, updated_at)
  values (p_freelancer_id, v_month, v_year, 0, v_cap, v_now)
  on conflict (freelancer_id, period_year, period_month)
  do update set updated_at = v_now
  returning fees_accumulated_cents, cap_cents into v_accum, v_cap;

  -- SAFETY: re-read in case of concurrent transaction
  select fees_accumulated_cents into v_accum
    from public.fee_ledger
    where freelancer_id = p_freelancer_id
      and period_year = v_year and period_month = v_month
    for update;

  if p_kind = 'CHARGE' then
    if v_accum >= v_cap then
      v_fee := 0;
    else
      v_fee := least((0.05 * p_gross_cents)::bigint, v_cap - v_accum);
    end if;
    v_cum := v_accum + v_fee;
    update public.fee_ledger
      set fees_accumulated_cents = v_cum, updated_at = v_now
      where freelancer_id = p_freelancer_id
        and period_year = v_year and period_month = v_month;

  elsif p_kind = 'REFUND' then
    -- best-effort: reverse the most-recently charged fee on this invoice
    select fee_cents into v_fee
      from public.fee_transactions
      where invoice_id = p_invoice_id and kind = 'CHARGE'
      order by created_at desc
      limit 1;
    if v_fee is null then v_fee := 0; end if;
    v_cum := greatest(0, v_accum - v_fee);
    update public.fee_ledger
      set fees_accumulated_cents = v_cum, updated_at = v_now
      where freelancer_id = p_freelancer_id
        and period_year = v_year and period_month = v_month;
  else
    raise exception 'Unknown kind %', p_kind;
  end if;

  insert into public.fee_transactions (
    freelancer_id, invoice_id, payment_intent_id,
    gross_cents, fee_cents, cumulative_cents,
    period_month, period_year, kind
  ) values (
    p_freelancer_id, p_invoice_id, p_payment_intent_id,
    p_gross_cents, v_fee, v_cum,
    v_month, v_year, p_kind
  );

  return v_fee;
end;
$$;

comment on function public.compute_fee_cents(uuid,bigint,text,uuid,text) is
  'Atomically compute the application fee (5% capped at $30/mo) and journal it.';
```

---

## After running the migration — pg_cron schedule

Once the Edge function is deployed, run this final block to register the daily
reminder sweep. Replace `<PROJECT>` and `<CRON_SECRET>`:

```sql
select cron.schedule(
  'clientlockbox-reminders','0 9 * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT>.functions.supabase.co/cron-reminders',
       headers := jsonb_build_object(
         'Authorization','Bearer <CRON_SECRET>',
         'Content-Type','application/json'
       ),
       body := jsonb_build_object()
     ); $$
);
```

## Sanity-checks after running

```sql
-- tables present:
\dt public.fee_ledger         -- should exist
\dt public.fee_transactions   -- should exist

-- RPC returns 50c on a $10 charge (first charge ever):
select public.compute_fee_cents('<your-profile-uuid>', 1000);
-- 50

-- RPC returns 0 once you push $30 of fees:
-- repeatedly call with a $600 invoice (5% = $30) → second identical call returns 0.
```

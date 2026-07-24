-- ClientLockbox Stripe schema hardening
-- Idempotent migration for the requested profile/invoice/ledger fields.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_account_status text not null default 'PENDING'
    check (stripe_account_status in ('PENDING','RESTRICTED','ENABLED')),
  add column if not exists stripe_onboarding_complete boolean not null default false;

alter table public.invoices
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_transfer_id text;

create table if not exists public.fee_ledger (
  freelancer_id           uuid primary key references public.profiles (id) on delete cascade,
  period_month            int not null check (period_month between 1 and 12),
  period_year             int not null,
  fees_accumulated_cents  bigint not null default 0,
  cap_cents               bigint not null default 3000,
  updated_at              timestamptz not null default now()
);

create unique index if not exists fee_ledger_period_uniq
  on public.fee_ledger (freelancer_id, period_year, period_month);

create table if not exists public.fee_transactions (
  id                    uuid primary key default gen_random_uuid(),
  freelancer_id         uuid not null references public.profiles (id) on delete cascade,
  invoice_id            uuid references public.invoices (id) on delete set null,
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
create index if not exists fee_transactions_invoice_idx
  on public.fee_transactions (invoice_id);

comment on column public.profiles.stripe_account_id is 'Stripe Connect Express account id (acct_…). Nullable until onboarding kickoff.';
comment on column public.profiles.stripe_onboarding_complete is 'Boolean mirror of Stripe onboarding completion for the dashboard.';
comment on column public.invoices.stripe_payment_intent_id is 'Stripe PaymentIntent id at charge time.';
comment on column public.invoices.stripe_transfer_id is 'Stripe Transfer id for the destination-charge payout.';
comment on table public.fee_ledger is 'Per-freelancer per-calendar-month platform fee accumulation ledger.';
comment on table public.fee_transactions is 'Append-only journal of platform fee charge/refund events.';

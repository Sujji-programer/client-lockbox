-- ============================================================================
-- Monetization Overhaul Migration
-- 10% Free Tier / 0% Paid Pro Tier with full fee transparency
--
-- Idempotent; safe to re-run. Paste into the Supabase SQL Editor.
--
-- Changes:
--   1. profiles.plan_type       → profiles.subscription_tier  ('FREE'|'PRO')
--   2. profiles                  → + custom_platform_fee_percent (nullable override)
--   3. invoices                  → + base_amount_cents, platform_fee_cents,
--                                  stripe_fee_cents, total_client_amount_cents
--   4. Legacy NUMERIC rows       → backfilled into new integer-cent columns
--   5. CHECK constraint          → total_client_amount_cents = sum of components
-- ============================================================================

begin;

-- ── 1. Rename plan_type → subscription_tier ─────────────────────────────────
-- Drop the old CHECK first (it references 'FREE','PREMIUM').
do $$ begin
    if exists (select 1 from pg_constraint where conname = 'profiles_plan_type_check') then
        alter table public.profiles drop constraint profiles_plan_type_check;
    end if;
    -- Supabase auto-generates constraints; also try the naming convention.
    if exists (select 1 from pg_constraint where conname = 'profiles_plan_type_check1') then
        alter table public.profiles drop constraint profiles_plan_type_check1;
    end if;
end $$;

alter table public.profiles rename column plan_type to subscription_tier;

-- Migrate data: PREMIUM → PRO, nulls → FREE, anything unexpected → FREE.
update public.profiles set subscription_tier = 'PRO' where subscription_tier = 'PREMIUM';
update public.profiles set subscription_tier = 'FREE' where subscription_tier is null;
update public.profiles set subscription_tier = 'FREE' where subscription_tier not in ('FREE', 'PRO');

-- Add new CHECK with the correct enum values.
alter table public.profiles alter column subscription_tier drop default;
alter table public.profiles add constraint profiles_subscription_tier_chk
    check (subscription_tier in ('FREE', 'PRO')) not valid;
alter table public.profiles alter column subscription_tier set default 'FREE';

-- ── 2. Custom platform fee percent override ─────────────────────────────────
alter table public.profiles
    add column if not exists custom_platform_fee_percent numeric(5,2);

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_custom_fee_pct_chk') then
        alter table public.profiles add constraint profiles_custom_fee_pct_chk
            check (custom_platform_fee_percent is null
                   or (custom_platform_fee_percent >= 0 and custom_platform_fee_percent <= 100))
            not valid;
    end if;
end $$;

-- ── 3. Invoice transparency columns (integer cents) ──────────────────────────
alter table public.invoices add column if not exists base_amount_cents     bigint;
alter table public.invoices add column if not exists platform_fee_cents   bigint not null default 0;
alter table public.invoices add column if not exists stripe_fee_cents     bigint not null default 0;
alter table public.invoices add column if not exists total_client_amount_cents bigint;

-- ── 4. Backfill from legacy NUMERIC columns (idempotent) ──────────────────────
update public.invoices
    set base_amount_cents = round(amount * 100)
    where base_amount_cents is null
      and amount is not null;

update public.invoices
    set platform_fee_cents = round(platform_fee * 100)
    where platform_fee is not null
      and platform_fee > 0
      and platform_fee_cents = 0;

update public.invoices
    set total_client_amount_cents = round(total_charged * 100)
    where total_client_amount_cents is null
      and total_charged is not null;

-- ── 5. Integrity constraint ─────────────────────────────────────────────────
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'invoices_total_client_breakdown_chk') then
        alter table public.invoices add constraint invoices_total_client_breakdown_chk
            check (total_client_amount_cents = base_amount_cents + platform_fee_cents + stripe_fee_cents)
            not valid;
    end if;
end $$;

-- ── 6. Comments ──────────────────────────────────────────────────────────────
comment on column public.profiles.subscription_tier is
    'FREE = 10% platform fee (default); PRO = 0% platform fee (paid plan).';
comment on column public.profiles.custom_platform_fee_percent is
    'Optional per-freelancer fee-percent override. NULL → derive from subscription_tier. Set to a value between 0 and 100 to override.';
comment on column public.invoices.base_amount_cents is
    'Amount owed to the freelancer in the currency smallest unit (cents). New source of truth for fee math.';
comment on column public.invoices.platform_fee_cents is
    'Platform fee (cents) retained by ClientLockbox for this transaction.';
comment on column public.invoices.stripe_fee_cents is
    'Stripe processing fee pass-through (cents) shown to the client. ~2.9% + $0.30 of the subtotal.';
comment on column public.invoices.total_client_amount_cents is
    'Total the client is charged (cents) = base + platform + stripe fee. This is the PaymentIntent amount.';

commit;

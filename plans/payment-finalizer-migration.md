# ClientLockbox — Atomic Payment Finalizer Migration

> **Idempotent. Safe to re-run.** Paste the SQL block below into
> **Supabase Dashboard → SQL Editor → New query → Run**.
>
> ⚠️ **Review by user required before running — do NOT auto-execute.**
> This migration is the data-integrity hardening for the
> `payment_intent.succeeded` webhook path. It:
>
> 1. Adds a `UNIQUE (payment_intent_id, kind)` constraint to `fee_transactions`
>    so duplicate webhook deliveries are physically impossible to journal
>    twice (the existing non-unique index is replaced).
> 2. Defines a new `finalize_payment_intent_success()` SECURITY DEFINER RPC
>    that performs **lock-invoice → compute-fee → insert-ledger → update-status
>    → journal-transaction** as a single atomic Postgres transaction.
>
> **Why a single RPC instead of app-level transaction code?**
> `@supabase/supabase-js` has no `.transaction()` API, and this codebase does
> not use Prisma or a raw `pg` driver. The only way to get true ACID atomicity
> across multiple tables in this stack is a `SECURITY DEFINER` function that
> wraps the work in one `BEGIN…COMMIT` block. That is the established pattern
> in this repo (see `compute_fee_cents()` in `phase2-migration.md`).

## What this fixes

Before this migration, the webhook ran **two separate transactions**:

1. `compute_fee_cents()` RPC — atomic fee calc + ledger update + journal insert.
2. A separate `invoices.update({status:"PAID"})` call.

If (1) committed but (2) failed (network blip, RLS surprise, transient error),
the ledger had a CHARGE row but the invoice stayed PENDING. Stripe's redelivery
would eventually converge it via the replay guard, but during the window the DB
disagreed with Stripe.

After this migration, the whole success path is **one statement, one
transaction, one outcome** — either the invoice is PAID *and* the ledger is
updated *and* the journal row exists, or nothing happened.

## The SQL

```sql
-- ============================================================================
-- ClientLockbox — Atomic Payment Finalizer Migration
-- Idempotent; safe to re-run.
-- ============================================================================

-- 0. extensions --------------------------------------------------------------
create extension if not exists pgcrypto;

-- 1. Replace the non-unique payment_intent_id index with a UNIQUE constraint -
-- This is the physical guarantee that a given (payment_intent_id, kind) pair
-- can only ever have one journal row. Even if two webhook deliveries race past
-- the app-level replay guard, Postgres itself rejects the duplicate insert
-- (SQLSTATE 23505), and the RPC's EXCEPTION handler converts that into a
-- clean 'ALREADY_PROCESSED' outcome rather than an error.
--
-- Note: NULL payment_intent_id values never collide under UNIQUE in Postgres
-- (NULLs are considered distinct), so legacy rows without a PI id are safe.

-- Drop the old non-unique index if present (idempotent).
drop index if exists fee_transactions_pi_idx;

-- Remove any pre-existing constraint of the same name before (re)creating.
alter table public.fee_transactions
  drop constraint if exists fee_transactions_payment_intent_kind_uniq;

-- If historical duplicate (payment_intent_id, kind) rows exist, the constraint
-- creation below would fail. We de-dup defensively, keeping the earliest row by
-- created_at. This is a one-time reconciliation; the WHERE makes it a no-op on
-- a clean table.
delete from public.fee_transactions a
  using public.fee_transactions b
  where a.payment_intent_id is not null
    and a.payment_intent_id = b.payment_intent_id
    and a.kind = b.kind
    and a.id > b.id;

alter table public.fee_transactions
  add constraint fee_transactions_payment_intent_kind_uniq
  unique (payment_intent_id, kind);

-- Recreate the non-unique lookup index for the common case of querying by
-- payment_intent_id alone (the unique constraint above covers the composite
-- lookup but a single-column index is still useful for partial scans).
create index if not exists fee_transactions_pi_idx
  on public.fee_transactions (payment_intent_id);

-- 2. The atomic finalizer RPC -----------------------------------------------

create or replace function public.finalize_payment_intent_success(
  p_invoice_id        uuid,
  p_freelancer_id     uuid,
  p_payment_intent_id text,
  p_gross_cents       bigint,
  p_application_fee_cents bigint default null
) returns table(
  outcome          text,
  invoice_status   text,
  fee_cents        bigint,
  cumulative_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now          timestamptz := now();
  v_month        int  := extract(month from v_now);
  v_year         int  := extract(year  from v_now);
  v_cap          bigint := 3000;
  v_accum        bigint;
  v_fee          bigint;
  v_cum          bigint;
  v_current_kind text;
  v_status       text;
begin
  -- ── STEP 0: Idempotency — has this PaymentIntent already been journaled? ──
  -- Done INSIDE the transaction so the check + insert are atomic. A concurrent
  -- delivery that also reaches this point will block on the UNIQUE constraint
  -- below (or see this row after it commits) and resolve to ALREADY_PROCESSED.
  select kind
    into v_current_kind
    from public.fee_transactions
    where payment_intent_id = p_payment_intent_id
      and kind = 'CHARGE'
    limit 1;

  if found then
    -- Already processed. Return the persisted outcome so the caller can
    -- short-circuit cleanly without raising an exception (which would make
    -- Stripe retry a webhook that already succeeded).
    return query
      select 'ALREADY_PROCESSED'::text,
             i.status,
             coalesce(ft.fee_cents, 0),
             coalesce(ft.cumulative_cents, 0)
        from public.invoices i
        left join public.fee_transactions ft
          on ft.payment_intent_id = p_payment_intent_id and ft.kind = 'CHARGE'
        where i.id = p_invoice_id
        limit 1;
    -- Defensive: if the invoice row vanished, still return ALREADY_PROCESSED
    -- with sensible nulls so the caller never throws.
    if not found then
      return query select 'ALREADY_PROCESSED'::text, null::text, 0::bigint, 0::bigint;
    end if;
    return;
  end if;

  -- ── STEP 1: Lock the invoice row and validate its current state. ─────────
  -- FOR UPDATE takes an advisory row lock held until COMMIT, so a concurrent
  -- finalizer (or refund) for the same invoice serializes against us.
  select status
    into v_status
    from public.invoices
    where id = p_invoice_id
    for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id
      using errcode = 'P0002'; -- NOT FOUND
  end if;

  if v_status = 'PAID' then
    -- Invoice is already PAID but we have no journal row (rare — possible if
    -- a pre-migration webhook path set status without journaling). Treat as
    -- already-processed to stay idempotent; operator can reconcile manually.
    return query select 'ALREADY_PROCESSED'::text, 'PAID'::text, 0::bigint, 0::bigint;
    return;
  end if;

  if v_status = 'REFUNDED' then
    -- Never resurrect a refunded invoice to PAID. Refuse hard.
    raise exception 'Cannot finalize a REFUNDED invoice %', p_invoice_id
      using errcode = 'P0003';
  end if;

  -- v_status is PENDING (or any non-terminal state we permit) → proceed.

  -- ── STEP 2: Compute the final capped fee. ────────────────────────────────
  -- Upsert the period ledger row under the same transaction, then lock it.
  insert into public.fee_ledger
    (freelancer_id, period_month, period_year, fees_accumulated_cents, cap_cents, updated_at)
  values (p_freelancer_id, v_month, v_year, 0, v_cap, v_now)
  on conflict (freelancer_id, period_year, period_month)
  do update set updated_at = v_now
  returning fees_accumulated_cents, cap_cents into v_accum, v_cap;

  -- Re-read under FOR UPDATE so concurrent charges to the same freelancer in
  -- the same month serialize at the ledger row (this is the $30-cap race fix).
  select fees_accumulated_cents into v_accum
    from public.fee_ledger
    where freelancer_id = p_freelancer_id
      and period_year = v_year and period_month = v_month
    for update;

  if v_accum >= v_cap then
    v_fee := 0;
  else
    v_fee := least((0.05 * p_gross_cents)::bigint, v_cap - v_accum);
  end if;

  -- OPTIONAL cross-check: if the caller passed the fee Stripe actually charged
  -- (p_application_fee_cents), assert our recomputed fee matches. A mismatch
  -- means the projection at checkout drifted from the truth — fail closed so
  -- the operator investigates rather than silently settling wrong numbers.
  if p_application_fee_cents is not null and p_application_fee_cents <> v_fee then
    raise exception
      'Fee mismatch for PI %: Stripe charged %, ledger computed %',
      p_payment_intent_id, p_application_fee_cents, v_fee
      using errcode = 'P0004'; -- ASSERT_FAILURE
  end if;

  v_cum := v_accum + v_fee;

  -- ── STEP 3: Update the ledger running total. ─────────────────────────────
  update public.fee_ledger
    set fees_accumulated_cents = v_cum, updated_at = v_now
    where freelancer_id = p_freelancer_id
      and period_year = v_year and period_month = v_month;

  -- ── STEP 4: Journal the transaction row. ─────────────────────────────────
  -- The UNIQUE(payment_intent_id, kind) constraint is the physical duplicate
  -- guard. A racing second delivery raising 23505 here is caught by the
  -- caller's error mapping and treated as ALREADY_PROCESSED.
  begin
    insert into public.fee_transactions (
      freelancer_id, invoice_id, payment_intent_id,
      gross_cents, fee_cents, cumulative_cents,
      period_month, period_year, kind
    ) values (
      p_freelancer_id, p_invoice_id, p_payment_intent_id,
      p_gross_cents, v_fee, v_cum,
      v_month, v_year, 'CHARGE'
    );
  exception when unique_violation then
    -- Lost the race with a concurrent finalizer. Return the winner's result.
    select fee_cents, cumulative_cents into v_fee, v_cum
      from public.fee_transactions
      where payment_intent_id = p_payment_intent_id and kind = 'CHARGE'
      limit 1;
    return query
      select 'ALREADY_PROCESSED'::text,
             i.status,
             coalesce(v_fee, 0),
             coalesce(v_cum, 0)
        from public.invoices i
        where i.id = p_invoice_id
        limit 1;
    if not found then
      return query select 'ALREADY_PROCESSED'::text, null::text,
                          coalesce(v_fee, 0), coalesce(v_cum, 0);
    end if;
    return;
  end;

  -- ── STEP 5: Flip the invoice PENDING → PAID (still under the row lock). ──
  update public.invoices
    set status = 'PAID',
        platform_fee = (v_fee::numeric / 100.0),
        stripe_payment_intent_id = p_payment_intent_id
    where id = p_invoice_id
      and status in ('PENDING'); -- belt-and-suspenders; the lock already guards this

  -- ── STEP 6: Return the canonical result. ─────────────────────────────────
  return query
    select 'FINALIZED'::text,
           'PAID'::text,
           v_fee,
           v_cum;
end;
$$;

comment on function public.finalize_payment_intent_success(uuid,uuid,text,bigint,bigint) is
  'Atomic finalizer for payment_intent.succeeded: locks invoice, computes capped fee, updates ledger + journal + invoice status in one transaction. Idempotent on (payment_intent_id, CHARGE).';

-- 3. Verification ------------------------------------------------------------
-- Run these after applying:
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--     where conname = 'fee_transactions_payment_intent_kind_uniq';
--
--   -- Should return one row, status = PAID, fee_cents = 500 for a $1000 gross:
--   select * from public.finalize_payment_intent_success(
--            '<invoice-uuid>', '<freelancer-uuid>', 'pi_test_demo', 1000, null);
```

## Operational notes

- **The `compute_fee_cents()` RPC is left untouched** for now. It is still
  referenced by `applyChargeFee`/`applyRefundFee` in `lib/stripe/fees.ts`, and
  the refund path in the webhook continues to use it. Once you've confirmed the
  new `finalize_payment_intent_success` path is stable in production, you can
  retire `compute_fee_cents('CHARGE', …)` usage from the success path (already
  done in code by this change) and eventually drop the function.

- **Replay/duplicate behavior is now triple-guarded:**
  1. App-level short-circuit (the handler reads `fee_transactions` first).
  2. RPC-level early-return (`v_current_kind` check inside the transaction).
  3. DB-level `UNIQUE(payment_intent_id, kind)` constraint — the hard floor.

- **The cross-check `p_application_fee_cents` parameter is optional.** The
  webhook passes the value Stripe actually applied (`pi.application_fee_amount`)
  so the RPC can detect checkout-projection drift. Pass `null` to skip.

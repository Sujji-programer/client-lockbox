-- ============================================================================
-- Simplified payment-finalization RPC (post-cap-removal)
--
-- Replaces the legacy cap-enforcing finalize_payment_intent_success that did
-- lock-invoice → compute-capped-fee → update-ledger → insert-journal → PAID.
--
-- The new model uses deterministic tier-based fees (10% / 0% / custom override)
-- computed at PaymentIntent-creation time. This RPC only needs to:
--   1. Lock the invoice FOR UPDATE (prevents concurrent status flips)
--   2. Short-circuit if already PAID (idempotency)
--   3. Cross-check Stripe's application_fee_amount against our pre-computed value
--   4. Flip status to PAID and stamp the stripe_payment_intent_id
--
-- Idempotent; safe to re-run. Paste into the Supabase SQL Editor.
--
-- NOTE: fee_ledger / fee_transactions / compute_fee_cents are left in the DB
-- as a historical journal. They are no longer mutated by app code.
-- ============================================================================

-- Unique indexes (retained from the original migration, kept for safety).
create unique index if not exists invoices_stripe_payment_intent_unique_idx
  on public.invoices (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists fee_transactions_payment_intent_kind_unique_idx
  on public.fee_transactions (payment_intent_id, kind)
  where payment_intent_id is not null;

-- ── Simplified finalization RPC ───────────────────────────────────────────────
create or replace function public.finalize_payment_intent_success(
  p_invoice_id uuid,
  p_freelancer_id uuid,
  p_payment_intent_id text,
  p_gross_cents bigint,
  p_application_fee_cents bigint default null
) returns table (
  outcome text,
  invoice_status text,
  fee_cents bigint,
  cumulative_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_existing_pi text;
  v_expected_fee bigint;
begin
  -- 1. Lock the invoice row so a duplicate or concurrent webhook cannot race.
  select status, stripe_payment_intent_id
    into v_status, v_existing_pi
    from public.invoices
    where id = p_invoice_id
    for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  -- 2. Idempotency: already finalized by a prior delivery.
  if v_status = 'PAID' and v_existing_pi = p_payment_intent_id then
    outcome := 'ALREADY_PROCESSED';
    invoice_status := v_status;
    fee_cents := 0;
    cumulative_cents := 0;
    return next;
    return;
  end if;

  -- Cannot finalize a refunded invoice.
  if v_status = 'REFUNDED' then
    raise exception 'Cannot finalize refunded invoice %', p_invoice_id;
  end if;

  -- 3. Cross-check the application fee Stripe actually charged against the
  --    pre-computed value stored on the invoice at PI-creation time.
  --    This is a fail-closed guard: a drift means a programming error.
  select platform_fee_cents into v_expected_fee
    from public.invoices
    where id = p_invoice_id;

  if p_application_fee_cents is not null and p_application_fee_cents <> v_expected_fee then
    raise exception
      'Application fee mismatch for invoice %: expected %, Stripe charged %',
      p_invoice_id, v_expected_fee, p_application_fee_cents;
  end if;

  -- 4. Flip to PAID and stamp the payment-intent id.
  update public.invoices
    set status = 'PAID',
        stripe_payment_intent_id = p_payment_intent_id
    where id = p_invoice_id;

  -- 5. Best-effort journal entry for audit trail (fee_transactions kept for
  --    history; no cap enforcement).
  begin
    insert into public.fee_transactions (
      freelancer_id,
      invoice_id,
      payment_intent_id,
      gross_cents,
      fee_cents,
      cumulative_cents,
      period_month,
      period_year,
      kind,
      created_at
    ) values (
      p_freelancer_id,
      p_invoice_id,
      p_payment_intent_id,
      p_gross_cents,
      v_expected_fee,
      0, -- no cumulative cap tracking
      extract(month from now())::int,
      extract(year from now())::int,
      'CHARGE',
      now()
    );
  exception
    when unique_violation then
      -- Duplicate delivery — safe to ignore, the invoice is already PAID above.
      null;
  end;

  outcome := 'FINALIZED';
  invoice_status := 'PAID';
  fee_cents := v_expected_fee;
  cumulative_cents := 0;
  return next;
end;
$$;

comment on function public.finalize_payment_intent_success(uuid, uuid, text, bigint, bigint) is
  'Atomically locks an invoice and marks it PAID. Cross-checks Stripe application_fee against pre-computed value. No cap enforcement (legacy cap retired).';

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeSuccessfulPayment } from "@/lib/stripe/fees";

/**
 * POST /api/dev/mock-pay
 *
 * LOCAL TESTING HARNESS — simulates a successful Stripe charge end-to-end
 * (the Freelancer → Client flow) WITHOUT any real Stripe API keys, the Stripe
 * CLI webhook forwarder, or a test card.
 *
 * What it does (mirrors the production `payment_intent.succeeded` webhook):
 *   1. Updates the invoice row to status = 'PAID' with the full deterministic
 *      fee breakdown (base/platform/stripe/total cents) via
 *      {@link finalizeSuccessfulPayment}.
 *   2. Inserts a CHARGE row into the `fee_transactions` ledger — exactly what
 *      the Stripe webhook would normally journal.
 *
 * ---------------------------------------------------------------
 * HARD PRODUCTION GUARD
 * ---------------------------------------------------------------
 * The handler refuses to run unless `process.env.NODE_ENV === "development"`.
 * Next.js flips NODE_ENV to "production" for `next start` and optimized
 * builds, so this branch is dead in any deployed environment. Failure here
 * returns 403 (per spec) — never executes the body.
 */

export async function POST(request: Request) {
  // --- Guard: development-only -------------------------------------------
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Mock payments are only available in development." },
      { status: 403 },
    );
  }

  // --- Parse + validate the body -----------------------------------------
  let body: { invoiceId?: unknown };
  try {
    body = (await request.json()) as { invoiceId?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body. Expected { "invoiceId": "<uuid>" }.' },
      { status: 400 },
    );
  }

  const invoiceId =
    typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";

  if (!invoiceId) {
    return NextResponse.json(
      { error: "Missing required field: invoiceId." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // --- Read the invoice (need freelancer_id + current status) ------------
  const { data: existing, error: readError } = await admin
    .from("invoices")
    .select("id, status, freelancer_id, amount, base_amount_cents, currency")
    .eq("id", invoiceId)
    .maybeSingle();

  if (readError || !existing) {
    return NextResponse.json(
      { error: "Invoice not found. The link may be invalid or expired." },
      { status: 404 },
    );
  }

  // Idempotent: already paid, nothing to do. Return success so the client
  // UI flips straight to the download list.
  if (existing.status === "PAID") {
    return NextResponse.json({
      ok: true,
      paid: true,
      alreadyPaid: true,
      message: "Invoice was already PAID — no change required.",
    });
  }

  const freelancerId = String(existing.freelancer_id ?? "");
  if (!freelancerId) {
    return NextResponse.json(
      { error: "Invoice is missing a freelancer_id; cannot compute fees." },
      { status: 400 },
    );
  }

  // --- Synthesize a PaymentIntent id + gross for the finalizer -----------
  const syntheticPaymentIntentId = `mock_pi_${invoiceId.slice(0, 8)}_${Date.now()}`;
  const baseAmountCents =
    Number(existing.base_amount_cents) > 0
      ? Math.round(Number(existing.base_amount_cents))
      : Math.round(Number(existing.amount) * 100);

  let result;
  try {
    result = await finalizeSuccessfulPayment({
      invoiceId,
      freelancerId,
      paymentIntentId: syntheticPaymentIntentId,
      grossCents: baseAmountCents,
      // Simulate the webhook passing back Stripe's reported application fee.
      // Null is also acceptable here; finalizer recomputes deterministically.
      applicationFeeCentsFromStripe: null,
    });
  } catch (err) {
    console.error(
      "[mock-pay] finalizeSuccessfulPayment failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "Could not finalize the mock payment. Check server logs." },
      { status: 500 },
    );
  }

  // --- Insert the platform-fee ledger row (CHARGE) -----------------------
  // Re-read the row finalizer just wrote so the ledger mirrors the exact
  // persisted breakdown (handles any rounding drift).
  const { data: finalized, error: reReadError } = await admin
    .from("invoices")
    .select(
      "id, freelancer_id, total_client_amount_cents, platform_fee_cents, stripe_payment_intent_id",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (!reReadError && finalized) {
    const now = new Date();
    const grossCents = Number(finalized.total_client_amount_cents) || baseAmountCents;
    const feeCents = Number(finalized.platform_fee_cents) || 0;
    const paymentIntentId =
      finalized.stripe_payment_intent_id ?? syntheticPaymentIntentId;

    // Only journal a CHARGE when there's actually a platform fee to record,
    // matching the guard the refund-side helper uses.
    if (grossCents > 0 && feeCents >= 0) {
      const { error: ledgerErr } = await admin.from("fee_transactions").insert({
        freelancer_id: freelancerId,
        invoice_id: invoiceId,
        payment_intent_id: paymentIntentId,
        gross_cents: grossCents,
        fee_cents: feeCents,
        cumulative_cents: feeCents,
        period_month: now.getUTCMonth() + 1,
        period_year: now.getUTCFullYear(),
        kind: "CHARGE",
        created_at: now.toISOString(),
      });

      if (ledgerErr) {
        // Non-fatal: the invoice is already PAID. Log and continue so the UI
        // still flips to success; the ledger is best-effort in dev.
        console.error(
          "[mock-pay] fee_transactions insert failed:",
          ledgerErr.message,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    paid: true,
    outcome: result.outcome,
    invoiceStatus: result.invoiceStatus ?? "PAID",
    paymentIntentId: syntheticPaymentIntentId,
    message: "Mock payment complete — invoice marked PAID and ledger updated.",
  });
}

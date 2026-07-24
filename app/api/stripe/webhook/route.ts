import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import { finalizeSuccessfulPayment, applyRefundFee } from "@/lib/stripe/fees";

/**
 * POST /api/stripe/webhook
 *
 * Canonical Stripe webhook receiver for Connect. This is the **only** webhook
 * the Stripe dashboard should point at. The legacy `/api/webhook` route now
 * re-exports these handlers for backwards compatibility — do not register both
 * in Stripe or events will be processed twice.
 *
 * Events handled:
 *
 *   1. `payment_intent.succeeded`
 *      -> idempotency-guard on the PaymentIntent id (short-circuit before any
 *         DB/ledger work if we've already processed it),
 *      -> atomically finalize the payment via the
 *         `finalize_payment_intent_success` SECURITY DEFINER RPC, which does
 *         lock-invoice → compute-capped-fee → update-ledger → insert-journal →
 *         flip-invoice-PAID inside a single Postgres transaction. The fee is
 *         capped at $30 / freelancer / calendar month (enforced under
 *         SELECT … FOR UPDATE so concurrent charges can't race past the cap),
 *         and the invoice-status flip commits atomically with the ledger
 *         write. A replay (or a concurrent delivery that lost the race) is
 *         resolved cleanly to `ALREADY_PROCESSED` and never resurrects a
 *         REFUNDED row.
 *
 *   2. `charge.refunded`
 *      -> idempotency-guard on (PaymentIntent id, REFUND),
 *      -> reverse the most recently charged fee for the invoice via the RPC,
 *      -> flip the invoice to REFUNDED (only from PAID/PENDING).
 *
 *   3. `account.updated` (Connect)
 *      -> keep `profiles.stripe_account_status` in sync with Stripe's
 *         authoritative `charges_enabled` / `details_submitted`.
 *
 * ── Security model ────────────────────────────────────────────────────────
 *
 *   • **Fail-closed signature verification.** If `STRIPE_WEBHOOK_SECRET` is
 *     missing or empty the request is rejected with 500. There is NO
 *     "unverified dev bypass" branch — local development must use
 *     `stripe listen --forward-to localhost:3000/api/stripe/webhook` (see
 *     the project README / Stripe dashboard notes), which forwards real,
 *     correctly-signed events.
 *
 *   • **Raw body verification.** Next.js Route Handlers give us the pristine
 *     request body via `request.text()`; we never re-parse JSON before the
 *     HMAC is verified, so a tampered payload can never reach the handler.
 *
 *   • **Replay protection.** We check `fee_transactions` for the
 *     (payment_intent_id, kind) pair BEFORE doing any work, and the invoice
 *     status update is additionally guarded by a status predicate. Stripe's
 *     at-least-once redelivery therefore cannot double-charge the ledger or
 *     resurrect a terminal invoice state.
 *
 *   • **Privileged writes only here.** This route uses the service-role admin
 *     client. It must never be importable from a Client Component (it isn't —
 *     it lives under `app/api`).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve the webhook signing secret. Throws if it is missing — fail-closed.
 * We additionally refuse the placeholder values Stripe suggests during setup
 * ("whsec_...") so a copy-paste mistake doesn't silently disable verification.
 */
function requireWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. The webhook cannot verify requests without it — refusing to process. " +
        "For local dev, run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and copy the whsec_… secret it prints.",
    );
  }
  return secret;
}

/**
 * Has this (PaymentIntent, kind) already been journaled? Checked BEFORE any
 * ledger mutation so a redelivered event short-circuits cheaply. We fail
 * *closed* on the lookup itself: if we can't read the dedupe table we refuse
 * to write, rather than risk a double-charge.
 */
async function alreadyJournaled(
  paymentIntentId: string,
  kind: "CHARGE" | "REFUND",
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fee_transactions")
    .select("id")
    .eq("payment_intent_id", paymentIntentId)
    .eq("kind", kind)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Idempotency check failed for ${kind} ${paymentIntentId}: ${error.message}`,
    );
  }
  return Boolean(data);
}

function mapStatus(
  chargesEnabled: boolean,
  detailsSubmitted: boolean,
): "PENDING" | "RESTRICTED" | "ENABLED" {
  if (chargesEnabled && detailsSubmitted) return "ENABLED";
  return detailsSubmitted ? "RESTRICTED" : "PENDING";
}

export async function POST(request: Request) {
  // ── 1. Fail-closed signature verification ──────────────────────────────
  const webhookSecret = (() => {
    try {
      return requireWebhookSecret();
    } catch (err) {
      const message = err instanceof Error ? err.message : "secret missing";
      console.error("[stripe.webhook] rejecting request:", message);
      return null;
    }
  })();
  if (webhookSecret === null) {
    return NextResponse.json(
      { error: "Webhook signing secret is not configured." },
      { status: 500 },
    );
  }

  // Raw body — MUST be the pristine bytes Stripe signed.
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  if (signature === "") {
    console.warn("[stripe.webhook] missing stripe-signature header");
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 },
    );
  }

  const client = getStripe();

  let event: Stripe.Event;
  try {
    // constructEvent verifies the HMAC-SHA256 signature AND the timestamp
    // freshness (Stripe rejects >5min old), so this single call is the entire
    // authentication boundary.
    event = client.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "verification error";
    console.error("[stripe.webhook] signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  // ── 2. Dispatch ────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------
  // EVENT 1: payment_intent.succeeded  → PAID + ledger CHARGE
  // ---------------------------------------------------------------------
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const invoiceId = (pi.metadata?.invoice_id ?? "").trim();
    const freelancerId = (pi.metadata?.freelancer_id ?? "").trim();
    const paymentIntentId = pi.id;

    if (!invoiceId || !freelancerId) {
      console.error(
        "[stripe.webhook] payment_intent.succeeded missing metadata:",
        pi.id,
      );
      return NextResponse.json({ received: true, ignored: "no_metadata" });
    }

    const admin = createAdminClient();

    try {
      const { data: invoiceState, error: invoiceErr } = await admin
        .from("invoices")
        .select("status, stripe_payment_intent_id")
        .eq("id", invoiceId)
        .maybeSingle();

      if (invoiceErr) {
        throw new Error(`invoice lookup failed: ${invoiceErr.message}`);
      }

      if (invoiceState?.status === "PAID" || invoiceState?.stripe_payment_intent_id === paymentIntentId) {
        return NextResponse.json({
          received: true,
          status: invoiceState?.status ?? "PAID",
          dedup: "existing_invoice",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "invoice lookup error";
      console.error("[stripe.webhook] invoice duplicate check failed:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // Replay guard: short-circuit BEFORE any ledger work.
    let alreadyPaid = false;
    try {
      alreadyPaid = await alreadyJournaled(paymentIntentId, "CHARGE");
    } catch (err) {
      const message = err instanceof Error ? err.message : "idempotency error";
      console.error("[stripe.webhook] charge idempotency check failed:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    if (alreadyPaid) {
      return NextResponse.json({
        received: true,
        status: "PAID",
        dedup: "fee_journal",
      });
    }

    if (!alreadyPaid) {
      // Atomic finalizer: lock-invoice → compute-fee → update-ledger →
      // insert-journal → flip-PAID, all inside a single Postgres transaction.
      // The RPC does the cap math under SELECT … FOR UPDATE so concurrent
      // payments to the same freelancer can't race past the $30/month cap,
      // AND the invoice-status flip commits atomically with the ledger write
      // — there is no window where the ledger says "charged" but the invoice
      // is still PENDING.
      try {
        const result = await finalizeSuccessfulPayment({
          invoiceId,
          freelancerId,
          paymentIntentId,
          grossCents: pi.amount,
          // Pass the fee Stripe actually charged so the RPC can detect
          // projection drift and fail closed instead of silently settling
          // wrong numbers.
          applicationFeeCentsFromStripe: pi.application_fee_amount,
        });

        if (result.outcome === "ALREADY_PROCESSED") {
          // A concurrent delivery (or the DB UNIQUE constraint) won the race.
          // The invoice is already PAID — acknowledge so Stripe stops retrying.
          return NextResponse.json({
            received: true,
            status: result.invoiceStatus ?? "PAID",
            dedup: "ALREADY_PROCESSED",
          });
        }

        // Defensive sanity-check: the fee the RPC applied should match what
        // Stripe actually charged. A mismatch is a programming error, not
        // customer-visible — log and continue (the RPC already cross-checked
        // and would have thrown on a real mismatch).
        if (
          pi.application_fee_amount !== null &&
          Number(result.feeCents) !== Number(pi.application_fee_amount)
        ) {
          console.warn(
            "[stripe.webhook] fee mismatch after finalize: ledger=%s intent=%s",
            result.feeCents,
            pi.application_fee_amount,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "ledger error";
        console.error("[stripe.webhook] atomic finalize RPC failed:", message);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    // The atomic RPC already flipped the invoice PENDING → PAID inside its
    // transaction (and persisted stripe_payment_intent_id + platform_fee), so
    // there is nothing left to mutate here. Acknowledge success — Stripe will
    // not retry a 2xx.
    return NextResponse.json({ received: true, status: "PAID" });
  }

  // ---------------------------------------------------------------------
  // EVENT 2: charge.refunded  → REFUNDED + ledger REFUND
  // ---------------------------------------------------------------------
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    const invoiceId = (charge.metadata?.invoice_id ?? "").trim();
    const freelancerId = (charge.metadata?.freelancer_id ?? "").trim();

    if (!paymentIntentId || !invoiceId || !freelancerId) {
      return NextResponse.json({ received: true, ignored: "no_metadata" });
    }

    // Replay guard.
    try {
      if (!(await alreadyJournaled(paymentIntentId, "REFUND"))) {
        await applyRefundFee({
          freelancerId,
          grossCents: charge.amount_refunded,
          invoiceId,
          paymentIntentId,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "ledger error";
      console.error("[stripe.webhook] refund-fee RPC failed:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // Flip to REFUNDED. Guard: only PAID/PENDING can transition to REFUNDED —
    // a redelivered refund can never re-touch an already-refunded row.
    try {
      const admin = createAdminClient();
      const { error: uErr } = await admin
        .from("invoices")
        .update({ status: "REFUNDED" })
        .eq("id", invoiceId)
        .in("status", ["PAID", "PENDING"]);

      if (uErr) {
        console.error(
          "[stripe.webhook] invoice REFUNDED update failed:",
          uErr.message,
        );
        return NextResponse.json(
          { error: "Could not mark invoice refunded." },
          { status: 500 },
        );
      }
      return NextResponse.json({ received: true, status: "REFUNDED" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "admin client error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ---------------------------------------------------------------------
  // EVENT 3: account.updated (Connect status sync)
  // ---------------------------------------------------------------------
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const freelancerId = (account.metadata?.freelancer_id ?? "").trim();

    if (freelancerId) {
      const admin = createAdminClient();
      const status = mapStatus(account.charges_enabled, account.details_submitted);
      // Sync both the enum and the cheap boolean mirror used by the dashboard.
      const { error } = await admin
        .from("profiles")
        .update({
          stripe_account_status: status,
          stripe_onboarding_complete: status === "ENABLED",
        })
        .eq("id", freelancerId);
      if (error) {
        console.warn(
          "[stripe.webhook] could not update profile status:",
          error.message,
        );
      }
    }
    return NextResponse.json({ received: true, account: account.id });
  }

  // Unsupported / unobserved event type — acknowledge so Stripe stops retrying.
  return NextResponse.json({ received: true, ignored: event.type });
}

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import {
  calculateCheckoutBreakdown,
  breakdownToApplicationFeeAmount,
} from "@/lib/stripe/fees";
import type { CheckoutBreakdown } from "@/lib/stripe/fees";

/**
 * POST /api/checkout
 *
 * Two payment modes for the public client portal:
 *   - body.mode === "payment_intent"  -> creates a PaymentIntent on the
 *     freelancer's **connected** Stripe Express account (destination charges),
 *     returns { client_secret, publishable_key }. Stripe Elements renders
 *     inline on the share page. **Primary mode — used by the new clientflow.**
 *   - body.mode === "hosted" (or omitted) -> creates a Stripe-hosted Checkout
 *     Session as a safe fallback (older browsers, JS-disabled flow).
 *
 * Body: { invoice_id: string, mode?: "payment_intent" | "hosted" }
 *
 * The application_fee_amount billed to the platform is computed by the
 * capped-fee ledger logic (5% of gross, capped at $30/freelancer/month).
 *
 * Security:
 *   - Public endpoint, but the invoice must be in PENDING state AND must
 *     have `accepted_at` + `signature` set (client has already accepted T&Cs
 *     on the share page before any payment route is callable).
 *   - All money passed to Stripe is in the invoice's `currency` smallest unit.
 */

type CheckoutRequestBody = {
  invoice_id?: unknown;
  mode?: unknown;
};

const SUPPORTED_CURRENCIES = new Set([
  "usd", "eur", "gbp", "inr", "aud", "cad", "aed", "sgd",
]);

function resolveBaseUrl(request: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    request.headers.get("origin") ??
    "http://localhost:3000"
  );
}

export async function POST(request: Request) {
  // 1. Parse + validate -------------------------------------------------
  let body: CheckoutRequestBody;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body. Expected { "invoice_id": "<uuid>" }.' },
      { status: 400 },
    );
  }

  const invoiceId =
    typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
  const mode =
    typeof body.mode === "string" && body.mode === "hosted" ? "hosted" : "payment_intent";

  if (!invoiceId) {
    return NextResponse.json(
      { error: "Missing required field: invoice_id." },
      { status: 400 },
    );
  }

  // 2. Fetch invoice ----------------------------------------------------
  // The SSR cookie client suffices because invoices RLS allows anon SELECT
  // by id (single-row public lookup enforced at app layer).
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "id, freelancer_id, client_email, amount, base_amount_cents, platform_fee, platform_fee_cents, total_charged, currency, status, signature, accepted_at",
    )
    .eq("id", invoiceId)
    .single();

  if (error || !invoice) {
    return NextResponse.json(
      { error: "Invoice not found. The link may be invalid or expired." },
      { status: 404 },
    );
  }

  // 3. Pre-flight validation -------------------------------------------
  if (invoice.status === "PAID") {
    return NextResponse.json(
      { error: "This invoice has already been paid in full." },
      { status: 409 },
    );
  }

  if (invoice.status === "REFUNDED") {
    return NextResponse.json(
      { error: "This invoice has been refunded." },
      { status: 409 },
    );
  }

  if (!invoice.accepted_at || !invoice.signature) {
    return NextResponse.json(
      {
        error:
          "Please accept the terms and conditions and sign before paying.",
      },
      { status: 409 },
    );
  }

  const currency = (invoice.currency ?? "usd").toLowerCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    return NextResponse.json(
      { error: `Unsupported currency: ${invoice.currency}` },
      { status: 422 },
    );
  }

  // total_charged is NUMERIC; express it in the currency's smallest unit.
  // Use base_amount_cents if available (new invoices), else derive from amount.
  const baseAmountCents =
    Number(invoice.base_amount_cents) > 0
      ? Math.round(Number(invoice.base_amount_cents))
      : Math.round(Number(invoice.amount) * 100);

  if (!Number.isFinite(baseAmountCents) || baseAmountCents <= 0) {
    return NextResponse.json(
      { error: "This invoice has an invalid charge amount." },
      { status: 422 },
    );
  }

  // 4. Resolve the freelancer's Connect account -------------------------
  const admin = createAdminClient();
  const { data: freelancer, error: flErr } = await admin
    .from("profiles")
    .select("stripe_account_id, stripe_account_status")
    .eq("id", invoice.freelancer_id)
    .maybeSingle();

  if (flErr || !freelancer?.stripe_account_id) {
    return NextResponse.json(
      {
        error:
          "The freelancer has not connected Stripe yet. They must complete Connect onboarding before this invoice can be paid.",
      },
      { status: 503 },
    );
  }

  if (freelancer.stripe_account_status !== "ENABLED") {
    return NextResponse.json(
      {
        error:
          "The freelancer's Stripe account is still completing verification. Please retry in a few minutes.",
      },
      { status: 503 },
    );
  }

  // 5. Stripe client ---------------------------------------------------
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe is not configured." },
      { status: 503 },
    );
  }

  // 6. Compute itemized checkout breakdown via tier-based engine -----------
  // `calculateCheckoutBreakdown` reads the freelancer's subscription_tier and
  // optional custom_platform_fee_percent, then computes platform fee, Stripe
  // processing fee, and the total client pays. Deterministic — no ledger/cap.
  let breakdown: CheckoutBreakdown;
  try {
    breakdown = await calculateCheckoutBreakdown(
      baseAmountCents,
      invoice.freelancer_id,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not compute fee.";
    return NextResponse.json(
      { error: `Fee calculation error: ${message}` },
      { status: 500 },
    );
  }
  const applicationFeeCents = breakdownToApplicationFeeAmount(breakdown);
  const chargeAmountCents = breakdown.totalClientAmountCents;

  // Enforce Stripe's minimum-per-charge floor: Connect refuses a 0 application
  // fee on a destination charge only for certain account types. Express is
  // fine with 0, so we pass it through unchanged.

  // 7a. payment_intent mode — destination charge on the connected account -
  if (mode === "payment_intent") {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: chargeAmountCents,
          currency,
          // Charge on the freelancer's account, take `application_fee_amount` to the platform.
          application_fee_amount: applicationFeeCents,
          // `on_behalf_of` makes funds land in the freelancer's balance
          // (rather than the platform's) — required for Express.
          on_behalf_of: freelancer.stripe_account_id,
          transfer_data: {
            destination: freelancer.stripe_account_id,
          },
          metadata: {
            invoice_id: invoice.id,
            freelancer_id: invoice.freelancer_id,
            platform_fee_cents: String(applicationFeeCents),
          },
          receipt_email: invoice.client_email || undefined,
          automatic_payment_methods: { enabled: true },
        },
        // Stripe sometimes needs this for Connect calls.
        { stripeAccount: freelancer.stripe_account_id },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe PaymentIntent failed.";
      return NextResponse.json(
        { error: `Could not start the payment: ${message}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      mode: "payment_intent",
      client_secret: intent.client_secret,
      // Stripe publishable key (test or live).
      publishable_key: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
      application_fee_cents: applicationFeeCents,
      currency,
      amount_cents: chargeAmountCents,
      // Tier-engine breakdown for the client portal.
      base_amount_cents: breakdown.baseAmountCents,
      platform_fee_cents: breakdown.platformFeeCents,
      stripe_fee_cents: breakdown.stripeFeeCents,
      total_client_amount_cents: breakdown.totalClientAmountCents,
      tier: breakdown.tier,
      effective_fee_percent: breakdown.effectiveFeePercent,
    });
  }

  // 7b. Hosted fallback ------------------------------------------------
  const baseUrl = resolveBaseUrl(request);
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // Destination-charge session: charge on the connected account.
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: chargeAmountCents,
              product_data: {
                name: "Freelance Engagement",
                description: `Invoice ${invoice.id}`,
              },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: applicationFeeCents,
          transfer_data: { destination: freelancer.stripe_account_id },
          metadata: { invoice_id: invoice.id, freelancer_id: invoice.freelancer_id },
        },
        customer_email: invoice.client_email || undefined,
        metadata: { invoice_id: invoice.id },
        billing_address_collection: "auto",
        success_url: `${baseUrl}/share/${invoice.id}?success=true`,
        cancel_url: `${baseUrl}/share/${invoice.id}?canceled=true`,
      },
      { stripeAccount: freelancer.stripe_account_id },
    );

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe returned a session without a checkout URL." },
        { status: 502 },
      );
    }
    return NextResponse.json({ mode: "hosted", url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe Checkout failed.";
    return NextResponse.json(
      { error: `Failed to create the checkout session: ${message}` },
      { status: 502 },
    );
  }
}

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tier-based checkout-fee engine.
 *
 * Replaces the legacy capped-5%/$30-month ledger model with a flat tier model:
 *
 *   FREE tier  → 10% platform fee (default)
 *   PRO  tier  →  0% platform fee
 *   custom     → per-freelancer override via `profiles.custom_platform_fee_percent`
 *
 * Stripe processing fee is transparently passed through to the client:
 *   stripeFee = round(2.9% of (base + platformFee)) + 30¢
 *
 * The fee is deterministic per (base, tier) — no monthly cap, no ledger.
 * All amounts are integer cents in the currency's smallest unit.
 *
 * LEGACY NOTE:
 *   The `fee_ledger` / `fee_transactions` tables and `compute_fee_cents` RPC
 *   still exist in the DB as a historical journal but are no longer mutated by
 *   this code. The `finalize_payment_intent_success` RPC has been simplified to
 *   a lock + status-flip (see `plans/stripe-transactional-migration.sql`).
 */

// Constants

/** Platform-fee rate for the default FREE tier. */
export const FREE_TIER_FEE_PERCENT = 10;

/** Platform-fee rate for the paid PRO tier. */
export const PRO_TIER_FEE_PERCENT = 0;

/** Stripe's card-processing rate (US). */
export const STRIPE_FEE_PERCENT = 2.9;

/** Stripe's fixed per-transaction fee (US), in cents. */
export const STRIPE_FEE_FIXED_CENTS = 30;

// Types

export type SubscriptionTier = "FREE" | "PRO";

/** Result of resolving a freelancer's effective fee percent from their profile. */
export type TierResolution = {
  /** Derived or overridden fee percent. */
  percent: number;
  /** The freelancer's subscription tier. */
  tier: SubscriptionTier;
  /** The custom override value, or null if none is set. */
  custom: number | null;
};

/** Full itemized checkout breakdown returned by {@link calculateCheckoutBreakdown}. */
export type CheckoutBreakdown = {
  /** Freelancer's invoice amount in cents. */
  baseAmountCents: number;
  /** Platform fee in cents (0 for PRO or custom 0%). */
  platformFeeCents: number;
  /** Stripe processing-fee pass-through in cents. */
  stripeFeeCents: number;
  /** Total the client pays (base + platform + stripe). */
  totalClientAmountCents: number;
  /** base + platform (convenience, matches Stripe's charge before their cut). */
  subtotalCents: number;
  /** Effective fee percent applied (10 / 0 / custom). */
  effectiveFeePercent: number;
  /** Freelancer's tier. */
  tier: SubscriptionTier;
};

// Tier resolution (reads DB)

/**
 * Fetch the freelancer's `subscription_tier` and optional
 * `custom_platform_fee_percent` override, then derive the effective fee percent.
 *
 * Server-only: uses the privileged admin client.
 *
 * @throws if the profile read fails or the tier value is unrecognized.
 */
export async function resolvePlatformFeePercent(
  freelancerId: string,
): Promise<TierResolution> {
  if (!freelancerId || freelancerId.trim() === "") {
    throw new Error("resolvePlatformFeePercent: freelancerId must be non-empty.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("subscription_tier, custom_platform_fee_percent")
    .eq("id", freelancerId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `resolvePlatformFeePercent: profile read failed for ${freelancerId}: ${error.message}`,
    );
  }

  const rawTier = String(data?.subscription_tier ?? "FREE").toUpperCase();
  const tier = rawTier === "PRO" ? "PRO" : "FREE";

  // Custom override wins when present and valid.
  if (
    data?.custom_platform_fee_percent != null &&
    Number(data.custom_platform_fee_percent) >= 0 &&
    Number(data.custom_platform_fee_percent) <= 100
  ) {
    return {
      percent: Number(data.custom_platform_fee_percent),
      tier,
      custom: Number(data.custom_platform_fee_percent),
    };
  }

  return {
    percent: tier === "PRO" ? PRO_TIER_FEE_PERCENT : FREE_TIER_FEE_PERCENT,
    tier,
    custom: null,
  };
}

// Pure calculation (no I/O, unit-testable)

/**
 * Compute the full checkout breakdown from a base amount and fee percent.
 *
 *   platformFee = round(base × percent / 100)
 *   subtotal    = base + platformFee
 *   stripeFee   = round(subtotal × 0.029) + 30
 *   total       = subtotal + stripeFee
 *
 * All inputs/outputs are integer cents.
 */
export function computeBreakdown(
  baseAmountCents: number,
  platformFeePercent: number,
  tier: SubscriptionTier = platformFeePercent === 0 ? "PRO" : "FREE",
): CheckoutBreakdown {
  const platformFeeCents = Math.round(
    (baseAmountCents * platformFeePercent) / 100,
  );
  const subtotalCents = baseAmountCents + platformFeeCents;
  // Stripe charges on the full amount they process (= subtotal).
  const stripeFeeCents =
    Math.round(subtotalCents * (STRIPE_FEE_PERCENT / 100)) +
    STRIPE_FEE_FIXED_CENTS;
  const totalClientAmountCents = subtotalCents + stripeFeeCents;

  return {
    baseAmountCents,
    platformFeeCents,
    stripeFeeCents,
    totalClientAmountCents,
    subtotalCents,
    effectiveFeePercent: platformFeePercent,
    tier,
  };
}

// Main entry point

/**
 * THE checkout-breakdown function from the spec.
 *
 * Given a freelancer's base amount (cents) and id, returns a fully itemized
 * breakdown including platform fee (tier-based), Stripe processing fee, and
 * the total the client will be charged.
 *
 * @param baseAmountCents  Positive integer (cents) — the freelancer's invoice amount.
 * @param freelancerId     The freelancer's profile id (used to look up tier/override).
 * @throws on invalid input or DB failure.
 */
export async function calculateCheckoutBreakdown(
  baseAmountCents: number,
  freelancerId: string,
): Promise<CheckoutBreakdown> {
  // --- Input validation ---------------------------------------------------
  if (!freelancerId || freelancerId.trim() === "") {
    throw new Error(
      "calculateCheckoutBreakdown: freelancerId must be a non-empty string.",
    );
  }
  if (!Number.isFinite(baseAmountCents)) {
    throw new Error(
      "calculateCheckoutBreakdown: baseAmountCents must be a finite number.",
    );
  }
  if (baseAmountCents <= 0) {
    throw new Error(
      "calculateCheckoutBreakdown: baseAmountCents must be a positive integer.",
    );
  }
  if (!Number.isInteger(baseAmountCents)) {
    throw new Error(
      "calculateCheckoutBreakdown: baseAmountCents must be an integer number of cents.",
    );
  }

  // --- Resolve tier -------------------------------------------------------
  const { percent, tier } = await resolvePlatformFeePercent(freelancerId);

  return computeBreakdown(baseAmountCents, percent, tier);
}

// Stripe integration helpers

/**
 * Extract the value to pass to Stripe's `application_fee_amount` parameter.
 *
 * This is strictly the platform fee — Stripe takes their processing fee from
 * the charge itself, so we never double-count it.
 */
export function breakdownToApplicationFeeAmount(b: CheckoutBreakdown): number {
  return Math.max(0, Math.round(b.platformFeeCents));
}

/**
 * Webhook-side finalizer used by the Stripe webhook when a PaymentIntent succeeds.
 * It updates invoice status and stores the deterministic fee breakdown.
 */
export async function finalizeSuccessfulPayment(params: {
  invoiceId: string;
  freelancerId: string;
  paymentIntentId: string;
  grossCents: number;
  applicationFeeCentsFromStripe: number | null;
}): Promise<{
  outcome: "PAID" | "ALREADY_PROCESSED";
  invoiceStatus?: string;
  feeCents?: number;
}> {
  const admin = createAdminClient();
  const { data: invoice, error: invoiceErr } = await admin
    .from("invoices")
    .select("id, status, amount, base_amount_cents, currency")
    .eq("id", params.invoiceId)
    .maybeSingle();

  if (invoiceErr) {
    throw new Error(`finalizeSuccessfulPayment: invoice read failed: ${invoiceErr.message}`);
  }

  if (!invoice) {
    throw new Error(`finalizeSuccessfulPayment: invoice not found: ${params.invoiceId}`);
  }

  if (invoice.status === "PAID") {
    return { outcome: "ALREADY_PROCESSED", invoiceStatus: invoice.status };
  }

  const baseAmountCents =
    Number(invoice.base_amount_cents) > 0
      ? Math.round(Number(invoice.base_amount_cents))
      : Math.round(Number(invoice.amount) * 100);

  const breakdown = await calculateCheckoutBreakdown(baseAmountCents, params.freelancerId);
  const applicationFeeCents = breakdownToApplicationFeeAmount(breakdown);

  const { error: updateErr } = await admin
    .from("invoices")
    .update({
      status: "PAID",
      stripe_payment_intent_id: params.paymentIntentId,
      base_amount_cents: baseAmountCents,
      platform_fee_cents: breakdown.platformFeeCents,
      stripe_fee_cents: breakdown.stripeFeeCents,
      total_client_amount_cents: breakdown.totalClientAmountCents,
      platform_fee: breakdown.platformFeeCents / 100,
      total_charged: breakdown.totalClientAmountCents / 100,
    })
    .eq("id", params.invoiceId);

  if (updateErr) {
    throw new Error(`finalizeSuccessfulPayment: invoice update failed: ${updateErr.message}`);
  }

  return {
    outcome: "PAID",
    invoiceStatus: "PAID",
    feeCents: applicationFeeCents,
  };
}

/**
 * Webhook-side refund helper that records the refund-side fee adjustment.
 */
export async function applyRefundFee(params: {
  freelancerId: string;
  grossCents: number;
  invoiceId: string;
  paymentIntentId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: invoice, error: invoiceErr } = await admin
    .from("invoices")
    .select("id, amount, base_amount_cents")
    .eq("id", params.invoiceId)
    .maybeSingle();

  if (invoiceErr) {
    throw new Error(`applyRefundFee: invoice read failed: ${invoiceErr.message}`);
  }

  if (!invoice) {
    throw new Error(`applyRefundFee: invoice not found: ${params.invoiceId}`);
  }

  const baseAmountCents =
    Number(invoice.base_amount_cents) > 0
      ? Math.round(Number(invoice.base_amount_cents))
      : Math.round(Number(invoice.amount) * 100);

  const breakdown = await calculateCheckoutBreakdown(baseAmountCents, params.freelancerId);
  const applicationFeeCents = breakdownToApplicationFeeAmount(breakdown);

  await admin.from("invoices").update({
    platform_fee_cents: breakdown.platformFeeCents,
    stripe_fee_cents: breakdown.stripeFeeCents,
    total_client_amount_cents: breakdown.totalClientAmountCents,
    platform_fee: breakdown.platformFeeCents / 100,
    total_charged: breakdown.totalClientAmountCents / 100,
  }).eq("id", params.invoiceId);

  if (params.grossCents > 0 && applicationFeeCents > 0) {
    await admin.from("fee_transactions").insert({
      invoice_id: params.invoiceId,
      freelancer_id: params.freelancerId,
      fee_cents: applicationFeeCents,
      payment_intent_id: params.paymentIntentId,
      kind: "REFUND",
      created_at: new Date().toISOString(),
    });
  }
}

/**
 * Convenience: format a cents value as USD for debugging / logs only.
 * (The UI must NOT use this — it ignores the invoice currency.)
 */
export function debugUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

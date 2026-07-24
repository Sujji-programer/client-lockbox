import Razorpay from "razorpay";

/**
 * Server-only Razorpay client singleton.
 *
 * Used by all server routes that talk to Razorpay (order creation with Route
 * splits, webhook signing verification that needs the secret, manual payment
 * capture, etc.). Never import this from a Client Component — anything pulled
 * into a route module graph must stay server-side.
 *
 * Created lazily so a missing key doesn't crash the build, only the affected
 * route at request time. Each call site is expected to call `getRazorpay()`
 * and catch the thrown Error to return a friendly 503 — mirroring
 * `lib/stripe/server.ts`.
 *
 * Required environment variables:
 *   • RAZORPAY_KEY_ID        — the public key id (key_…)
 *   • RAZORPAY_KEY_SECRET    — the matching secret
 *   • RAZORPAY_WEBHOOK_SECRET — signing secret for the webhook receiver
 *   • RAZORPAY_MASTER_ACCOUNT_ID — the platform account id used as the Route
 *                                  destination for the platform-fee split.
 */

let cached: Razorpay | null = null;

/**
 * Lazily resolve a configured `Razorpay` instance. Throws on missing env so
 * the route can surface a clean 503 rather than crashing the boot.
 */
export function getRazorpay(): Razorpay {
  if (cached) return cached;

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || key_id.trim() === "" || !key_secret || key_secret.trim() === "") {
    throw new Error(
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. Configure them before this route can mint orders.",
    );
  }

  cached = new Razorpay({
    key_id,
    key_secret,
  });

  return cached;
}

/**
 * The publishable key id only — safe to expose to the browser so the Razorpay
 * Checkout SDK can open the payment modal. Returns the same value as
 * `getRazorpay()`'s key id but never throws if the secret is missing.
 */
export function getRazorpayKeyId(): string {
  const key_id = process.env.RAZORPAY_KEY_ID;
  if (!key_id || key_id.trim() === "") {
    throw new Error("RAZORPAY_KEY_ID is not set. The checkout SDK needs it to open the modal.");
  }
  return key_id;
}

/**
 * Fail-closed webhook signing secret. There is no unverified dev bypass —
 * rejecting unsigned payloads is the only safe default.
 */
export function requireRazorpayWebhookSecret(): string {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is not set. The webhook cannot verify requests without it — refusing to process.",
    );
  }
  return secret;
}

/**
 * The platform/master account id used as the Route destination for the
 * platform-fee split. The freelancer keeps the net payout in their own Linked
 * Account and the remainder is routed here.
 */
export function requireRazorpayMasterAccountId(): string {
  const id = process.env.RAZORPAY_MASTER_ACCOUNT_ID;
  if (!id || id.trim() === "") {
    throw new Error(
      "RAZORPAY_MASTER_ACCOUNT_ID is not set. Order Route splits need it to route the platform fee.",
    );
  }
  return id;
}

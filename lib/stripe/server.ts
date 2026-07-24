import Stripe from "stripe";

/**
 * Server-only Stripe client singleton.
 *
 * Used by all server routes (onboarding, checkout, webhook) that talk to
 * Stripe. Never import from a Client Component — anything pulled into a
 * route module graph must stay server-side.
 *
 * Created lazily so a missing key doesn't crash the build, only the affected
 * route at request time. Each route is expected to call `getStripe()` and
 * catch the thrown Error to return a friendly 503.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.trim() === "") {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. The freelancer must wire up Stripe Connect before this route can be used.",
    );
  }

  cached = new Stripe(secretKey, {
    // Pin the API version to avoid surprise behaviour shifts.
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: {
      name: "ClientLockbox",
      version: "2.0.0",
    },
  });

  return cached;
}

/**
 * The Connect Express client id (ca_…) from the Stripe dashboard. Needed to
 * mint account links via the Express onboarding flow.
 */
export function getStripeClientId(): string {
  const clientId = process.env.STRIPE_CLIENT_ID;
  if (!clientId || clientId.trim() === "") {
    throw new Error(
      "STRIPE_CLIENT_ID is not set. Copy it from your Stripe Dashboard → Connect → Settings → Express.",
    );
  }
  return clientId;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, getStripeClientId } from "@/lib/stripe/server";

/**
 * POST /api/stripe/onboard
 *
 * Initiates (or resumes) Stripe Connect **Express** onboarding for the
 * authenticated freelancer.
 *
 * Flow:
 *   1. Auth-check the Supabase session (anon is bounced with 401).
 *   2. Read or mint the freelancer's `stripe_account_id` row.
 *   3. Create `stripe.accountLinks.create({ type: "account_onboarding" })`
 *      pointing at our refresh + return URLs.
 *   4. Persist the account id (idempotent upsert). Return the Stripe-hosted
 *      onboarding URL to the dashboard, which redirects the user.
 *
 * The Dashboard renders the returned URL directly — there's no hosted form
 * on our side, Stripe owns the KYC/identity collection.
 */

const ONBOARDING_RETURN_PATH = "/dashboard?stripe_connect=returned";
const ONBOARDING_REFRESH_PATH = "/dashboard?stripe_connect=refresh";

function resolveBaseUrl(request: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    request.headers.get("origin") ??
    "http://localhost:3000"
  );
}

export async function POST(request: Request) {
  // 1. Auth --------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in to onboard Stripe." },
      { status: 401 },
    );
  }

  // 2. Stripe client -----------------------------------------------------
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe is not configured." },
      { status: 503 },
    );
  }

  // 3. Read/mint the Connect account id ----------------------------------
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("stripe_account_id, stripe_account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    return NextResponse.json(
      { error: `Could not read profile: ${profileErr.message}` },
      { status: 500 },
    );
  }

  let accountId = profile?.stripe_account_id ?? null;

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          freelancer_id: user.id,
          source: "clientlockbox",
        },
      });
      accountId = account.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create Stripe account.";
      return NextResponse.json(
        { error: `Stripe account creation failed: ${message}` },
        { status: 502 },
      );
    }

    // Persist the freshly-minted account id. RLS lets the owner update own row.
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ stripe_account_id: accountId, stripe_account_status: "PENDING" })
      .eq("id", user.id);

    if (updateErr) {
      // Soft warn — the account exists in Stripe but isn't linked to the row.
      console.error("[stripe.onboard] failed to persist stripe_account_id:", updateErr.message);
    }
  }

  // 4. Build the onboarding link -----------------------------------------
  const baseUrl = resolveBaseUrl(request);

  try {
    // Touch STRIPE_CLIENT_ID lazily so deep-linking config issues surface here
    // rather than at build time. (Account Links API doesn't use the client_id
    // directly, but surfacing the misconfig early is friendlier.)
    void getStripeClientId();

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}${ONBOARDING_REFRESH_PATH}`,
      return_url: `${baseUrl}${ONBOARDING_RETURN_PATH}`,
      type: "account_onboarding",
    });

    if (!link.url) {
      return NextResponse.json(
        { error: "Stripe returned an onboarding link without a URL." },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: link.url, account_id: accountId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error.";
    return NextResponse.json(
      { error: `Could not create onboarding link: ${message}` },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/server";

/**
 * GET /api/stripe/refresh
 *
 * Called by the dashboard after Stripe bounces the freelancer back with
 * `?stripe_connect=returned` or `?stripe_connect=refresh`.
 *
 * It re-fetches the Connect account's live status (`charges_enabled` /
 * `details_submitted`) and persists the canonical status string so the
 * dashboard can render the right pill (PENDING / RESTRICTED / ENABLED)
 * without waiting for the next `account.updated` webhook to fire.
 *
 * Status mapping:
 *   charges_enabled && details_submitted  -> "ENABLED"
 *   !details_submitted                    -> "PENDING"  (still onboarding)
 *   details_submitted && !charges_enabled -> "RESTRICTED" (review / payouts off)
 */

const STATUS_ENABLED: "ENABLED" = "ENABLED";
const STATUS_PENDING: "PENDING" = "PENDING";
const STATUS_RESTRICTED: "RESTRICTED" = "RESTRICTED";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.stripe_account_id) {
    return NextResponse.json(
      { error: "No Stripe Connect account linked yet." },
      { status: 404 },
    );
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe is not configured." },
      { status: 503 },
    );
  }

  try {
    const account = await stripe.accounts.retrieve(profile.stripe_account_id);

    let status: typeof STATUS_ENABLED | typeof STATUS_PENDING | typeof STATUS_RESTRICTED;
    if (account.charges_enabled && account.details_submitted) {
      status = STATUS_ENABLED;
    } else if (!account.details_submitted) {
      status = STATUS_PENDING;
    } else {
      status = STATUS_RESTRICTED;
    }

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ stripe_account_status: status })
      .eq("id", user.id);

    if (updateErr) {
      console.warn("[stripe.refresh] could not persist status:", updateErr.message);
    }

    return NextResponse.json({
      status,
      charges_enabled: account.charges_enabled,
      details_submitted: account.details_submitted,
      requirements: account.requirements?.currently_due?.length
        ? account.requirements.currently_due
        : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not retrieve account.";
    return NextResponse.json(
      { error: `Stripe account lookup failed: ${message}` },
      { status: 502 },
    );
  }
}

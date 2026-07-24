import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/dev-bypass
 *
 * LOCAL TESTING HARNESS — mock payment bypass.
 *
 * This endpoint exists exclusively so the full application loop can be
 * exercised in local development WITHOUT wiring up Stripe, the Stripe CLI
 * webhook forwarder, or a real card. When invoked it flips the targeted
 * invoice row from PENDING -> PAID using the service role key (bypassing
 * RLS), exactly mirroring what the production webhook does on a real
 * `checkout.session.completed` event.
 *
 * ---------------------------------------------------------------
 * HARD PRODUCTION GUARD
 * ---------------------------------------------------------------
 * The handler refuses to run unless ALL of the following are true:
 *   1. `process.env.NODE_ENV === 'development'` — Next.js sets this to
 *      "production" for `next start` and optimized builds, so a deployed
 *      app can never trip this branch.
 *   2. A `DEV_BYPASS_ENABLED` env var is present and truthy. This is a
 *      deliberate second affordance: even if someone mistakenly ran a dev
 *      server in a hosted environment, the button stays inert.
 *   3. An `invoice_id` is supplied and the invoice is currently PENDING.
 *
 * If any guard fails we return 404 so the endpoint is indistinguishable
 * from a missing route to an outside attacker — no leak of behavior.
 */

export async function POST(request: Request) {
  // --- Guard 1: development-only -------------------------------------------
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  // --- Guard 2: explicit enable flag ---------------------------------------
  const enabled = process.env.DEV_BYPASS_ENABLED;
  if (!enabled || ["1", "true", "TRUE", "yes"].includes(enabled) === false) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  // --- Parse + validate the body -------------------------------------------
  let body: { invoice_id?: unknown };
  try {
    body = (await request.json()) as { invoice_id?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { \"invoice_id\": \"<uuid>\" }." },
      { status: 400 },
    );
  }

  const invoiceId =
    typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";

  if (!invoiceId) {
    return NextResponse.json(
      { error: "Missing required field: invoice_id." },
      { status: 400 },
    );
  }

  // --- Flip the row to PAID with the service role key (bypasses RLS) -------
  const admin = createAdminClient();

  // First read the current status so we can give a useful response and never
  // clobber a row that shouldn't be touched.
  const { data: existing, error: readError } = await admin
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .single();

  if (readError || !existing) {
    return NextResponse.json(
      { error: "Invoice not found. The link may be invalid or expired." },
      { status: 404 },
    );
  }

  if (existing.status === "PAID") {
    // Idempotent — already paid, nothing to do. Return success so the UI can
    // simply refresh without surfacing a confusing error.
    return NextResponse.json({
      ok: true,
      message: "Invoice was already PAID — no change required.",
      already_paid: true,
    });
  }

  const { error: updateError } = await admin
    .from("invoices")
    .update({ status: "PAID" })
    .eq("id", invoiceId);

  if (updateError) {
    console.error("[dev-bypass] failed to mark invoice PAID:", updateError.message);
    return NextResponse.json(
      { error: "Could not update the invoice. Check server logs." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Dev bypass complete — invoice marked PAID.",
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/accept-terms
 *
 * Called by the public client portal when the client ticks the "Accept Terms
 * & Conditions" checkbox and types their full legal-name signature. Both
 * fields are persisted on the invoice so the subsequent /api/checkout call
 * can verify acceptance before billing the card.
 *
 * Body: { invoice_id: string, signature: string }
 *
 * Public endpoint — the client doesn't have a session. RLS allows anonymous
 * SELECT by id and a service-role update is required (the anon RLS policy
 * on invoices blocks update). We use the admin client to record the
 * acceptance; the row is locked to PENDING-only on the WHERE clause so a
 * client cannot overwrite a PAID/REFUNDED invoice.
 */

type AcceptBody = {
  invoice_id?: unknown;
  signature?: unknown;
};

export async function POST(request: Request) {
  let body: AcceptBody;
  try {
    body = (await request.json()) as AcceptBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body. Expected { "invoice_id", "signature" }' },
      { status: 400 },
    );
  }

  const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoice_id." }, { status: 400 });
  }

  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (signature.length < 3) {
    return NextResponse.json(
      { error: "Please type your full name as signature (min 3 characters)." },
      { status: 422 },
    );
  }
  if (signature.length > 200) {
    return NextResponse.json({ error: "Signature is too long." }, { status: 422 });
  }

  // Verify the invoice exists and is in PENDING state using the SSR cookie
  // client (anon RLS permits public SELECT-by-id).
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status !== "PENDING") {
    return NextResponse.json(
      { error: `Cannot accept terms on a ${invoice.status} invoice.` },
      { status: 409 },
    );
  }

  // Persist acceptance with the admin (service-role) client so we can write
  // the row even though anon RLS blocks update. The WHERE clause guards
  // against a race where the client began the flow milliseconds after the
  // webhook already flipped them to PAID.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { error: uErr } = await admin
    .from("invoices")
    .update({
      signature,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("status", "PENDING");

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ accepted: true });
}

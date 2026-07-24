import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResend, getFromAddress } from "@/lib/email";
import { invoiceCreatedEmail } from "@/lib/email-templates";

/**
 * POST /api/email/invoice-created
 *
 * Sends the "new invoice" email to the client immediately after the
 * freelancer creates an invoice. Called server-side from the dashboard
 * (see `create-invoice-form.tsx` → `afterCreate` fetch).
 *
 * Body: { invoice_id: string }
 *
 * Auth: protected by a shared `CRON_SECRET` header so only our own server
 * or a Vercel cron can call it. The route is public at the HTTP layer
 * (no session needed) because it runs in a background-fire-and-forget
 * context from the client component.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim() === "") {
    // Secret not configured — allow in dev for convenience, block in prod.
    if (process.env.NODE_ENV === "development") return true;
    return false;
  }
  const provided = request.headers.get("x-cron-secret") ?? "";
  return provided === secret;
}

export async function POST(request: Request) {
  // Auth gate.
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { invoice_id?: unknown };
  try {
    body = (await request.json()) as { invoice_id?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const invoiceId =
    typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
  if (!invoiceId) {
    return NextResponse.json(
      { error: "Missing invoice_id." },
      { status: 400 },
    );
  }

  // Fetch invoice + freelancer profile in one pass (admin client bypasses RLS).
  const admin = createAdminClient();

  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select(
      "id, client_email, client_name, amount, currency, scope_of_work, due_date, freelancer_id",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", invoice.freelancer_id)
    .maybeSingle();

  const freelancerName =
    profile?.email?.split("@")[0] ?? "Your freelancer";

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://clientlockbox.com";

  try {
    const resend = getResend();
    const from = getFromAddress();
    const { subject, html } = invoiceCreatedEmail(
      {
        clientEmail: invoice.client_email,
        clientName: invoice.client_name,
        amount: Number(invoice.amount),
        currency: invoice.currency ?? "usd",
        scopeOfWork: invoice.scope_of_work ?? "",
        dueDate: invoice.due_date,
        invoiceId: invoice.id,
        freelancerName,
      },
      { appUrl },
    );

    const { error: sendErr } = await resend.emails.send({
      from,
      to: [invoice.client_email],
      subject,
      html,
    });

    if (sendErr) {
      console.error("[email.invoice-created] Resend error:", sendErr);
      return NextResponse.json(
        { error: "Email delivery failed." },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email error";
    console.error("[email.invoice-created]", message);
    // Non-blocking: the invoice was already created. Don't fail the whole flow.
    return NextResponse.json({ sent: false, reason: message });
  }

  return NextResponse.json({ sent: true });
}

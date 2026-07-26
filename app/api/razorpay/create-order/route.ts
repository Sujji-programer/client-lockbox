import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/razorpay/create-order
 *
 * Two call patterns:
 *
 *   A. Dashboard "Create Paywalled Deliverable" modal:
 *      Body: { clientName, clientEmail, projectTitle, baseAmountUsd,
 *              grossChargeUsd, platformFeeUsd, planType, autoExpiry,
 *              expiryDays, deliveryPassword? }
 *      → Inserts a new invoice row → creates a Razorpay Order → returns
 *        { invoiceId, orderId, amount, currency, keyId, payLink }
 *
 *   B. Paywall page checkout trigger:
 *      Body: { invoiceId }
 *      → Fetches existing invoice → creates Razorpay Order → returns
 *        { orderId, amount, currency, keyId }
 *
 * Payment splitting via Razorpay Route (transfers):
 *   - Platform fee goes to the master Razorpay account (retained automatically).
 *   - Net payout is transferred to the freelancer's Razorpay Linked Account
 *     (`razorpay_account_id` on the profiles row) via the `transfers` array.
 *
 * All amounts are in the smallest currency unit (paise for INR, cents for USD).
 * The route uses USD here but the grossCharge passed from the modal is USD so
 * we convert to cents (× 100).  For live INR deployments replace `usd`→`inr`
 * and adjust the multiplier accordingly.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRazorpay(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set. " +
        "Add them via the Vars section in project settings.",
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

type CreateOrderBody =
  | {
      // Pattern B — existing invoice
      invoiceId: string;
    }
  | {
      // Pattern A — new deliverable from dashboard modal
      clientName: string;
      clientEmail: string;
      projectTitle: string;
      baseAmountUsd: number;
      grossChargeUsd: number;
      platformFeeUsd: number;
      planType: "FREE" | "PRO";
      autoExpiry: boolean;
      expiryDays: number;
      deliveryPassword?: string | null;
    };

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function POST(request: Request) {
  // ── Parse body ──────────────────────────────────────────────────────────
  let body: CreateOrderBody;
  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Resolve or create invoice ────────────────────────────────────────────
  let invoiceId: string;
  let grossAmountCents: number; // in USD cents
  let platformFeeCents: number;
  let freelancerId: string | null = null;

  if ("invoiceId" in body) {
    // ── Pattern B: existing invoice ──────────────────────────────────────
    invoiceId = body.invoiceId.trim();
    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId is required." }, { status: 400 });
    }

    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id, freelancer_id, total_charged, platform_fee, status, currency")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr || !inv) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    if (inv.status === "PAID") {
      return NextResponse.json({ error: "Invoice already paid." }, { status: 409 });
    }

    grossAmountCents = Math.round(Number(inv.total_charged) * 100);
    platformFeeCents = Math.round(Number(inv.platform_fee) * 100);
    freelancerId = inv.freelancer_id as string | null;
  } else {
    // ── Pattern A: new invoice from modal ────────────────────────────────
    const {
      clientName,
      clientEmail,
      projectTitle,
      baseAmountUsd,
      grossChargeUsd,
      platformFeeUsd,
      planType,
      autoExpiry,
      expiryDays,
      deliveryPassword,
    } = body;

    if (!clientName || !clientEmail || !projectTitle || !baseAmountUsd || !grossChargeUsd) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    // Resolve the calling freelancer from their session
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    freelancerId = user.id;

    grossAmountCents = Math.round(grossChargeUsd * 100);
    platformFeeCents = Math.round(platformFeeUsd * 100);
    const baseAmountCents = Math.round(baseAmountUsd * 100);
    const razorpayFeeCents = grossAmountCents - baseAmountCents - platformFeeCents;

    invoiceId = generateId();
    const expiresAt =
      autoExpiry
        ? new Date(Date.now() + expiryDays * 86_400_000).toISOString()
        : null;

    const row = {
      id: invoiceId,
      freelancer_id: freelancerId,
      client_name: clientName,
      client_email: clientEmail,
      scope_of_work: projectTitle,
      amount: baseAmountUsd,
      platform_fee: platformFeeUsd,
      total_charged: grossChargeUsd,
      base_amount_cents: baseAmountCents,
      platform_fee_cents: platformFeeCents,
      stripe_fee_cents: razorpayFeeCents, // repurposed column for Razorpay fee
      total_client_amount_cents: grossAmountCents,
      currency: "usd",
      status: "PENDING" as const,
      plan_type: planType,
      delivery_password: deliveryPassword ?? null,
      expires_at: expiresAt,
      file_path: null,
      signature: null,
      accepted_at: null,
    };

    const { error: insErr } = await admin.from("invoices").insert(row);
    if (insErr) {
      console.error("[razorpay.create-order] insert error:", insErr.message);
      return NextResponse.json(
        { error: `Could not create invoice: ${insErr.message}` },
        { status: 500 },
      );
    }
  }

  // ── Resolve freelancer's Razorpay linked account ─────────────────────────
  let razorpayLinkedAccountId: string | null = null;
  if (freelancerId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("razorpay_account_id")
      .eq("id", freelancerId)
      .maybeSingle();
    razorpayLinkedAccountId = (profile?.razorpay_account_id as string | null) ?? null;
  }

  // ── Initialise Razorpay SDK ──────────────────────────────────────────────
  let razorpay: Razorpay;
  try {
    razorpay = getRazorpay();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Razorpay not configured.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  // ── Create Razorpay Order ────────────────────────────────────────────────
  // `transfers` (Razorpay Route) splits the captured payment:
  //   - Platform fee stays on the master account automatically.
  //   - Net payout is transferred to the freelancer's Linked Account.
  const netPayoutCents = grossAmountCents - platformFeeCents;

  let order: Awaited<ReturnType<typeof razorpay.orders.create>>;
  try {
    order = await razorpay.orders.create({
      amount: grossAmountCents, // in smallest currency unit (USD cents)
      currency: "USD",
      receipt: `invoice_${invoiceId.slice(0, 20)}`,
      notes: {
        invoice_id: invoiceId,
        freelancer_id: freelancerId ?? "unknown",
        platform_fee_cents: String(platformFeeCents),
      },
      // Razorpay Route — conditionally add transfers if freelancer has a
      // linked account. Without a linked account the full amount lands on
      // the platform master and can be paid out manually.
      ...(razorpayLinkedAccountId
        ? {
            transfers: [
              {
                account: razorpayLinkedAccountId,
                amount: netPayoutCents,
                currency: "USD",
                notes: {
                  invoice_id: invoiceId,
                  payout_type: "net_freelancer_payout",
                },
                linked_account_notes: ["invoice_id"],
                on_hold: false,
              },
            ],
          }
        : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Razorpay order creation failed.";
    console.error("[razorpay.create-order] order create error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Persist the Razorpay order_id on the invoice row for webhook reconciliation
  await admin
    .from("invoices")
    .update({ razorpay_order_id: order.id })
    .eq("id", invoiceId);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    request.headers.get("origin") ??
    "http://localhost:3000";

  return NextResponse.json({
    invoiceId,
    orderId: order.id,
    amount: order.amount,        // in smallest unit
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    payLink: `${baseUrl}/deliver/${invoiceId}`,
  });
}

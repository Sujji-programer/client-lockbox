import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRazorpay, requireRazorpayMasterAccountId } from "@/lib/razorpay/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/razorpay/create-order
 *
 * Mints a Razorpay Order for a previously created invoice row and wires the
 * Route split payload so the platform fee is routed to the master account and
 * the remaining net payout stays with the freelancer's Linked Account.
 *
 * Request body:
 *   { "invoiceId": "<uuid>" }
 *
 * Flow:
 *   1. Resolve the freelancer's session via the SSR client.
 *   2. Fetch the invoice (with its `amount`, `platform_fee`, owner's
 *      `subscription_tier` and `razorpay_linked_account_id`).
 *   3. Compute the grossed-up client total (Razorpay processing fees are
 *      rolled into the amount the client pays; the freelancer's net stays at
 *      the base).
 *   4. Create a Razorpay Order with `transfers` payload:
 *        - one transfer to the master account  = platform fee
 *        - one transfer to the Linked Account = net payout
 *   5. Persist the `razorpay_order_id` onto the invoice row and return the
 *      order details + the publishable key_id so the browser can open
 *      Razorpay Checkout.
 *
 * Security:
 *   • The SSR client enforces RLS — we only ever touch invoices owned by the
 *     authenticated freelancer. The admin client is used only for the
 *     order-id writeback *after* ownership is confirmed.
 */

type InvoiceRow = {
  id: string;
  freelancer_id: string;
  amount: number; // base amount, in major units (e.g. dollars)
  platform_fee: number; // major units
  total_charged: number; // major units (client due)
  currency: string; // lowercase ISO 4217
  status: "PENDING" | "PAID";
};

type ProfileRow = {
  id: string;
  subscription_tier: "FREE" | "PRO";
  razorpay_linked_account_id: string | null;
  custom_platform_fee_percent: number | null;
};

/** Convert a major-unit amount to Razorpay's smallest unit (paise for INR). */
function toSmallestUnit(major: number, currency: string): number {
  // INR uses paise (×100). Most other supported currencies are 2-decimal too;
  // JPY and the zero-decimal set stay as whole units.
  const zeroDecimal = new Set(["jpy", "krw", "vnd", "clp", "kwd", "bhd"]);
  const code = currency.toLowerCase();
  return zeroDecimal.has(code) ? Math.round(major) : Math.round(major * 100);
}

/** Compute the per-transfer amounts in smallest units, accounting for rounding. */
function splitAmounts(
  totalMinor: number,
  baseMinor: number,
  feeMinor: number,
): { platformTransferMinor: number; netTransferMinor: number } {
  // The platform fee is transferred to the master account; the remaining balance
  // is assigned to the freelancer's Linked Account. We let Razorpay reconcile
  // the rounding difference into the net transfer so the two always sum to the
  // total charged to the client.
  const platformTransferMinor = Math.max(0, feeMinor);
  const netTransferMinor = Math.max(0, totalMinor - platformTransferMinor);
  return { platformTransferMinor, netTransferMinor };
}

export async function POST(request: Request) {
  // ── 1. Auth ─────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const freelancerId = user.id;

  // ── 2. Body ─────────────────────────────────────────────────────────────
  let body: { invoiceId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const invoiceId = body.invoiceId?.trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId is required." }, { status: 400 });
  }

  // ── 3. Fetch the invoice + freelancer profile (RLS-scoped) ──────────────
  // The SSR client runs under RLS so this read is naturally ownership-bounded.
  const { data: invoice, error: invErr } = (await supabase
    .from("invoices")
    .select("id, freelancer_id, amount, platform_fee, total_charged, currency, status")
    .eq("id", invoiceId)
    .maybeSingle()) as { data: InvoiceRow | null; error: { message: string } | null };

  if (invErr) {
    console.error("[razorpay.create-order] invoice lookup failed:", invErr.message);
    return NextResponse.json({ error: "Failed to look up invoice." }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.freelancer_id !== freelancerId) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status === "PAID") {
    return NextResponse.json({ error: "Invoice is already paid." }, { status: 409 });
  }

  const { data: profile, error: profErr } = (await supabase
    .from("profiles")
    .select("id, subscription_tier, razorpay_linked_account_id, custom_platform_fee_percent")
    .eq("id", freelancerId)
    .maybeSingle()) as { data: ProfileRow | null; error: { message: string } | null };

  if (profErr || !profile) {
    console.error("[razorpay.create-order] profile lookup failed:", profErr?.message);
    return NextResponse.json({ error: "Freelancer profile not found." }, { status: 500 });
  }
  if (!profile.razorpay_linked_account_id) {
    return NextResponse.json(
      {
        error:
          "Razorpay Linked Account not connected. The freelancer must complete Razorpay onboarding before creating orders.",
      },
      { status: 409 },
    );
  }

  // ── 4. Resolve the gross client amount ──────────────────────────────────
  // `total_charged` already encodes the grossed-up client due
  // (base + platform_fee + razorpay_fee). If the row predates that computation
  // we fall back to the gross-up formula here.
  const currency = (invoice.currency || "inr").toLowerCase();
  const totalClientMajor =
    invoice.total_charged > 0 ? invoice.total_charged : invoice.amount + (invoice.platform_fee || 0);

  if (totalClientMajor <= 0) {
    return NextResponse.json({ error: "Invoice total must be greater than zero." }, { status: 422 });
  }

  const amountMinor = toSmallestUnit(totalClientMajor, currency);
  const platformFeeMinor = toSmallestUnit(invoice.platform_fee || 0, currency);
  const baseMinor = toSmallestUnit(invoice.amount, currency);
  const { platformTransferMinor, netTransferMinor } = splitAmounts(
    amountMinor,
    baseMinor,
    platformFeeMinor,
  );

  // ── 5. Mint the Razorpay order with Route splits ────────────────────────
  const razorpay = (() => {
    try {
      return getRazorpay();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Razorpay client unavailable";
      console.error("[razorpay.create-order] refusing:", message);
      return null;
    }
  })();
  if (!razorpay) {
    return NextResponse.json({ error: "Razorpay is not configured." }, { status: 503 });
  }

  const masterAccountId = (() => {
    try {
      return requireRazorpayMasterAccountId();
    } catch (err) {
      const message = err instanceof Error ? err.message : "master account missing";
      console.error("[razorpay.create-order] refusing:", message);
      return null;
    }
  })();
  if (!masterAccountId) {
    return NextResponse.json({ error: "Platform account not configured." }, { status: 503 });
  }

  // Razorpay Route: a `transfers` array is attached to the order so capture
  // automatically settles the split amounts to each destination account.
  const orderOptions = {
    amount: amountMinor,
    currency: currency.toUpperCase(),
    receipt: `inv_${invoice.id.replace(/-/g, "").slice(0, 24)}`,
    notes: {
      invoice_id: invoice.id,
      freelancer_id: freelancerId,
      tier: profile.subscription_tier,
    },
    // Route split — see Razorpay Route docs. The order total MUST equal the sum
    // of the transfers, which `splitAmounts` guarantees.
    transfers: [
      {
        account: masterAccountId,
        amount: platformTransferMinor,
        currency: currency.toUpperCase(),
        on_hold: false,
        notes: { kind: "platform_fee" },
      },
      {
        account: profile.razorpay_linked_account_id,
        amount: netTransferMinor,
        currency: currency.toUpperCase(),
        on_hold: false,
        notes: { kind: "freelancer_payout" },
      },
    ],
  } as const;

  let order: { id: string; amount: number; currency: string; status: string } | null = null;
  try {
    order = (await razorpay.orders.create(orderOptions as unknown as Parameters<typeof razorpay.orders.create>[0])) as {
      id: string;
      amount: number;
      currency: string;
      status: string;
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Razorpay order creation failed";
    console.error("[razorpay.create-order] order.create threw:", message);
    return NextResponse.json({ error: "Failed to create Razorpay order." }, { status: 502 });
  }

  if (!order || !order.id) {
    return NextResponse.json({ error: "Razorpay returned no order id." }, { status: 502 });
  }

  // ── 6. Persist the order id (admin client — bypasses RLS) ───────────────
  const admin = createAdminClient();
  const { error: writeErr } = await admin
    .from("invoices")
    .update({ razorpay_order_id: order.id })
    .eq("id", invoice.id);

  if (writeErr) {
    // The order is already minted at Razorpay; we log loudly rather than roll
    // back — the webhook handler can reconcile from the payment signature.
    console.error(
      "[razorpay.create-order] failed to persist razorpay_order_id:",
      writeErr.message,
    );
  }

  // ── 7. Respond with order + publishable key ────────────────────────────
  return NextResponse.json({
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    key_id: process.env.RAZORPAY_KEY_ID ?? "",
    invoice_id: invoice.id,
  });
}

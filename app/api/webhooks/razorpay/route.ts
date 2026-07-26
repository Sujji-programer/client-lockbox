import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * POST /api/webhooks/razorpay
 *
 * Razorpay Webhook handler. Register this URL in your Razorpay Dashboard under
 * Settings → Webhooks with the following events enabled:
 *   - order.paid
 *   - payment.captured
 *
 * Security model:
 *   - Fail-closed HMAC-SHA256 signature verification using `RAZORPAY_WEBHOOK_SECRET`.
 *   - If the secret is missing or the signature doesn't match the request is
 *     rejected with 400. There is no dev-bypass branch.
 *   - Raw body is read before any JSON parsing so the verified bytes are used
 *     for the HMAC — a tampered payload will never reach the handler.
 *   - Idempotent: if the invoice is already PAID the event is acknowledged (2xx)
 *     without double-processing.
 *
 * On successful payment:
 *   1. Flips invoice status PENDING → PAID in Supabase.
 *   2. Generates a short-lived (1-hour) presigned Cloudflare R2 download URL
 *      for the original high-res vault deliverable.
 *   3. Stores the presigned URL + expiry timestamp on the invoice row so the
 *      deliver page can serve it to the client without hitting this route again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyRazorpayWebhook(payload: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is not set. Add it in the Vars section of project settings. " +
        "Copy it from Razorpay Dashboard → Settings → Webhooks → your webhook → Secret.",
    );
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  // Timing-safe comparison prevents timing oracle attacks
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// R2 presigned URL (1-hour expiry)
// ---------------------------------------------------------------------------

async function generateR2PresignedUrl(vaultKey: string): Promise<string | null> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.warn("[razorpay.webhook] R2 env vars not configured — skipping presign.");
    return null;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const command = new GetObjectCommand({ Bucket: bucket, Key: vaultKey });
  // 1-hour presigned URL
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

// ---------------------------------------------------------------------------
// Webhook event types (minimal — only the fields we use)
// ---------------------------------------------------------------------------

type RazorpayOrder = {
  id: string;
  notes?: { invoice_id?: string; freelancer_id?: string };
};

type RazorpayPayment = {
  id: string;
  order_id: string;
  status: string;
};

type RazorpayWebhookEvent = {
  event: string;
  payload: {
    order?: { entity: RazorpayOrder };
    payment?: { entity: RazorpayPayment };
  };
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Raw body — must remain pristine for HMAC verification
  const payload = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (!signature) {
    console.warn("[razorpay.webhook] missing x-razorpay-signature header");
    return NextResponse.json({ error: "Missing signature header." }, { status: 400 });
  }

  // 2. Fail-closed signature check
  let verified = false;
  try {
    verified = verifyRazorpayWebhook(payload, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification error";
    console.error("[razorpay.webhook] config error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!verified) {
    console.warn("[razorpay.webhook] signature mismatch — rejecting");
    return NextResponse.json({ error: "Webhook signature verification failed." }, { status: 400 });
  }

  // 3. Parse event
  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(payload) as RazorpayWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  const { event: eventType, payload: eventPayload } = event;

  // 4. Handle order.paid or payment.captured
  if (eventType === "order.paid" || eventType === "payment.captured") {
    // Resolve invoice_id from the order notes (set when we created the order)
    const orderNotes = eventPayload.order?.entity?.notes;
    const orderId = eventPayload.order?.entity?.id ?? eventPayload.payment?.entity?.order_id ?? "";
    const invoiceId = (orderNotes?.invoice_id ?? "").trim();

    if (!invoiceId && !orderId) {
      // Cannot reconcile — acknowledge so Razorpay stops retrying
      console.warn("[razorpay.webhook] event has no invoice_id or order_id in notes:", eventType);
      return NextResponse.json({ received: true, ignored: "no_invoice_ref" });
    }

    const admin = createAdminClient();

    // Lookup by invoice_id from notes (preferred) or by razorpay_order_id column
    let query = admin.from("invoices").select("id, status, vault_file_key");
    if (invoiceId) {
      query = query.eq("id", invoiceId);
    } else {
      query = query.eq("razorpay_order_id", orderId);
    }
    const { data: inv, error: lookupErr } = await query.maybeSingle();

    if (lookupErr || !inv) {
      console.error("[razorpay.webhook] invoice lookup failed:", lookupErr?.message ?? "not found");
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    // Idempotency: already PAID
    if (inv.status === "PAID") {
      return NextResponse.json({ received: true, status: "PAID", dedup: true });
    }

    // 5. Generate presigned R2 download URL (1-hour) if vault file exists
    let downloadUrl: string | null = null;
    let downloadUrlExpiresAt: string | null = null;

    if (inv.vault_file_key) {
      try {
        downloadUrl = await generateR2PresignedUrl(inv.vault_file_key as string);
        if (downloadUrl) {
          downloadUrlExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
        }
      } catch (err) {
        console.error("[razorpay.webhook] presign failed:", err instanceof Error ? err.message : err);
        // Non-fatal — proceed without presigned URL; it can be regenerated on demand
      }
    }

    // 6. Flip invoice PENDING → PAID atomically
    const updatePayload: Record<string, unknown> = {
      status: "PAID",
      paid_at: new Date().toISOString(),
      razorpay_payment_id: eventPayload.payment?.entity?.id ?? null,
    };
    if (downloadUrl) {
      updatePayload.download_url = downloadUrl;
      updatePayload.download_url_expires_at = downloadUrlExpiresAt;
    }

    const { error: updateErr } = await admin
      .from("invoices")
      .update(updatePayload)
      .eq("id", inv.id)
      .eq("status", "PENDING"); // guard: only transition from PENDING

    if (updateErr) {
      console.error("[razorpay.webhook] status update failed:", updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      received: true,
      invoiceId: inv.id,
      status: "PAID",
      downloadUrl: downloadUrl ?? null,
    });
  }

  // Unhandled event type — acknowledge so Razorpay stops retrying
  return NextResponse.json({ received: true, ignored: eventType });
}

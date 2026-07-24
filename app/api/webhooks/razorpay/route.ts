import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import {
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRazorpayWebhookSecret } from "@/lib/razorpay/server";
import { getR2Client, getR2Bucket } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/razorpay
 *
 * Canonical Razorpay webhook receiver. The Razorpay dashboard must point its
 * webhook subscription at this route and share the signing secret via
 * `RAZORPAY_WEBHOOK_SECRET`. There is no unverified dev bypass — rejecting
 * unsigned payloads is the only safe default (mirrors `lib/stripe/server.ts`).
 *
 * Events handled:
 *
 *   • `order.paid` / `payment.captured`
 *      -> idempotency-guard on the payment (or order) id before any DB work,
 *      -> atomically flip the matching invoice from `unpaid`/`PENDING` to
 *         `paid`/`PAID`,
 *      -> mint a short-lived (1-hour) presigned Cloudflare R2 download URL for
 *         the original high-res deliverable and persist it on the invoice so
 *         the share page can hand it to the client once.
 *
 * ── Security model ────────────────────────────────────────────────────────
 *
 *   • Fail-closed signature verification. Razorpay signs the raw body with an
 *     HMAC-SHA256 keyed by the webhook secret and ships the digest in the
 *     `X-Razorpay-Signature` header. We compare against a server-computed
 *     HMAC using `crypto.timingSafeEqual` to avoid a timing-oracle.
 *
 *   • Raw body verification. We read the pristine body via `request.text()`
 *     and never re-parse JSON before the HMAC is verified.
 *
 *   • Replay protection. We refuse to re-process a payment id that has
 *     already been journaled (idempotency-guard). Razorpay's at-least-once
 *     redelivery therefore cannot flip a row twice.
 *
 *   • Privileged writes only here. The service-role admin client is used to
 *     bypass RLS so the webhook — which is not a user session — can update
 *     invoice rows.
 */

type RazorpayWebhookPayload = {
  event: string;
  contains?: string[];
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id?: string | null;
        amount: number;
        status: string;
        notes?: Record<string, string> | null;
      } | null;
    } | null;
    order?: {
      entity?: {
        id: string;
        status: string;
        amount?: number;
        notes?: Record<string, string> | null;
        receipt?: string | null;
      } | null;
    } | null;
  } | null;
};

/** Events that signal "client has been successfully charged". */
const CAPTURE_EVENTS = new Set(["order.paid", "payment.captured"]);

/** Resolve the invoice id embedded in Razorpay notes (set at order creation). */
function resolveInvoiceId(payload: RazorpayWebhookPayload): string | null {
  const orderEntity = payload.payload?.order?.entity;
  const paymentEntity = payload.payload?.payment?.entity;

  // Prefer the explicit notes the create-order route stamped on the order.
  const notes = orderEntity?.notes ?? paymentEntity?.notes ?? null;
  if (notes?.invoice_id) return notes.invoice_id;

  // Fallback: the receipt prefix is `inv_<first-24-of-uuid>`.
  const receipt = orderEntity?.receipt;
  if (receipt && receipt.startsWith("inv_")) {
    return receipt.slice(3);
  }
  return null;
}

/** Compute the expected HMAC-SHA256 signature for the raw body. */
function computeSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** Constant-time hex string comparison to defeat timing oracles. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Mint a 1-hour presigned R2 download URL for the deliverable object stored
 * at `freelancer_id/invoice_uuid_filename.ext` inside the configured bucket.
 * Returns null if the object does not yet exist (e.g. upload still in flight)
 * so the share page can fall back to a "deliverable finalizing" notice.
 */
async function mintPresignedDownload(
  objectKey: string,
): Promise<string | null> {
  const client = (() => {
    try {
      return getR2Client();
    } catch (err) {
      const message = err instanceof Error ? err.message : "R2 unavailable";
      console.error("[razorpay.webhook] R2 mint skipped:", message);
      return null;
    }
  })();
  if (!client) return null;

  const bucket = getR2Bucket();

  // Verify the object exists before presigning — R2 returns a 404 otherwise.
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  } catch {
    return null;
  }

  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 * 60 }, // 1 hour
    );
    return url;
  } catch (err) {
    const message = err instanceof Error ? err.message : "presigning failed";
    console.error("[razorpay.webhook] presign failed:", message);
    return null;
  }
}

export async function POST(request: Request) {
  // ── 1. Fail-closed webhook secret ──────────────────────────────────────
  let webhookSecret: string;
  try {
    webhookSecret = requireRazorpayWebhookSecret();
  } catch (err) {
    const message = err instanceof Error ? err.message : "secret missing";
    console.error("[razorpay.webhook] rejecting request:", message);
    return NextResponse.json({ error: "Webhook signing secret is not configured." }, { status: 500 });
  }

  // ── 2. Raw body + signature verification ───────────────────────────────
  const rawBody = await request.text();
  const providedSignature = request.headers.get("X-Razorpay-Signature") ?? "";
  if (!providedSignature) {
    return NextResponse.json({ error: "Missing X-Razorpay-Signature header." }, { status: 400 });
  }

  const expectedSignature = computeSignature(rawBody, webhookSecret);
  if (!safeEqual(expectedSignature, providedSignature)) {
    console.error("[razorpay.webhook] signature mismatch — rejecting tampered payload.");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // ── 3. Parse + route ────────────────────────────────────────────────────
  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const event = payload.event ?? "";
  if (!CAPTURE_EVENTS.has(event)) {
    // Non-capture events are acknowledged but ignored — surfaced cleanly for
    // the Razorpay dashboard's "events delivered" indicator.
    return NextResponse.json({ received: true, ignored: true, event });
  }

  // ── 4. Resolve the invoice the order belongs to ────────────────────────
  const invoiceId = resolveInvoiceId(payload);
  if (!invoiceId) {
    // Without an invoice id we cannot reconcile; acknowledge so Razorpay
    // doesn't retry-storm, but log loudly.
    const paymentId = payload.payload?.payment?.entity?.id ?? null;
    const orderId = payload.payload?.order?.entity?.id ?? paymentId ?? null;
    console.error(
      "[razorpay.webhook] could not resolve invoice id for",
      orderId,
      "— event:",
      event,
    );
    return NextResponse.json({ received: true, ignored: true });
  }

  const paymentId = payload.payload?.payment?.entity?.id ?? null;
  const orderId = payload.payload?.order?.entity?.id ?? null;
  const idempotencyKey = paymentId ?? orderId ?? invoiceId;

  const admin = createAdminClient();

  // ── 5. Idempotency guard ───────────────────────────────────────────────
  // We refuse to flip a row that is already PAID to defeat Razorpay's
  // at-least-once redelivery. We also refuse to resurrect a REFUNDED row.
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("id, status, file_path, freelancer_id, razorpay_payment_id, razorpay_order_id")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr) {
    console.error("[razorpay.webhook] invoice lookup failed:", invErr.message);
    return NextResponse.json({ error: "Invoice lookup failed." }, { status: 500 });
  }
  if (!invoice) {
    // Unknown invoice — acknowledge to avoid retry storms, but log loudly.
    console.error("[razorpay.webhook] unknown invoice", invoiceId);
    return NextResponse.json({ received: true, ignored: true });
  }
  if (invoice.status === "PAID") {
    // Already paid — also check whether the same payment id was logged to
    // make sure this isn't a different capture for the same order.
    if (paymentId && invoice.razorpay_payment_id === paymentId) {
      return NextResponse.json({ received: true, already_processed: true });
    }
    // Different payment captured for an already-paid invoice is suspicious; log.
    console.warn(
      "[razorpay.webhook] payment",
      paymentId,
      "captured for already-PAID invoice",
      invoiceId,
    );
    return NextResponse.json({ received: true, already_processed: true });
  }

  // ── 6. Mint the presigned R2 download URL ──────────────────────────────
  // Only do this if the deliverable object key is known on the invoice row.
  const objectKey = (invoice as { file_path?: string | null }).file_path ?? null;
  const downloadUrl = objectKey ? await mintPresignedDownload(objectKey) : null;

  // ── 7. Flip invoice to PAID (atomic) ───────────────────────────────────
  // Guarded by a status predicate so a concurrent thread that beat us to the
  // capture (or an order.paid arriving alongside payment.captured) cannot
  // double-update. The predicate flips only an unpaid/PENDING row.
  const update: Record<string, unknown> = {
    status: "PAID",
    razorpay_payment_id: paymentId ?? invoice.razorpay_payment_id ?? null,
    razorpay_order_id: orderId ?? invoice.razorpay_order_id ?? null,
    paid_at: new Date().toISOString(),
  };
  if (downloadUrl) {
    update.r2_download_url = downloadUrl;
    update.r2_download_url_expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  const { error: updateErr } = await admin
    .from("invoices")
    .update(update)
    .eq("id", invoiceId)
    .in("status", ["PENDING", "unpaid", "UNPAID"]);

  if (updateErr) {
    console.error("[razorpay.webhook] status flip failed:", updateErr.message);
    return NextResponse.json({ error: "Failed to finalize invoice." }, { status: 500 });
  }

  return NextResponse.json({
    received: true,
    finalized: true,
    invoice_id: invoiceId,
    idempotency_key: idempotencyKey,
    presigned: Boolean(downloadUrl),
  });
}

import { S3Client } from "@aws-sdk/client-s3";

/**
 * Server-only Cloudflare R2 S3-compatible client.
 *
 * R2 exposes the standard S3 API at a per-account endpoint; we configure the
 * AWS SDK v3 client with the R2 Account ID + token rather than AWS region
 * credentials. Used for:
 *
 *   • generating presigned PUT URLs the browser streams the Raw Vault
 *     deliverable to (see `app/api/upload/presigned/route.ts`), and
 *   • generating short-lived presigned GET URLs handed to the client after
 *     payment is captured (see `app/api/webhooks/razorpay/route.ts`).
 *
 * Required environment variables:
 *   • R2_ACCOUNT_ID          — Cloudflare account id (hex)
 *   • R2_ACCESS_KEY_ID       — R2 API token id (Access Key)
 *   • R2_SECRET_ACCESS_KEY   — R2 API token secret
 *   • R2_BUCKET_NAME         — e.g. "vault"
 *
 * (Optional) R2_PUBLIC_BASE — if set, used for any public/CDN asset URL.
 */

let cached: S3Client | null = null;

/** S3 endpoint for a given R2 account, per Cloudflare's docs. */
function r2EndpointUrl(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** The configured R2 bucket name (singleton-free — read on demand). */
export function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket || bucket.trim() === "") {
    throw new Error("R2_BUCKET_NAME is not set. Presigned R2 URLs need a bucket to target.");
  }
  return bucket;
}

/**
 * Lazily build (and memoise) the S3Client pointed at Cloudflare R2. Throws on
 * missing env so routes can surface a clean 503 instead of boot-crashing.
 */
export function getR2Client(): S3Client {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || accountId.trim() === "") {
    throw new Error("R2_ACCOUNT_ID is not set. Cannot resolve the R2 S3 endpoint.");
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set. Configure the R2 API token before presigning.",
    );
  }

  cached = new S3Client({
    region: "auto",
    endpoint: r2EndpointUrl(accountId),
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // R2 does not support the S3 bucket-style virtual-host (`bucket.host`),
    // it only supports path-style addressing.
    forcePathStyle: true,
  });

  return cached;
}

/**
 * Optional public base URL served by Cloudflare (a custom domain or the R2
 * public bucket URL). Returns `null` when not configured — callers should fall
 * back to the presigned GET URL in that case.
 */
export function getR2PublicBase(): string | null {
  const base = process.env.R2_PUBLIC_BASE;
  return base && base.trim() !== "" ? base.replace(/\/$/, "") : null;
}

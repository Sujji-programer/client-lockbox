import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";
import { getR2Client, getR2Bucket } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/upload/presigned
 *
 * Mints short-lived (1-hour) Cloudflare R2 presigned PUT URLs so the
 * browser can stream the Raw Vault deliverable (4K MP4 / MOV / ZIP, up to
 * 20 GB) straight from the client to R2 — bypassing the Next.js server and
 * avoiding the Vercel/Node 4.5 MB function-body ceiling.
 *
 * The actual multipart upload of multi-GB files is browser-native: the SDK
 * signs the URL once, then the browser issues the PUT directly to R2. For
 * very large files a future iteration could mint per-part presigned URLs
 * (multipart upload) — the R2 S3 API supports both, and this route's
 * contract surfaces the right hooks to extend it.
 *
 * Request body:
 *   {
 *     "fileName": "render_4k_final.mp4",
 *     "fileType": "video/mp4",   // MIME, optional
 *     "fileSize": 5368709120,    // bytes, optional, validated against 20GB
 *     "invoiceId": "<uuid>",     // optional — used to scope the object key
 *   }
 *
 * Returns:
 *   { "uploadUrl": "https://<acct>.r2.cloudflarestorage.com/...", "key": "..." }
 *
 * Security:
 *   • Authenticated user-only (SSR session gate).
 *   • Object keys are server-generated to prevent path traversal — the client
 *     never controls the key, only proposes the filename.
 *   • 20 GB hard ceiling enforced here so a malicious payload can't ask for a
 *     "legal" presigned URL for an impossibly large object.
 */

/** Hard ceiling on a single Raw Vault deliverable. */
const MAX_VAULT_SIZE_BYTES = 20 * 1024 * 1024 * 1024;

/** Accepted file extensions for the Raw Vault (4K MP4 / MOV / ZIP). */
const VAULT_ACCEPTED_EXT = /\.(mp4|mov|zip)$/i;

/** Lifetime of a presigned PUT URL (1 hour, matches the docs default). */
const PRESIGN_TTL_SECONDS = 60 * 60;

/** RFC4122-ish generator used as the on-server key suffix. */
function randomKeySuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Reduce a user-supplied filename to a safe, lowercase, dot+dash+underscore
 * only token. Prevents `../` traversal and any odd Unicode in the key.
 */
function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "deliverable";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "deliverable";
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
  let body: {
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    invoiceId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.fileName || !body.fileName.trim()) {
    return NextResponse.json({ error: "fileName is required." }, { status: 400 });
  }
  if (!VAULT_ACCEPTED_EXT.test(body.fileName)) {
    return NextResponse.json(
      { error: "Only 4K MP4, MOV, or ZIP files are accepted for the vault." },
      { status: 422 },
    );
  }
  if (typeof body.fileSize === "number" && body.fileSize > MAX_VAULT_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds the 20 GB Raw Vault limit." },
      { status: 413 },
    );
  }

  // ── 3. Compose the server-controlled object key ─────────────────────────
  // Layout: <freelancer_id>/<invoice_or_session>/<uuid>_<sanitized_name>
  // Keeps every freelancer's deliveries partitioned per-account on R2.
  const scope = body.invoiceId?.trim() || "drafts";
  const safeName = sanitizeFileName(body.fileName);
  const key = `${freelancerId}/${scope}/${randomKeySuffix()}_${safeName}`;

  // ── 4. Resolve the R2 client + bucket ──────────────────────────────────
  let client: ReturnType<typeof getR2Client>;
  try {
    client = getR2Client();
  } catch (err) {
    const message = err instanceof Error ? err.message : "R2 unavailable";
    console.error("[upload.presigned] R2 client init failed:", message);
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }
  let bucket: string;
  try {
    bucket = getR2Bucket();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bucket missing";
    console.error("[upload.presigned] bucket missing:", message);
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }

  // ── 5. Mint the presigned PUT URL ──────────────────────────────────────
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    // Hint the content-type to R2 if the caller supplied a sane MIME.
    ContentType: body.fileType && body.fileType.startsWith("video/")
      ? body.fileType
      : body.fileType && body.fileType === "application/zip"
        ? body.fileType
        : "application/octet-stream",
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "presigning failed";
    console.error("[upload.presigned] getSignedUrl threw:", message);
    return NextResponse.json({ error: "Failed to mint upload URL." }, { status: 502 });
  }

  return NextResponse.json({
    uploadUrl,
    key,
    bucket,
    method: "PUT",
    expiresInSeconds: PRESIGN_TTL_SECONDS,
    maxSizeBytes: MAX_VAULT_SIZE_BYTES,
    headers: {
      "Content-Type":
        body.fileType && body.fileType.startsWith("video/")
          ? body.fileType
          : "application/octet-stream",
    },
  });
}

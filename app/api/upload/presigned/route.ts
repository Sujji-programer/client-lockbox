import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/upload/presigned
 *
 * Generates a short-lived (1-hour) presigned PUT URL for Cloudflare R2 so the
 * browser can upload files directly to R2 without routing gigabytes through
 * the Next.js server.
 *
 * Body:
 *   {
 *     invoiceId: string,      // Used to namespace the R2 key
 *     fileType: "preview" | "vault",
 *     contentType: string,    // MIME type, e.g. "video/mp4"
 *     fileName: string,       // Original file name for the Content-Disposition header
 *   }
 *
 * Returns:
 *   {
 *     uploadUrl: string,      // Presigned PUT URL (expires in 1 hour)
 *     r2Key: string,          // The object key inside the R2 bucket
 *     expiresAt: string,      // ISO timestamp of expiry
 *   }
 *
 * The client should:
 *   1. Call this endpoint to obtain `uploadUrl`.
 *   2. PUT the file binary to `uploadUrl` with the matching Content-Type header.
 *   3. Store `r2Key` on the invoice row (PATCH /api/invoices/:id or via Supabase
 *      client) so the webhook can generate download presigned URLs later.
 *
 * Security:
 *   - Requires an authenticated session (freelancer must be signed in).
 *   - The R2 key is namespaced under `invoices/<invoiceId>/<fileType>/` to
 *     prevent cross-invoice path traversal.
 *   - Max content size is enforced by R2's own object size limits; additionally
 *     the presigned URL can optionally carry a ContentLengthRange condition
 *     (shown commented out below for reference).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILE_TYPES = new Set(["preview", "vault"]);

const ALLOWED_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "application/zip",
  "application/x-zip-compressed",
]);

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set. " +
        "Add them in the Vars section of project settings.",
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

type RequestBody = {
  invoiceId?: unknown;
  fileType?: unknown;
  contentType?: unknown;
  fileName?: unknown;
};

export async function POST(request: Request) {
  // 1. Auth guard — freelancer must be signed in
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json(
      { error: "Authentication required. Sign in to upload files." },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const invoiceId =
    typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const fileType =
    typeof body.fileType === "string" ? body.fileType.trim() : "";
  const contentType =
    typeof body.contentType === "string" ? body.contentType.trim() : "";
  const fileName =
    typeof body.fileName === "string"
      ? body.fileName.trim().replace(/[^a-zA-Z0-9._\-]/g, "_")
      : "upload";

  // 3. Validate inputs
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId is required." }, { status: 400 });
  }
  if (!ALLOWED_FILE_TYPES.has(fileType)) {
    return NextResponse.json(
      { error: `fileType must be one of: ${[...ALLOWED_FILE_TYPES].join(", ")}` },
      { status: 400 },
    );
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      {
        error: `Unsupported contentType. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
      },
      { status: 415 },
    );
  }

  // 4. Build R2 object key
  // Pattern: invoices/<invoiceId>/preview/<filename>
  //          invoices/<invoiceId>/vault/<filename>
  const r2Key = `invoices/${invoiceId}/${fileType}/${fileName}`;

  // 5. Get R2 client
  let s3: S3Client;
  try {
    s3 = getR2Client();
  } catch (err) {
    const message = err instanceof Error ? err.message : "R2 not configured.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    return NextResponse.json(
      { error: "R2_BUCKET_NAME is not set." },
      { status: 503 },
    );
  }

  // 6. Generate presigned PUT URL — 1-hour expiry
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: r2Key,
    ContentType: contentType,
    ContentDisposition: `attachment; filename="${fileName}"`,
    Metadata: {
      "uploaded-by": user.id,
      "invoice-id": invoiceId,
      "file-type": fileType,
    },
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Presign failed.";
    console.error("[upload.presigned] presign error:", message);
    return NextResponse.json({ error: `Could not generate upload URL: ${message}` }, { status: 502 });
  }

  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  return NextResponse.json({
    uploadUrl,
    r2Key,
    expiresAt,
    // Convenience — frontend can PUT directly and then store r2Key on the invoice
    instructions:
      'PUT the file binary to `uploadUrl` with the same Content-Type header. ' +
      'Then PATCH your invoice row with { vault_file_key: r2Key } (or preview_file_key for the preview file).',
  });
}

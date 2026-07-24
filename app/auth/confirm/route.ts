import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // --- Resolve a safe post-auth destination ---------------------------------
  // NEVER trust the raw `next` param — an attacker could craft an
  // email-confirmation link with `next=https://evil.com` or `next=//evil.com`
  // and hijack a freshly-authenticated user. We harden it:
  //   - must start with a single leading "/"
  //   - must NOT start with "//"
  //   - must NOT contain a scheme/host
  // Anything else (including the legacy default "/") is coerced to "/dashboard".
  const SAFE_NEXT_DEFAULT = "/dashboard";
  const rawNext = searchParams.get("next");
  const next = isSafeInternalPath(rawNext) ? (rawNext as string) : SAFE_NEXT_DEFAULT;

  // --- Validate the one-time token presence ---------------------------------
  if (!token_hash || !type) {
    redirect(`/auth/error?error=${encodeURIComponent("Missing verification token or type.")}`);
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (error) {
      redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
    }

    // Cookies established + session exchanged — forcefully route the
    // authenticated user to the protected dashboard, never the landing page.
    redirect(next);
  } catch (err) {
    // A redirect() call throws internally in Next.js to short-circuit the
    // response — only surface the user to the error page for *unexpected*
    // errors that are not the redirect sentinel.
    if (isNextRedirectSentinel(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Verification failed unexpectedly.";
    console.error("[auth/confirm] verifyOtp threw:", message);
    redirect(`/auth/error?error=${encodeURIComponent(message)}`);
  }
}

/**
 * Allowlist check for an internal redirect path. Returns true ONLY for a
 * same-origin relative path with a single leading slash and no scheme/host.
 * Rejects protocol-relative (`//evil`), absolute URLs, backslashes, and any
 * path containing a `://` sequence.
 */
function isSafeInternalPath(value: string | null): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (/:\/\//.test(value)) return false;
  return true;
}

/**
 * Next.js `redirect()` throws a digest-tagged error to unwind the stack; we
 * must re-throw it (not swallow it as a real failure). Detect it by the
 * `digest` property that Next attaches to its redirect sentinel.
 */
function isNextRedirectSentinel(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (err as { digest: string }).digest.includes("NEXT_REDIRECT"))
  );
}

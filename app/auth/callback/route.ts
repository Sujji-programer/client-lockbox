import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * OAuth redirect destination.
 *
 * After Supabase completes the Google OAuth dance it redirects the browser
 * here with a `?code=...` query param. We exchange that single-use code for
 * a session (which sets the auth cookies server-side via @supabase/ssr), then
 * route the now-authenticated user into the app.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next");

  // Never trust the raw `next` param — coerce to a safe internal path.
  const next = isSafeInternalPath(rawNext) ? (rawNext as string) : "/dashboard";

  // Supabase may also surface a provider error as an `error` / `error_description`
  // query param rather than a thrown exception — surface those gracefully.
  const oauthError = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      `${requestUrl.origin}/auth/error?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        `${requestUrl.origin}/auth/error?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  // Session cookies are set — forcefully route the user into the dashboard.
  return NextResponse.redirect(`${requestUrl.origin}${next}`);
}

/**
 * Allowlist check for an internal redirect path. Mirrors the hardening in
 * `auth/confirm`: same-origin relative path with a single leading slash and
 * no scheme/host. Rejects protocol-relative (`//evil`), absolute URLs, and
 * anything containing `://`.
 */
function isSafeInternalPath(value: string | null): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (/:\/\//.test(value)) return false;
  return true;
}

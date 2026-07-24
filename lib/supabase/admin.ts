import { createClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client created with the **SERVICE ROLE** key.
 *
 * This bypasses Row-Level Security and MUST be used only inside trusted
 * server-only code paths that are never reachable from the browser bundle:
 *   - the Stripe webhook receiver (marking an invoice PAID)
 *   - the public share page's signed-URL generation (only when status = PAID)
 *
 * Never import this module from a Client Component. Anything imported here is
 * pulled into the route's server module graph, so keep it side-effect free.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL env var: cannot initialize the admin Supabase client.",
    );
  }
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY env var: cannot initialize the admin Supabase client. It is required for the webhook handler and signed-URL generation.",
    );
  }

  return createClient(url, key, {
    auth: {
      // This client impersonates the server, never a logged-in user.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

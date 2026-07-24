import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/dashboard-nav";

// Per-request: this route is an auth guard — it must never be prerendered.
export const dynamic = "force-dynamic";

/**
 * Server-side auth guard for the freelancer dashboard.
 *
 * - Reads the Supabase session; if there's no authenticated user we bounce to
 *   the boilerplate's `/auth/login` route.
 * - Pulls the freelancer's `plan_type` from the `profiles` table and exposes
 *   it to all dashboard children via a React context (see DashboardProvider).
 *
 * Created with `force-dynamic` so the session is always re-evaluated per
 * request and we never serve a stale, logged-out shell from the cache.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Load the freelancer's profile so children know the plan tier + Stripe status.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, subscription_tier, stripe_account_id, stripe_account_status")
    .eq("id", user.id)
    .single();

  const stripeStatus = (profile?.stripe_account_status ?? null) as
    | "PENDING" | "RESTRICTED" | "ENABLED" | null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/40 dark:from-slate-950 dark:to-slate-900">
      <DashboardNav
        email={profile?.email ?? user.email ?? ""}
        planType={(profile?.subscription_tier === "PRO" ? "PRO" : "FREE")}
        userId={user.id}
        stripeAccountId={profile?.stripe_account_id ?? null}
        stripeAccountStatus={stripeStatus ?? (profile?.stripe_account_id ? "PENDING" : "NONE")}
      />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}

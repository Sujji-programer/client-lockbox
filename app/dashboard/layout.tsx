import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/dashboard-nav";

// Per-request: this route is an auth guard — it must never be prerendered.
export const dynamic = "force-dynamic";

/**
 * Server-side auth guard for the CiteFlow editor dashboard.
 * Reads the Supabase session and bounces unauthenticated users to /auth.
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
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, subscription_tier")
    .eq("id", user.id)
    .single();

  const planType = profile?.subscription_tier === "PRO" ? "PRO" : "FREE";

  return (
    <div style={{ background: "#090D16", minHeight: "100vh" }}>
      <DashboardNav
        email={profile?.email ?? user.email ?? ""}
        planType={planType}
        userId={user.id}
      />
      <main>
        {children}
      </main>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard-client";

// Per-request: reads the Supabase session and seeded DB rows on every render.
export const dynamic = "force-dynamic";

/**
 * Server entry for the freelancer dashboard.
 *
 * Auth is already enforced by `app/dashboard/layout.tsx`, so here we can safely
 * fetch the freelancer's `plan_type` plus the seed data the dashboard needs on
 * first paint (3 metric cards + recent invoices). The rich, interactive bits
 * (form, dropzone, optimistic re-rendering) live in `DashboardClient`.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const freelancerId = user!.id;
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, custom_platform_fee_percent")
    .eq("id", freelancerId)
    .single();

  const planType = profile?.subscription_tier === "PRO" ? "PRO" : "FREE";
  const customPlatformFeePercent = profile?.custom_platform_fee_percent ?? null;

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, client_name, client_email, amount, platform_fee, total_charged, status, created_at, file_path",
    )
    .eq("freelancer_id", freelancerId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <DashboardClient
      freelancerId={freelancerId}
      planType={planType}
      customPlatformFeePercent={customPlatformFeePercent}
      initialInvoices={(invoices ?? []) as DashboardInvoiceRow[]}
    />
  );
}

export type DashboardInvoiceRow = {
  id: string;
  client_name: string;
  client_email: string;
  amount: number;
  platform_fee: number;
  total_charged: number;
  status: "PENDING" | "PAID";
  created_at: string;
  file_path: string;
};

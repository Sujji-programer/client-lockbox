/**
 * Public preview of the CiteFlow dashboard UI — no auth required.
 * Used for design review. Remove or gate this route before production.
 */
import { DashboardNav } from "@/components/dashboard-nav";
import { DashboardClient } from "@/components/dashboard-client";

export default function DashboardPreviewPage() {
  return (
    <div style={{ background: "#090D16", minHeight: "100vh" }}>
      <DashboardNav
        email="priya@motionhaus.co"
        planType="PRO"
        userId="preview"
      />
      <main>
        <DashboardClient
          freelancerId="preview"
          planType="PRO"
          customPlatformFeePercent={0}
          initialInvoices={[]}
        />
      </main>
    </div>
  );
}

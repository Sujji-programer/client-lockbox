import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import {
  calculateCheckoutBreakdown,
  breakdownToApplicationFeeAmount,
} from "@/lib/stripe/fees";
import type { CheckoutBreakdown } from "@/lib/stripe/fees";
import { PaywallClient } from "./paywall-client";
import {
  getAccessibleDeliverables,
  parseInvoiceWorkflowMetadata,
  type InvoiceWorkflowMetadata,
  type WorkflowAttachment,
} from "@/lib/invoice-workflow";

/**
 * Public client-portal page. Renders one of:
 *   - PENDING + accepted_at + signature  -> Stripe PaymentIntent + inline pay form
 *   - PENDING + not signed              -> proposal + Accept Terms / signature panel
 *   - PAID                              -> success screen
 *   - REFUNDED                          -> refunded notice
 *   - not found                          -> elegant 404
 *
 * Per-request: we read cookies + conditionally mint a Stripe PaymentIntent.
 */
export const dynamic = "force-dynamic";

export type PublicAttachment = WorkflowAttachment;

export type PublicInvoiceView = {
  id: string;
  freelancer_id: string;
  client_email: string;
  scope_of_work: string;
  amount: number;
  base_amount_cents: number | null;
  platform_fee: number;
  platform_fee_cents: number;
  total_charged: number;
  currency: string;
  status: "PENDING" | "PAID" | "REFUNDED";
  created_at: string;
  due_date: string | null;
  terms: string | null;
  signature: string | null;
  accepted_at: string | null;
  // legacy field kept for backwards-compat with old rows; defaults to null.
  file_path?: string | null;
  workflowMetadata?: InvoiceWorkflowMetadata;
  attachments: PublicAttachment[];
  draftAttachments: PublicAttachment[];
  finalAttachments: PublicAttachment[];
  comments: Array<{ id: string; invoiceId: string; senderRole: "FREELANCER" | "CLIENT"; message: string; timestamp: string }>;
  draftApproved: boolean;
  workflowState: "DRAFT_REVIEW" | "FINAL_VAULT_READY" | "PAID";
};

type SharePageProps = {
  params: Promise<{ id: string }>;
};

export default async function SharePage({ params }: SharePageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice, error } = (await supabase
    .from("invoices")
    .select(
      "id, freelancer_id, client_email, scope_of_work, amount, base_amount_cents, platform_fee, platform_fee_cents, total_charged, currency, status, created_at, due_date, terms, signature, accepted_at, file_path",
    )
    .eq("id", id)
    .maybeSingle()) as {
    data: PublicInvoiceView | null;
    error: unknown;
  };

  if (error || !invoice) {
    return <InvoiceNotFound />;
  }

  const workflowMetadata = parseInvoiceWorkflowMetadata(invoice.file_path);
  const accessibleAttachments = getAccessibleDeliverables(workflowMetadata);
  const invoiceView: PublicInvoiceView = {
    ...invoice,
    workflowMetadata,
    attachments: accessibleAttachments,
    draftAttachments: workflowMetadata.drafts ?? [],
    finalAttachments: workflowMetadata.finals ?? [],
    comments: workflowMetadata.comments ?? [],
    draftApproved: workflowMetadata.draftApproved === true,
    workflowState: workflowMetadata.workflowState ?? "DRAFT_REVIEW",
  };

  // PAID / REFUNDED path: no PaymentIntent needed.
  if (invoice.status !== "PENDING") {
    return (
      <PaywallClient
        invoice={invoiceView}
        breakdown={null}
        paymentIntentClientSecret={null}
        stripePublishableKey={null}
      />
    );
  }

  // PENDING path: only mint a PaymentIntent once the client has actually
  // accepted terms + signed. Else we still surface the Accept Terms panel
  // and the pay form stays inert.
  let paymentIntentClientSecret: string | null = null;
  let breakdown: CheckoutBreakdown | null = null;

  if (invoice.accepted_at && invoice.signature) {
    try {
      const result = await mintPaymentIntent(invoice);
      if (result) {
        paymentIntentClientSecret = result.clientSecret;
        breakdown = result.breakdown;
      }
    } catch (err) {
      console.error(
        "[share] could not mint PaymentIntent:",
        err instanceof Error ? err.message : err,
      );
      // Render anyway — the client portal will show a graceful error if the
      // secret is null and the user tries to pay.
    }
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

  return (
    <PaywallClient
      invoice={invoiceView}
      breakdown={breakdown}
      paymentIntentClientSecret={paymentIntentClientSecret}
      stripePublishableKey={publishableKey}
    />
  );
}

/**
 * Mint (or reuse) a Stripe PaymentIntent for the connected-account destination
 * charge on the freelancer's Express account. Tier-based application fee is
 * computed via `calculateCheckoutBreakdown`.
 *
 * Returns both the client_secret and the full breakdown so the UI can render
 * an accurate itemized summary.
 */
async function mintPaymentIntent(invoice: PublicInvoiceView): Promise<{
  clientSecret: string | null;
  breakdown: CheckoutBreakdown;
} | null> {
  const admin = createAdminClient();

  // Need the freelancer's connected account id.
  const { data: freelancer, error: flErr } = await admin
    .from("profiles")
    .select("stripe_account_id, stripe_account_status")
    .eq("id", invoice.freelancer_id)
    .maybeSingle();

  if (flErr || !freelancer?.stripe_account_id || freelancer.stripe_account_status !== "ENABLED") {
    return null;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return null;
  }

  const currency = (invoice.currency ?? "usd").toLowerCase();
  // Use base_amount_cents if available (new invoices), else derive from amount.
  const baseAmountCents =
    Number(invoice.base_amount_cents) > 0
      ? Math.round(Number(invoice.base_amount_cents))
      : Math.round(Number(invoice.amount) * 100);

  const breakdown = await calculateCheckoutBreakdown(
    baseAmountCents,
    invoice.freelancer_id,
  );

  const intent = await stripe.paymentIntents.create(
    {
      amount: breakdown.totalClientAmountCents,
      currency,
      application_fee_amount: breakdownToApplicationFeeAmount(breakdown),
      on_behalf_of: freelancer.stripe_account_id,
      transfer_data: { destination: freelancer.stripe_account_id },
      metadata: {
        invoice_id: invoice.id,
        freelancer_id: invoice.freelancer_id,
        platform_fee_cents: String(breakdown.platformFeeCents),
        stripe_fee_cents: String(breakdown.stripeFeeCents),
        total_client_cents: String(breakdown.totalClientAmountCents),
      },
      receipt_email: invoice.client_email || undefined,
      automatic_payment_methods: { enabled: true },
    },
    { stripeAccount: freelancer.stripe_account_id },
  );

  return { clientSecret: intent.client_secret ?? null, breakdown };
}

/* ------------------------------------------------------------ */
function InvoiceNotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-rose-500/10 blur-3xl"
      />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-20">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-10 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 ring-1 ring-rose-400/30">
            <LockboxGlyph className="h-8 w-8 text-rose-300" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Invoice Not Found</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            We couldn&rsquo;t find an invoice at this link. It may have been revoked, expired, or the
            URL may be incomplete. Please reach out to your freelancer for an updated payment link.
          </p>
        </div>
        <p className="mt-8 text-xs uppercase tracking-[0.2em] text-slate-600">
          ClientLockbox · Secure Client Portal
        </p>
      </div>
    </main>
  );
}

function LockboxGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

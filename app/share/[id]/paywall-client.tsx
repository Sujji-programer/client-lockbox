"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js";
import type { PublicInvoiceView } from "@/app/share/[id]/page";
import type { CheckoutBreakdown } from "@/lib/stripe/fees";
import { money, formatRelativeDue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  LockboxLogoIcon,
  CheckCircle2Icon,
  Loader2Icon,
  ShieldCheckIcon,
  LockIcon,
  CalendarIcon,
  ZapIcon,
  SignatureIcon,
  AlertCircleIcon,
  RotateCcwIcon,
  DownloadIcon,
} from "@/components/icons";

/**
 * Dev-mode bypass gate (compile-time + client flag) — tree-shaken out of
 * production bundles so the dev-bypass route is physically absent in prod.
 */
const DEV_BYPASS_ENABLED =
  process.env.NODE_ENV === "development" &&
  ["1", "true", "TRUE", "yes"].includes(
    process.env.NEXT_PUBLIC_DEV_BYPASS_ENABLED ?? "",
  );

/**
 * Local mock-payments gate. When the public env flag is exactly "true", the
 * client portal renders a prominent "Simulate Payment (Dev Only)" button that
 * POSTs to /api/dev/mock-pay — letting the full Freelancer → Client flow be
 * exercised locally without real Stripe keys. The server endpoint additionally
 * hard-guards on NODE_ENV === "development", so this flag alone can't enable
 * anything in production.
 */
const MOCK_PAYMENTS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_MOCK_PAYMENTS === "true";

type AcceptState = "idle" | "saving" | "saved";

export function PaywallClient({
  invoice,
  breakdown,
  paymentIntentClientSecret,
  stripePublishableKey,
}: {
  invoice: PublicInvoiceView;
  breakdown: CheckoutBreakdown | null;
  paymentIntentClientSecret: string | null;
  stripePublishableKey: string | null;
}) {
  // Signature + T&C acceptance -------------------------------------------
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState("");
  const [acceptState, setAcceptState] = useState<AcceptState>("idle");
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const canPay = accepted && signature.trim().length >= 3 && acceptState === "saved";

  // Resolve display amounts: prefer server-computed breakdown, else legacy row.
  const totalCents = breakdown?.totalClientAmountCents ?? Math.round(Number(invoice.total_charged) * 100);
  const totalDisplay = money(totalCents / 100, invoice.currency);

  const submitAcceptance = async () => {
    if (signature.trim().length < 3) {
      setAcceptError("Please type your full name as your signature.");
      return;
    }
    if (!accepted) {
      setAcceptError("Please accept the terms & conditions.");
      return;
    }
    setAcceptState("saving");
    setAcceptError(null);
    try {
      const res = await fetch("/api/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoice.id, signature: signature.trim() }),
      });
      const data = (await res.json()) as { accepted?: boolean; error?: string };
      if (!res.ok || !data.accepted) {
        throw new Error(data.error ?? "Could not record acceptance.");
      }
      setAcceptState("saved");
    } catch (err) {
      setAcceptState("idle");
      setAcceptError(err instanceof Error ? err.message : "Could not record acceptance.");
    }
  };

  // Stripe Elements -------------------------------------------------------
  const stripePromise = useMemo(async () => {
    if (!stripePublishableKey || !paymentIntentClientSecret) return null;
    const stripe = await loadStripe(stripePublishableKey);
    if (!stripe) return null;
    return stripe;
  }, [stripePublishableKey, paymentIntentClientSecret]);

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState(invoice.workflowState);
  const [draftApproved, setDraftApproved] = useState(invoice.draftApproved);
  const [comments, setComments] = useState(invoice.comments);
  // True after a mock payment succeeds; flips the portal into the paid /
  // download-deliverables view without a full page reload.
  const [mockPaid, setMockPaid] = useState(false);
  // The Payment Element mounts into this <div>; the ref is a plain DOM node.
  const elementsRef = useRef<HTMLDivElement | null>(null);
  // Holds the Stripe Elements instance (and its mounted payment element) between init and unmount.
  const elementsInstance = useRef<StripeElements | null>(null);
  const paymentElementInstance = useRef<StripePaymentElement | null>(null);

  // Initialize Stripe Elements (Payment Element) once stripe is ready.
  useEffect(() => {
    let cancelled = false;
    stripePromise.then((stripe) => {
      if (cancelled || !stripe || !paymentIntentClientSecret) return;
      if (elementsInstance.current || !elementsRef.current) return;
      const elements = stripe.elements({
        clientSecret: paymentIntentClientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#6366f1",
            borderRadius: "12px",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        },
      });
      const paymentElement = elements.create("payment", {
        layout: { type: "tabs", defaultCollapsed: false },
      });
      paymentElement.mount(elementsRef.current);
      paymentElementInstance.current = paymentElement;
      elementsInstance.current = elements;
    });
    return () => {
      cancelled = true;
      paymentElementInstance.current?.destroy();
      paymentElementInstance.current = null;
      elementsInstance.current = null;
    };
  }, [stripePromise, paymentIntentClientSecret]);

  const pay = async () => {
    if (paying || !canPay) return;
    setPaying(true);
    setPayError(null);
    try {
      const stripe = await stripePromise;
      if (!stripe || !elementsInstance.current) {
        throw new Error("Payment form is still loading. Please retry in a moment.");
      }
      const { error } = await stripe.confirmPayment({
        elements: elementsInstance.current ?? undefined,
        redirect: "if_required",
      });
      if (error) {
        throw new Error(error.message ?? "Payment failed.");
      }
      setSuccess(true);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setPaying(false);
    }
  };

  const submitReviewComment = async () => {
    const message = reviewComment.trim();
    if (!message) return;
    setReviewPending(true);
    setReviewError(null);
    setReviewMessage(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", senderRole: "CLIENT", message }),
      });
      const data = (await res.json()) as { comment?: { message: string; timestamp: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save your feedback.");
      setComments((prev) => [
        ...prev,
        {
          id: `${invoice.id}-${Date.now()}`,
          invoiceId: invoice.id,
          senderRole: "CLIENT",
          message,
          timestamp: data.comment?.timestamp ?? new Date().toISOString(),
        },
      ]);
      setReviewComment("");
      setReviewMessage("Feedback sent to the freelancer.");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not save feedback.");
    } finally {
      setReviewPending(false);
    }
  };

  const approveDraft = async () => {
    setReviewPending(true);
    setReviewError(null);
    setReviewMessage(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-draft", senderRole: "CLIENT" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not approve the draft.");
      setDraftApproved(true);
      setWorkflowState("FINAL_VAULT_READY");
      setReviewMessage("Draft approved. The final vault is ready for upload and payment.");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not approve the draft.");
    } finally {
      setReviewPending(false);
    }
  };

  const requestDownload = async (fileId: string) => {
    if (downloadingId) return;
    setDownloadingId(fileId);
    setDownloadError(null);

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/download-file/${fileId}`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Could not create a secure download link.");
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Success state ---------------------------------------------------------
  if (success) {
    return <SuccessScreen invoice={invoice} totalDisplay={totalDisplay} />;
  }

  const isPaid = invoice.status === "PAID" || mockPaid;
  const canShowPaymentCard = isPaid ? false : draftApproved || workflowState === "FINAL_VAULT_READY";
  const isDraftReview = !isPaid && !draftApproved && workflowState === "DRAFT_REVIEW";

  // Layout ---------------------------------------------------------------
  const dueTone = formatRelativeDue(invoice.due_date ?? null);
  const dueChipTone =
    dueTone.tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : dueTone.tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning-foreground"
        : "border-border bg-muted text-muted-foreground";

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900 antialiased dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-12rem] h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col px-5 py-8 sm:px-6 sm:py-12">
        {/* brand */}
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <LockboxLogoIcon className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Client<span className="text-primary">Lockbox</span>
          </span>
        </div>

        {/* proposal card */}
        <div className="surface-elevated animate-fade-in overflow-hidden">
          <div className="px-6 py-7 sm:px-7">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Invoice from your freelancer
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              {money(invoice.amount, invoice.currency)}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {invoice.due_date ? (
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  dueChipTone,
                )}>
                  <CalendarIcon className="h-3 w-3" />
                  {dueTone.label}
                </span>
              ) : null}
              {invoice.terms ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {invoice.terms}
                </span>
              ) : null}
            </div>

            {/* scope */}
            <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Scope of work
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                {invoice.scope_of_work}
              </p>
            </div>

            {/* fee transparency — itemized summary */}
            <FeeSummary breakdown={breakdown} invoice={invoice} />
          </div>
        </div>

        {isPaid ? (
          <div className="surface mt-4 px-6 py-6 sm:px-7">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="h-4 w-4 text-success" />
              <h2 className="text-sm font-semibold tracking-tight">Download deliverables</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Your payment is complete. Secure signed links are available below for the files attached to this invoice.
            </p>
            {downloadError ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                <AlertCircleIcon className="h-3.5 w-3.5" />
                {downloadError}
              </p>
            ) : null}
            {invoice.attachments.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {invoice.attachments.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{file.type || "file"}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => requestDownload(file.id)}
                      disabled={downloadingId === file.id}
                      className="gap-2"
                    >
                      {downloadingId === file.id ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <DownloadIcon className="h-4 w-4" />
                      )}
                      {downloadingId === file.id ? "Opening…" : "Download"}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                No files are attached to this invoice yet.
              </p>
            )}
          </div>
        ) : (
          <div className="surface mt-4 px-6 py-6 sm:px-7">
            <div className="flex items-center gap-2">
              <LockIcon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold tracking-tight">Draft review workflow</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Review the draft previews, leave feedback, or approve the draft once the work looks right. Approval unlocks the final vault and payment card.
            </p>
            {reviewError ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                <AlertCircleIcon className="h-3.5 w-3.5" />
                {reviewError}
              </p>
            ) : null}
            {reviewMessage ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-1 text-xs text-success">
                <CheckCircle2Icon className="h-3.5 w-3.5" />
                {reviewMessage}
              </p>
            ) : null}
            {invoice.draftAttachments.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Draft previews</p>
                {invoice.draftAttachments.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">Watermarked preview · {file.type || "file"}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => requestDownload(file.id)} disabled={downloadingId === file.id}>
                      {downloadingId === file.id ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-4 space-y-2">
              <label htmlFor="review-comment" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Client feedback</label>
              <textarea
                id="review-comment"
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Share feedback, questions, or revision requests..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" className="gap-2" onClick={submitReviewComment} disabled={reviewPending || !reviewComment.trim()}>
                  {reviewPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SignatureIcon className="h-4 w-4" />}
                  Send feedback
                </Button>
                <Button type="button" className="gap-2" onClick={approveDraft} disabled={reviewPending || draftApproved}>
                  {reviewPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckCircle2Icon className="h-4 w-4" />}
                  Approve draft
                </Button>
              </div>
            </div>
            {comments.length > 0 ? (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Review thread</p>
                {comments.map((comment) => (
                  <div key={comment.id} className="rounded-xl border border-border bg-muted/20 px-3 py-3 text-sm">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <span>{comment.senderRole === "CLIENT" ? "Client" : "Freelancer"}</span>
                      <span>{new Date(comment.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="leading-relaxed text-foreground">{comment.message}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {draftApproved ? (
              <div className="mt-5 rounded-xl border border-success/20 bg-success/10 px-3 py-3 text-sm text-success">
                The draft is approved. The freelancer can now upload the final vault deliverables and the paywall is ready.
              </div>
            ) : null}
          </div>
        )}

        {!isPaid ? (
          <div className="surface mt-4 px-6 py-6 sm:px-7">
            <div className="flex items-start gap-3">
              <Checkbox
                id="accept-terms"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(Boolean(v))}
                className="mt-1"
              />
              <label htmlFor="accept-terms" className="flex-1 text-sm leading-relaxed text-muted-foreground">
                I accept the <span className="font-semibold text-foreground">terms & conditions</span> and
                authorize the freelancer to charge the above total to my card.
              </label>
            </div>

            <div className="mt-4">
              <label htmlFor="signature" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Digital signature (type your full legal name)
              </label>
              <div className="relative">
                <SignatureIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="signature"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="h-11 pl-9"
                  autoComplete="off"
                  disabled={acceptState === "saved" || acceptState === "saving"}
                />
              </div>
            </div>

          {acceptState === "saved" ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              Accepted · {new Date().toLocaleString()}
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={submitAcceptance}
              disabled={acceptState === "saving" || !accepted || signature.trim().length < 3}
              className="mt-4 h-11 w-full gap-2"
            >
              {acceptState === "saving" ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Recording acceptance…
                </>
              ) : (
                <>
                  <ShieldCheckIcon className="h-4 w-4" />
                  Accept terms & confirm signature
                </>
              )}
            </Button>
          )}
          {acceptError ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              {acceptError}
            </p>
          ) : null}
          </div>
        ) : null}

        {/* Payment (Stripe Elements) */}
        {!isPaid && canShowPaymentCard ? (
        <div className={cn("surface mt-4 px-6 py-6 sm:px-7 transition-opacity", canPay ? "opacity-100" : "opacity-50 pointer-events-none")}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">
              <LockIcon className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
              Card details
            </h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheckIcon className="h-3.5 w-3.5 text-success" />
              Secured by Stripe
            </span>
          </div>

          {paymentIntentClientSecret ? (
            <div ref={elementsRef} className="min-h-[140px]" />
          ) : (
            <PaymentNotReady />
          )}

          {payError ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              {payError}
            </p>
          ) : null}

          <Button
            type="button"
            size="lg"
            onClick={pay}
            disabled={!canPay || paying || !paymentIntentClientSecret}
            className="mt-5 h-12 w-full gap-2 rounded-xl text-base"
          >
            {paying ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Processing payment…
              </>
            ) : (
              <>
                <ZapIcon className="h-4 w-4" />
                Pay {totalDisplay}
              </>
            )}
          </Button>

          {!canPay ? (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Accept the terms & sign above to enable payment.
            </p>
          ) : null}

          {MOCK_PAYMENTS_ENABLED ? (
            <SimulatePaymentButton
              invoiceId={invoice.id}
              onPaid={() => setMockPaid(true)}
            />
          ) : null}

          {DEV_BYPASS_ENABLED ? <DevBypassButton invoiceId={invoice.id} onSuccess={() => setSuccess(true)} /> : null}
        </div>
        ) : null}

        {!isPaid && !canShowPaymentCard ? (
          <div className="surface mt-4 px-6 py-6 sm:px-7 text-sm text-muted-foreground">
            <p>Once the draft is approved, the final vault and payment card will appear here.</p>
          </div>
        ) : null}

        <p className="mt-8 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          ClientLockbox · Secure Client Portal
        </p>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ */

/** Cents → display money string (e.g. "$567.47"). */
function centsMoney(cents: number, currency: string): string {
  return money(cents / 100, currency);
}

/**
 * Clean itemized fee summary rendered before the card-entry section.
 * Shows where every cent goes: freelancer base, platform fee, Stripe fee, total.
 */
function FeeSummary({
  breakdown,
  invoice,
}: {
  breakdown: CheckoutBreakdown | null;
  invoice: PublicInvoiceView;
}) {
  // Fallback to legacy invoice row when no server breakdown is available.
  const baseAmt = breakdown
    ? centsMoney(breakdown.baseAmountCents, invoice.currency)
    : money(invoice.amount, invoice.currency);
  const platformAmt = breakdown
    ? centsMoney(breakdown.platformFeeCents, invoice.currency)
    : money(invoice.platform_fee, invoice.currency);
  const stripeAmt = breakdown
    ? centsMoney(breakdown.stripeFeeCents, invoice.currency)
    : null; // Unknown for legacy invoices.
  const totalAmt = breakdown
    ? centsMoney(breakdown.totalClientAmountCents, invoice.currency)
    : money(invoice.total_charged, invoice.currency);
  const feePercent = breakdown?.effectiveFeePercent ?? null;
  const platformFeeLabel = breakdown?.tier === "PRO" ? "ClientLockbox fee" : "ClientLockbox fee";

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/40">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-muted-foreground">Freelancer&rsquo;s invoice</span>
        <span className="text-sm font-medium text-foreground">{baseAmt}</span>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {platformFeeLabel}
          {feePercent != null ? (
            <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {feePercent}%
            </span>
          ) : null}
        </span>
        <span className="text-sm font-medium text-foreground">{platformAmt}</span>
      </div>
      {stripeAmt != null && (
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">Processing fee</span>
          <span className="text-sm font-medium text-foreground">{stripeAmt}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-primary/20 bg-primary/5 px-4 py-3.5 rounded-b-xl">
        <span className="text-sm font-semibold text-foreground">Total due</span>
        <span className="text-base font-bold text-primary">{totalAmt}</span>
      </div>
      <p className="px-4 py-2.5 text-center text-[11px] text-muted-foreground">
        You pay exactly what&rsquo;s shown. No surprise charges.
      </p>
    </div>
  );
}

function PaymentNotReady() {
  return (
    <div className="space-y-2">
      <div className="skeleton h-11 w-full rounded-md" />
      <div className="skeleton h-11 w-full rounded-md" />
      <div className="skeleton h-11 w-1/2 rounded-md" />
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <RotateCcwIcon className="h-3.5 w-3.5 animate-spin" />
        <span>Preparing secure payment form…</span>
      </div>
    </div>
  );
}

function SuccessScreen({ invoice, totalDisplay }: { invoice: PublicInvoiceView; totalDisplay: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-12rem] h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-success/15 blur-[120px]" />
      </div>
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
        <div className="surface-elevated max-w-md p-8 text-center">
          <div className="mx-auto mb-5 checkmark-ring h-16 w-16">
            <CheckCircle2Icon className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Payment successful</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We charged <span className="font-semibold text-foreground">
              {money(invoice.total_charged, invoice.currency)}
            </span> and notified your freelancer. You should receive a receipt shortly.
          </p>
          <p className="mt-8 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            ClientLockbox · Secure Client Portal
          </p>
        </div>
      </div>
    </main>
  );
}

function DevBypassButton({ invoiceId, onSuccess }: { invoiceId: string; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/dev-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      if (res.ok) onSuccess();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className="mt-4 w-full text-[11px] text-muted-foreground underline hover:text-foreground"
    >
      {busy ? "Bypassing…" : "(dev) mark invoice paid without charging"}
    </button>
  );
}

/**
 * Prominent mock-payment button. POSTs to /api/dev/mock-pay, which mirrors the
 * production Stripe webhook (invoice → PAID + fee breakdown + ledger insert)
 * so the entire client portal flow can be tested locally without Stripe keys.
 * On success, the parent flips straight into the download-deliverables view.
 */
function SimulatePaymentButton({ invoiceId, onPaid }: { invoiceId: string; onPaid: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/mock-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Could not simulate the payment.");
      }
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not simulate the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-warning/60 bg-warning/10 px-4 py-3 text-sm font-bold uppercase tracking-wide text-warning-foreground shadow-sm transition hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2Icon className="h-4 w-4 animate-spin" />
        ) : (
          <ZapIcon className="h-4 w-4" />
        )}
        {busy ? "Simulating payment…" : "⚡ Simulate Payment (Dev Only)"}
      </button>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        Mock mode — marks the invoice PAID without charging a card.
      </p>
      {error ? (
        <p className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertCircleIcon className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CurrencyCode,
  SUPPORTED_CURRENCIES,
  CURRENCY_LABELS,
  money,
} from "@/lib/format";
import {
  ClockIcon,
  ZapIcon,
  CopyIcon,
  CheckCircle2Icon,
  MessageCircleIcon,
  SendIcon,
  XIcon,
  Loader2Icon,
  GlobeIcon,
  CalendarIcon,
} from "@/components/icons";

/**
 * Pillar 1 — The 60-second Invoice Flow.
 *
 * Exactly 4 inputs:
 *   1. Client Email
 *   2. Scope of Work (textarea)
 *   3. Amount + currency toggle
 *   4. Due Date / Terms
 *
 * On submit it inserts the invoice row, instantly surfaces the success
 * action-sheet with:
 *   - Copy Secure Payment Link
 *   - Share via WhatsApp
 *   - Share via SMS
 *
 * Designed mobile-first: every field stacks to grid-cols-1 below sm.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type CreatedInvoice = {
  id: string;
  client_email: string;
  scope_of_work: string;
  amount: number;
  currency: string;
  due_date: string | null;
  terms: string | null;
  status: "PENDING" | "PAID" | "REFUNDED";
  created_at: string;
};

type Props = {
  freelancerId: string;
  onCreated?: (row: CreatedInvoice) => void;
};

export function CreateInvoiceForm({ freelancerId, onCreated }: Props) {
  const supabase = createClient();

  const [form, setForm] = useState({
    clientEmail: "",
    scopeOfWork: "",
    amount: "",
    currency: "usd" as CurrencyCode,
    dueDate: "",
    terms: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvoice | null>(null);
  const [copied, setCopied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const platformFee = useCallback(() => {
    const amt = parseFloat(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    const baseAmountCents = Math.round(amt * 100);
    const platformFeeCents = Math.round((baseAmountCents * 10) / 100);
    return platformFeeCents / 100;
  }, [form.amount]);

  const totalCharged = useCallback(() => {
    const amt = parseFloat(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    const baseAmountCents = Math.round(amt * 100);
    const platformFeeCents = Math.round((baseAmountCents * 10) / 100);
    const stripeFeeCents = Math.round((baseAmountCents + platformFeeCents) * 0.029) + 30;
    return (baseAmountCents + platformFeeCents + stripeFeeCents) / 100;
  }, [form.amount]);

  const setField = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((p) => ({ ...p, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setError(null);

    const clientEmail = form.clientEmail.trim();
    const scopeOfWork = form.scopeOfWork.trim();
    const amount = parseFloat(form.amount);
    const dueDate = form.dueDate ? form.dueDate : null; // yyyy-mm-dd
    const terms = form.terms.trim() || null;

    if (!EMAIL_RE.test(clientEmail)) {
      return setError("Please enter a valid client email address.");
    }
    if (scopeOfWork.length < 4) {
      return setError("Describe the scope of work briefly (min 4 characters).");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError("Amount must be greater than 0.");
    }

    setPending(true);

    const invoiceId = generateUuid();
    const baseAmountCents = Math.round(amount * 100);
    const platformFeeCents = Math.round((baseAmountCents * 10) / 100);
    const stripeFeeCents = Math.round((baseAmountCents + platformFeeCents) * 0.029) + 30;
    const totalClientAmountCents = baseAmountCents + platformFeeCents + stripeFeeCents;

    const row = {
      id: invoiceId,
      freelancer_id: freelancerId,
      client_name: clientEmail.split("@")[0] || "Client", // legacy col kept for compat
      client_email: clientEmail,
      amount,
      platform_fee: platformFeeCents / 100,
      total_charged: totalClientAmountCents / 100,
      base_amount_cents: baseAmountCents,
      platform_fee_cents: platformFeeCents,
      stripe_fee_cents: stripeFeeCents,
      total_client_amount_cents: totalClientAmountCents,
      currency: form.currency,
      scope_of_work: scopeOfWork,
      due_date: dueDate,
      terms,
      status: "PENDING" as const,
      // file_path + file paywall retired — leave null (column is now nullable).
      file_path: null,
      signature: null,
      accepted_at: null,
    };

    try {
      const { data, error: insErr } = await supabase
        .from("invoices")
        .insert(row)
        .select("id, client_email, scope_of_work, amount, currency, due_date, terms, status, created_at")
        .single();

      if (insErr || !data) {
        throw new Error(insErr?.message ?? "Could not create the invoice.");
      }

      const created = data as unknown as CreatedInvoice;
      setCreated(created);
      setSheetOpen(true);
      onCreated?.(created);

      // Fire-and-forget: send the "invoice created" email to the client.
      // This is non-blocking — the invoice is already persisted. If email
      // delivery fails the client still gets the share link from the dashboard.
      fetch("/api/email/invoice-created", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: created.id }),
      }).catch(() => {
        // Swallow — the user already sees the success sheet.
      });

      // Reset form (keep currency — freelancer usually bills in same currency).
      setForm((p) => ({
        ...p,
        clientEmail: "",
        scopeOfWork: "",
        amount: "",
        dueDate: "",
        terms: "",
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please retry.";
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const shareUrl = created
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${created.id}`
    : "";

  const shareMessage = (() => {
    if (!created) return "";
    const amt = money(created.amount, created.currency);
    return `You have a new invoice${created.due_date ? ` (due ${created.due_date})` : ""} for ${amt}. Review and pay securely here: ${shareUrl}`;
  })();

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback for restricted clipboard contexts: select+execCommand.
      const ta = document.createElement("textarea");
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2200); }
      catch { /* noop */ }
      document.body.removeChild(ta);
    }
  };

  const shareWhatsapp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareSms = () => {
    // sms:?&body works on iOS+Android; desktops ignore gracefully.
    window.location.href = `sms:?&body=${encodeURIComponent(shareMessage)}`;
  };

  return (
    <section className="surface-elevated relative">
      {/* subtle top accent */}
      <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

      <div className="px-5 py-5 sm:px-7 sm:py-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              New invoice
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Four fields. One secure link. Out in 60 seconds.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <ZapIcon className="h-3 w-3" />
            10% Free / 0% Pro
          </span>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* 1. Client email */}
          <div className="sm:col-span-2">
            <Label htmlFor="clientEmail" className="mb-1.5 block text-sm font-medium text-foreground">
              Client email
            </Label>
            <Input
              id="clientEmail"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="client@company.com"
              value={form.clientEmail}
              onChange={(e) => setField("clientEmail", e.target.value)}
              required
              disabled={pending}
              className="h-11"
            />
          </div>

          {/* 2. Scope of work */}
          <div className="sm:col-span-2">
            <Label htmlFor="scopeOfWork" className="mb-1.5 block text-sm font-medium text-foreground">
              Scope of work
            </Label>
            <Textarea
              id="scopeOfWork"
              placeholder="e.g. Brand strategy workshop (2 sessions) + deliverable deck. Revisions up to 2 rounds."
              value={form.scopeOfWork}
              onChange={(e) => setField("scopeOfWork", e.target.value)}
              required
              disabled={pending}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 3. Amount + currency */}
          <div className="sm:col-span-2">
            <Label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-foreground">
              Amount
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setField("amount", e.target.value)}
                  required
                  disabled={pending}
                  className="h-11 pr-16"
                />
                {form.amount && parseFloat(form.amount) > 0 ? (
                  <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-sm text-muted-foreground">
                    fee {money(platformFee(), form.currency)} · total {money(totalCharged(), form.currency)}
                  </span>
                ) : null}
              </div>
              <div className="relative">
                <GlobeIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <select
                  aria-label="Currency"
                  value={form.currency}
                  onChange={(e) => setField("currency", e.target.value as CurrencyCode)}
                  disabled={pending}
                  className="h-11 rounded-md border border-input bg-transparent pl-9 pr-7 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>
                <span className="sr-only">{CURRENCY_LABELS[form.currency]}</span>
              </div>
            </div>
          </div>

          {/* 4. Due Date / Terms */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="dueDate" className="mb-1.5 block text-sm font-medium text-foreground">
                Due date <span className="text-muted-foreground">(optional)</span>
              </Label>
              <div className="relative">
                <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setField("dueDate", e.target.value)}
                  disabled={pending}
                  className="h-11 pl-9"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="terms" className="mb-1.5 block text-sm font-medium text-foreground">
                Terms <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="terms"
                placeholder="e.g. Net 7 · 50% upfront"
                value={form.terms}
                onChange={(e) => setField("terms", e.target.value)}
                disabled={pending}
                className="h-11"
              />
            </div>
          </div>

          {/* error */}
          {error ? (
            <p className="sm:col-span-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {/* CTA */}
          <div className="sm:col-span-2 mt-1 flex items-center justify-end">
            <Button
              type="submit"
              disabled={pending}
              size="lg"
              className="h-11 gap-2 rounded-xl px-6"
            >
              {pending ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <ZapIcon className="h-4 w-4" />
                  Generate secure payment link
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      {/* Success action sheet */}
      {sheetOpen && created ? (
        <ShareSheet
          shareUrl={shareUrl}
          amount={created.amount}
          currency={created.currency}
          dueDate={created.due_date}
          copied={copied}
          onCopy={copyLink}
          onWhatsapp={shareWhatsapp}
          onSms={shareSms}
          onClose={() => {
            setSheetOpen(false);
            setCreated(null);
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ */
function ShareSheet(props: {
  shareUrl: string;
  amount: number;
  currency: string;
  dueDate: string | null;
  copied: boolean;
  onCopy: () => void;
  onWhatsapp: () => void;
  onSms: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Secure payment link ready"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center"
      onClick={props.onClose}
    >
      <div
        className="animate-slide-up-sheet surface w-full max-w-md rounded-b-none rounded-t-3xl px-5 py-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="checkmark-ring h-10 w-10">
              <CheckCircle2Icon className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-foreground">
                Link ready to send
              </h3>
              <p className="text-sm text-muted-foreground">
                {money(props.amount, props.currency)}
                {props.dueDate ? ` · due ${props.dueDate}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={props.onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* The secure link itself, read-only */}
        <div className="rounded-xl border border-border bg-muted/50 p-3">
          <p className="break-all font-mono text-xs text-foreground/80">{props.shareUrl}</p>
        </div>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-1 gap-2.5">
          <button
            onClick={props.onCopy}
            className="btn-primary-glow flex h-11 w-full items-center justify-center gap-2"
          >
            {props.copied ? (
              <>
                <CheckCircle2Icon className="h-4 w-4" />
                Copied to clipboard
              </>
            ) : (
              <>
                <CopyIcon className="h-4 w-4" />
                Copy secure payment link
              </>
            )}
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={props.onWhatsapp}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
            >
              <MessageCircleIcon className="h-4 w-4 text-emerald-600" />
              WhatsApp
            </button>
            <button
              onClick={props.onSms}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
            >
              <SendIcon className="h-4 w-4 text-primary" />
              SMS
            </button>
          </div>
        </div>

        <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ClockIcon className="h-3.5 w-3.5" />
          Clients accept terms & sign on the portal page before paying.
        </p>
      </div>
    </div>
  );
}

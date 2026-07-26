"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  XIcon,
  UserIcon,
  MailIcon,
  FilmIcon,
  VideoIcon,
  CloudUploadIcon,
  HardDriveIcon,
  KeyIcon,
  TimerIcon,
  CalculatorIcon,
  InfoIcon,
  CheckCircle2Icon,
  Loader2Icon,
  CopyIcon,
  UnlockIcon,
  FilmIcon as FilmAltIcon,
  IndianRupeeIcon,
} from "@/components/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanType = "FREE" | "PRO";

type DropzoneFile = { file: File; uploadProgress: number; done: boolean };

type FormState = {
  clientName: string;
  clientEmail: string;
  projectTitle: string;
  baseAmount: string;
  deliveryPassword: string;
  autoExpiry: boolean;
  expiryDays: number;
};

type BreakdownResult = {
  base: number;
  platformFee: number;
  razorpayFee: number;
  grossCharge: number;
};

// ---------------------------------------------------------------------------
// Razorpay gross-up math
// FORMULA: G = (Base + PlatformFee) / (1 - 0.0236)
// Free tier:  PlatformFee = 10% of Base
// Pro  tier:  PlatformFee = 0
// ---------------------------------------------------------------------------

function calcBreakdown(baseStr: string, plan: PlanType): BreakdownResult | null {
  const base = parseFloat(baseStr);
  if (!Number.isFinite(base) || base <= 0) return null;

  const platformFee = plan === "FREE" ? base * 0.1 : 0;
  const subtotal = base + platformFee;
  // Gross-up so Razorpay 2.36% processing is absorbed
  const grossCharge = subtotal / (1 - 0.0236);
  const razorpayFee = grossCharge - subtotal;

  return {
    base,
    platformFee,
    razorpayFee,
    grossCharge,
  };
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Dropzone sub-component
// ---------------------------------------------------------------------------

function Dropzone({
  id,
  label,
  sublabel,
  icon: Icon,
  accept,
  value,
  onChange,
  accentColor,
}: {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  accept: string;
  value: DropzoneFile | null;
  onChange: (f: DropzoneFile | null) => void;
  accentColor: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const df: DropzoneFile = { file, uploadProgress: 0, done: false };
      onChange(df);
      // Simulate upload progress
      let progress = 0;
      const iv = setInterval(() => {
        progress += Math.random() * 18 + 6;
        if (progress >= 100) {
          progress = 100;
          clearInterval(iv);
          onChange({ file, uploadProgress: 100, done: true });
        } else {
          onChange({ file, uploadProgress: Math.round(progress), done: false });
        }
      }, 160);
    },
    [onChange],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>
        {label}
      </label>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-label={`Upload ${label}`}
        className={cn(
          "relative flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 transition-all",
          dragging ? "scale-[0.99]" : "",
        )}
        style={{
          borderColor: dragging
            ? accentColor
            : value?.done
            ? "rgba(34,197,94,0.35)"
            : "rgba(255,255,255,0.09)",
          background: dragging
            ? `${accentColor}08`
            : value?.done
            ? "rgba(34,197,94,0.05)"
            : "rgba(255,255,255,0.025)",
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {value ? (
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2.5">
              {value.done ? (
                <CheckCircle2Icon className="h-4 w-4 shrink-0" style={{ color: "#22C55E" }} />
              ) : (
                <Loader2Icon className="h-4 w-4 shrink-0 animate-spin" style={{ color: accentColor }} />
              )}
              <span className="truncate text-xs font-medium text-white">{value.file.name}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(null); }}
                className="ml-auto shrink-0 rounded-full p-0.5 text-white/30 hover:text-white/70 transition-colors"
                aria-label="Remove file"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {!value.done && (
              <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${value.uploadProgress}%`, background: `linear-gradient(90deg,${accentColor},${accentColor}99)` }}
                />
              </div>
            )}
            {value.done && (
              <p className="text-xs" style={{ color: "#22C55E" }}>
                Upload complete &mdash; {(value.file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>
        ) : (
          <>
            <Icon className="h-5 w-5" style={{ color: accentColor }} />
            <div className="text-center">
              <p className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.65)" }}>
                Drop file or <span style={{ color: accentColor }}>browse</span>
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                {sublabel}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown row
// ---------------------------------------------------------------------------

function BreakdownRow({
  label,
  value,
  isTotal,
  tone,
  tooltip,
}: {
  label: string;
  value: string;
  isTotal?: boolean;
  tone?: "cyan" | "violet" | "green" | "muted";
  tooltip?: string;
}) {
  const colors: Record<string, string> = {
    cyan: "#00E5FF",
    violet: "#A855F7",
    green: "#22C55E",
    muted: "rgba(255,255,255,0.3)",
  };
  const valueColor = tone ? colors[tone] : "rgba(255,255,255,0.85)";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 py-1.5",
        isTotal ? "border-t mt-1 pt-2.5" : "",
      )}
      style={isTotal ? { borderColor: "rgba(255,255,255,0.08)" } : {}}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn("text-xs", isTotal ? "font-semibold text-white" : "")}
          style={!isTotal ? { color: "rgba(255,255,255,0.5)" } : {}}
        >
          {label}
        </span>
        {tooltip && (
          <span title={tooltip} className="cursor-help">
            <InfoIcon className="h-3 w-3" style={{ color: "rgba(255,255,255,0.25)" }} />
          </span>
        )}
      </div>
      <span
        className={cn("shrink-0 font-mono text-xs tabular-nums", isTotal ? "text-base font-bold" : "")}
        style={{ color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  planType: PlanType;
  freelancerId?: string;
  onCreated?: (invoiceId: string, payLink: string) => void;
};

export function CreatePaywalledDeliverableModal({
  open,
  onClose,
  planType,
  onCreated,
}: Props) {
  const [form, setForm] = useState<FormState>({
    clientName: "",
    clientEmail: "",
    projectTitle: "",
    baseAmount: "",
    deliveryPassword: "",
    autoExpiry: true,
    expiryDays: 7,
  });
  const [previewFile, setPreviewFile] = useState<DropzoneFile | null>(null);
  const [vaultFile, setVaultFile] = useState<DropzoneFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invoiceId: string; payLink: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const breakdown = useMemo(
    () => calcBreakdown(form.baseAmount, planType),
    [form.baseAmount, planType],
  );

  const canSubmit =
    form.clientName.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.clientEmail) &&
    form.projectTitle.trim().length >= 2 &&
    breakdown !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim(),
          projectTitle: form.projectTitle.trim(),
          baseAmountUsd: breakdown!.base,
          grossChargeUsd: breakdown!.grossCharge,
          platformFeeUsd: breakdown!.platformFee,
          planType,
          autoExpiry: form.autoExpiry,
          expiryDays: form.expiryDays,
          deliveryPassword: form.deliveryPassword.trim() || null,
        }),
      });
      const data = (await res.json()) as {
        invoiceId?: string;
        payLink?: string;
        error?: string;
      };
      if (!res.ok || !data.invoiceId) {
        throw new Error(data.error ?? "Failed to create deliverable.");
      }
      const payLink = data.payLink ?? `${window.location.origin}/deliver/${data.invoiceId}`;
      setResult({ invoiceId: data.invoiceId, payLink });
      onCreated?.(data.invoiceId, payLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.payLink);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = result.payLink;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const resetAndClose = () => {
    setForm({ clientName: "", clientEmail: "", projectTitle: "", baseAmount: "", deliveryPassword: "", autoExpiry: true, expiryDays: 7 });
    setPreviewFile(null);
    setVaultFile(null);
    setError(null);
    setResult(null);
    setCopied(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create Paywalled Deliverable"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: "rgba(9,13,22,0.82)", backdropFilter: "blur(12px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) resetAndClose(); }}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-b-none rounded-t-3xl sm:rounded-3xl"
        style={{
          background: "rgba(14,18,30,0.98)",
          border: "1px solid rgba(0,229,255,0.12)",
          boxShadow: "0 0 80px rgba(0,229,255,0.07), 0 32px 80px rgba(0,0,0,0.6)",
          maxHeight: "92dvh",
        }}
      >
        {/* Accent glow top */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg,transparent,rgba(0,229,255,0.5),rgba(168,85,247,0.4),transparent)" }}
        />

        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-6 py-5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.2)" }}
            >
              <FilmAltIcon className="h-5 w-5" style={{ color: "#00E5FF" }} />
            </span>
            <div>
              <h2 className="text-base font-bold text-white">Create Paywalled Deliverable</h2>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Payment-locked 4K file with Razorpay escrow
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close modal"
            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {result ? (
            <SuccessView
              result={result}
              copied={copied}
              onCopy={copyLink}
              onClose={resetAndClose}
            />
          ) : (
            <form id="create-deliverable-form" onSubmit={handleSubmit} className="flex flex-col gap-6">

              {/* ── Section 1: Client Info ── */}
              <section className="flex flex-col gap-3">
                <SectionLabel icon={<UserIcon className="h-3.5 w-3.5" />} text="Client Information" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    id="clientName"
                    label="Client Name"
                    placeholder="Arjun Mehta"
                    value={form.clientName}
                    onChange={(v) => set("clientName", v)}
                  />
                  <Field
                    id="clientEmail"
                    label="Client Email"
                    placeholder="arjun@brandstudio.in"
                    type="email"
                    value={form.clientEmail}
                    onChange={(v) => set("clientEmail", v)}
                  />
                </div>
                <Field
                  id="projectTitle"
                  label="Project Title"
                  placeholder="Commercial Render v2"
                  value={form.projectTitle}
                  onChange={(v) => set("projectTitle", v)}
                />
              </section>

              {/* ── Section 2: Pricing ── */}
              <section className="flex flex-col gap-3">
                <SectionLabel icon={<IndianRupeeIcon className="h-3.5 w-3.5" />} text="Invoice Amount" />
                <Field
                  id="baseAmount"
                  label="Base Invoice Amount (USD)"
                  placeholder="500.00"
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.baseAmount}
                  onChange={(v) => set("baseAmount", v)}
                />

                {/* Live Razorpay breakdown */}
                <div
                  className="rounded-2xl p-4"
                  style={{
                    background: "rgba(0,229,255,0.04)",
                    border: "1px solid rgba(0,229,255,0.12)",
                  }}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    <CalculatorIcon className="h-3.5 w-3.5" style={{ color: "#00E5FF" }} />
                    <span className="text-xs font-semibold" style={{ color: "#00E5FF" }}>
                      Razorpay Gross-Up Calculator — Live Preview
                    </span>
                    <span
                      className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        background: planType === "PRO" ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.07)",
                        color: planType === "PRO" ? "#A855F7" : "rgba(255,255,255,0.4)",
                        border: planType === "PRO" ? "1px solid rgba(168,85,247,0.25)" : "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      {planType === "PRO" ? "Pro — 0% Fee" : "Free — 10% Fee"}
                    </span>
                  </div>

                  {breakdown ? (
                    <div>
                      <BreakdownRow
                        label="Net Freelancer Payout"
                        value={fmt(breakdown.base)}
                        tone="cyan"
                      />
                      <BreakdownRow
                        label="CiteFlow Platform Fee"
                        value={planType === "FREE" ? fmt(breakdown.platformFee) : "$0.00"}
                        tone={planType === "FREE" ? "violet" : "muted"}
                        tooltip={
                          planType === "FREE"
                            ? "10% of base on the Free tier. Upgrade to Pro to keep 100%."
                            : "Pro plan — no platform fee."
                        }
                      />
                      <BreakdownRow
                        label="Razorpay Processing Charge"
                        value={fmt(breakdown.razorpayFee)}
                        tone="muted"
                        tooltip="2.36% gross-up so you absorb zero processing cost."
                      />
                      <BreakdownRow
                        label="Total Client Due at Razorpay Checkout"
                        value={fmt(breakdown.grossCharge)}
                        isTotal
                        tone="green"
                      />
                    </div>
                  ) : (
                    <p className="py-2 text-center text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                      Enter an amount above to see the live breakdown.
                    </p>
                  )}
                </div>
              </section>

              {/* ── Section 3: Asset Dropzones ── */}
              <section className="flex flex-col gap-3">
                <SectionLabel icon={<VideoIcon className="h-3.5 w-3.5" />} text="Asset Uploads" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Dropzone
                    id="previewVideo"
                    label="Draft Preview Video"
                    sublabel="MP4 / MOV — streamed with watermark"
                    icon={VideoIcon}
                    accept="video/mp4,video/quicktime,.mp4,.mov"
                    value={previewFile}
                    onChange={setPreviewFile}
                    accentColor="#00E5FF"
                  />
                  <Dropzone
                    id="vaultFile"
                    label="Raw Vault Deliverable"
                    sublabel="4K MP4 / MOV / ZIP — up to 20 GB · R2"
                    icon={HardDriveIcon}
                    accept="video/mp4,video/quicktime,application/zip,.mp4,.mov,.zip"
                    value={vaultFile}
                    onChange={setVaultFile}
                    accentColor="#A855F7"
                  />
                </div>
              </section>

              {/* ── Section 4: Delivery Options ── */}
              <section className="flex flex-col gap-3">
                <SectionLabel icon={<KeyIcon className="h-3.5 w-3.5" />} text="Delivery Options" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    id="deliveryPassword"
                    label="Delivery Password (optional)"
                    placeholder="Enter a passphrase&hellip;"
                    type="password"
                    value={form.deliveryPassword}
                    onChange={(v) => set("deliveryPassword", v)}
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>
                      Auto-Expiry
                    </label>
                    <div
                      className="flex h-[44px] items-center justify-between gap-3 rounded-xl px-4"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <TimerIcon className="h-3.5 w-3.5" style={{ color: form.autoExpiry ? "#00E5FF" : "rgba(255,255,255,0.3)" }} />
                        <span className="text-xs font-medium" style={{ color: form.autoExpiry ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.35)" }}>
                          {form.autoExpiry ? `Expires in ${form.expiryDays} days` : "No expiry"}
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={form.autoExpiry}
                        onClick={() => set("autoExpiry", !form.autoExpiry)}
                        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                        style={{
                          background: form.autoExpiry ? "rgba(0,229,255,0.5)" : "rgba(255,255,255,0.1)",
                        }}
                      >
                        <span
                          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all"
                          style={{ left: form.autoExpiry ? "calc(100% - 22px)" : "2px" }}
                        />
                      </button>
                    </div>
                    {form.autoExpiry && (
                      <div className="flex items-center gap-2">
                        {[3, 7, 14, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => set("expiryDays", d)}
                            className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
                            style={{
                              background: form.expiryDays === d ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.04)",
                              border: `1px solid ${form.expiryDays === d ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.07)"}`,
                              color: form.expiryDays === d ? "#00E5FF" : "rgba(255,255,255,0.35)",
                            }}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Error */}
              {error && (
                <p
                  className="rounded-xl px-4 py-3 text-xs font-medium"
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    color: "#F87171",
                  }}
                >
                  {error}
                </p>
              )}
            </form>
          )}
        </div>

        {/* Footer CTA */}
        {!result && (
          <div
            className="shrink-0 px-6 py-5"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <button
              type="submit"
              form="create-deliverable-form"
              disabled={!canSubmit || submitting}
              className="flex w-full items-center justify-center gap-2.5 rounded-2xl py-3.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: canSubmit && !submitting
                  ? "linear-gradient(135deg,#00E5FF 0%,#0099AA 100%)"
                  : "rgba(255,255,255,0.08)",
                color: canSubmit && !submitting ? "#090D16" : "rgba(255,255,255,0.3)",
                boxShadow: canSubmit && !submitting ? "0 4px 24px rgba(0,229,255,0.25)" : "none",
              }}
            >
              {submitting ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Creating paywall&hellip;
                </>
              ) : (
                <>
                  <UnlockIcon className="h-4 w-4" />
                  Generate Razorpay Paywall Link
                </>
              )}
            </button>
            <p className="mt-2 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
              Client pays via Razorpay. 4K file unlocks automatically on payment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success view
// ---------------------------------------------------------------------------

function SuccessView({
  result,
  copied,
  onCopy,
  onClose,
}: {
  result: { invoiceId: string; payLink: string };
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center">
      <span
        className="grid h-16 w-16 place-items-center rounded-2xl"
        style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.25)" }}
      >
        <CheckCircle2Icon className="h-8 w-8" style={{ color: "#00E5FF" }} />
      </span>

      <div>
        <p className="text-xl font-bold text-white">Paywall Link Created</p>
        <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
          Share this link with your client. They&apos;ll pay via Razorpay to unlock the 4K file.
        </p>
      </div>

      {/* Link box */}
      <div
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3"
        style={{ background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.15)" }}
      >
        <span className="min-w-0 flex-1 truncate text-left font-mono text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
          {result.payLink}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
          style={{
            background: copied ? "rgba(34,197,94,0.12)" : "rgba(0,229,255,0.12)",
            color: copied ? "#22C55E" : "#00E5FF",
            border: `1px solid ${copied ? "rgba(34,197,94,0.25)" : "rgba(0,229,255,0.25)"}`,
          }}
        >
          {copied ? <CheckCircle2Icon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="flex w-full flex-col gap-2">
        <a
          href={result.payLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-all hover:-translate-y-px"
          style={{
            background: "linear-gradient(135deg,#00E5FF,#0099AA)",
            color: "#090D16",
            boxShadow: "0 4px 20px rgba(0,229,255,0.25)",
          }}
        >
          Preview Paywall Page
        </a>
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-full rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: "rgba(255,255,255,0.35)" }}>{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
        {text}
      </span>
    </div>
  );
}

function Field({
  id,
  label,
  placeholder,
  type = "text",
  step,
  min,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  type?: string;
  step?: string;
  min?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        step={step}
        min={min}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl px-4 text-sm text-white outline-none transition-all"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          caretColor: "#00E5FF",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,229,255,0.4)"; e.currentTarget.style.background = "rgba(0,229,255,0.04)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      />
    </div>
  );
}

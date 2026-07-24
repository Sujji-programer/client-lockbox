"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  XIcon,
  UploadCloudIcon,
  Loader2Icon,
  LockIcon,
  ClockIcon,
  ShieldCheckIcon,
  FileTextIcon,
  VideoIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  ZapIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ *
 * Razorpay pricing constants
 *
 * The Razorpay pass-through model used here is a *gross-up*: the
 * freelancer's base + platform fee is divided by (1 - rate) so the
 * client pays a single gross amount that nets out to the desired
 * settlement after Razorpay deducts its processing cut.
 *
 *   Razorpay rate (intl card)            = 2.36 %
 *   Razorpay effective gross-up divisor = 1 - 0.0236 = 0.9764
 * ------------------------------------------------------------------ */

/** Razorpay processing rate as a decimal (2.36%). */
const RAZORPAY_FEE_RATE = 0.0236;

/** Gross-up divisor applied to (base + platform fee). */
const RAZORPAY_GROSSUP_DIVISOR = 1 - RAZORPAY_FEE_RATE;

/** Platform-fee rate for the FREE tier (10% of base). */
const FREE_TIER_FEE_PERCENT = 0.1;

/** Platform-fee rate for the PRO tier ($0). */
const PRO_TIER_FEE_PERCENT = 0;

/** Max Raw Vault deliverable size (20 GB) — Cloudflare R2 target. */
const MAX_VAULT_SIZE_BYTES = 20 * 1024 * 1024 * 1024;

/** Default auto-expiry window for paywall links. */
const DEFAULT_EXPIRY_DAYS = 7;

/** Accepted Raw Vault extensions (4K MP4 / MOV / ZIP). */
const VAULT_ACCEPTED_EXT = /\.(mp4|mov|zip)$/i;

/** Accepted Draft Preview extensions (any streamable video). */
const PREVIEW_ACCEPTED_EXT = /\.(mp4|mov|webm|m4v|avi)$/i;

type Tier = "FREE" | "PRO";

type Stage = "idle" | "submitting" | "success" | "error";

/* -------------------------------------------------------------- *
 * Money helpers
 * -------------------------------------------------------------- */

/** Format a number into a fixed USD currency string (e.g. "$563.29"). */
function money(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

/** Human-readable byte count for the dropzone hints. */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* -------------------------------------------------------------- *
 * Razorpay gross-up calculator
 *
 *   Platform Fee   P = (tier === "PRO") ? 0 : base * 0.10
 *   Gross Charge   G = (base + P) / (1 - 0.0236)
 *   Razorpay fee   R = G - (base + P)        // what Razorpay retains
 *   Net payout     N = base                  // freelancer keeps full base
 *   Total client   T = G
 *
 * The freelancer never absorbs the processing fee — it is grossed-up
 * into the client-facing checkout amount.
 * -------------------------------------------------------------- */
function computeRazorpayQuote(base: number, tier: Tier) {
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 0;

  const platformFee = tier === "PRO" ? PRO_TIER_FEE_PERCENT : safeBase * FREE_TIER_FEE_PERCENT;
  const grossCharge = (safeBase + platformFee) / RAZORPAY_GROSSUP_DIVISOR;
  const razorpayFee = grossCharge - (safeBase + platformFee);

  return {
    netPayout: safeBase,
    platformFee,
    razorpayFee,
    totalClientDue: grossCharge,
  };
}

/* -------------------------------------------------------------- *
 * Asset dropzone
 * -------------------------------------------------------------- */

type DropzoneKind = "preview" | "vault";

type DropzoneProps = {
  kind: DropzoneKind;
  files: File[];
  onFiles: (files: File[]) => void;
};

function AssetDropzone({ kind, files, onFiles }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPreview = kind === "preview";
  const title = isPreview ? "Draft Preview Video" : "Raw Vault Deliverable";
  const subtitle = isPreview
    ? "Streaming file — shown to client behind the paywall preview."
    : "4K MP4 / MOV / ZIP up to 20 GB — uploaded to Cloudflare R2.";
  const acceptRegex = isPreview ? PREVIEW_ACCEPTED_EXT : VAULT_ACCEPTED_EXT;
  const maxSize = isPreview ? Number.POSITIVE_INFINITY : MAX_VAULT_SIZE_BYTES;

  const validate = useCallback(
    (picked: File[]): File[] | null => {
      if (picked.length === 0) return null;
      const bad = picked.find((f) => !acceptRegex.test(f.name));
      if (bad) {
        setError(
          isPreview
            ? "Preview only accepts streamable video (mp4, mov, webm, m4v, avi)."
            : "Vault only accepts 4K MP4, MOV, or ZIP archives.",
        );
        return null;
      }
      if (!isPreview) {
        const oversized = picked.find((f) => f.size > maxSize);
        if (oversized) {
          setError(`"${oversized.name}" exceeds the 20 GB vault limit.`);
          return null;
        }
      }
      setError(null);
      return picked;
    },
    [acceptRegex, isPreview, maxSize],
  );

  const handleSelect = useCallback(
    (list: FileList | File[] | null) => {
      const picked = Array.from(list ?? []);
      const valid = validate(picked);
      if (valid) onFiles(valid);
    },
    [onFiles, validate],
  );

  const removeAt = (idx: number) => {
    const next = files.filter((_, i) => i !== idx);
    onFiles(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPreview ? (
            <VideoIcon className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ShieldCheckIcon className="h-4 w-4 text-muted-foreground" />
          )}
          <Label className="text-sm font-medium">{title}</Label>
        </div>
        {files.length > 0 && (
          <span className="text-xs text-muted-foreground">{files.length} file(s)</span>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleSelect(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-input hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">{isPreview ? "Drop or browse a video" : "Drop or browse deliverables"}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <input
          ref={inputRef}
          type="file"
          multiple={!isPreview}
          accept={isPreview ? "video/*" : ".mp4,.mov,.zip"}
          className="hidden"
          onChange={(e) => {
            handleSelect(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircleIcon className="h-3.5 w-3.5" />
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, idx) => (
            <li
              key={`${file.name}-${idx}`}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs"
            >
              <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground">{humanSize(file.size)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(idx);
                }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${file.name}`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- *
 * The dialog
 * -------------------------------------------------------------- */

export type PaywalledDeliverableResult = {
  clientName: string;
  clientEmail: string;
  projectTitle: string;
  baseAmount: number;
  tier: Tier;
  deliveryPassword: string | null;
  autoExpiryEnabled: boolean;
  expiryDays: number;
  previewFiles: File[];
  vaultFiles: File[];
  quote: ReturnType<typeof computeRazorpayQuote>;
  paywallLink: string;
};

export function CreatePaywalledDeliverableDialog({
  open,
  onOpenChange,
  tier = "FREE",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier?: Tier;
  onCreated?: (result: PaywalledDeliverableResult) => void;
}) {
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [baseAmount, setBaseAmount] = useState("");
  const [deliveryPassword, setDeliveryPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [autoExpiry, setAutoExpiry] = useState(true);
  const [expiryDays, setExpiryDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [previewFiles, setPreviewFiles] = useState<File[]>([]);
  const [vaultFiles, setVaultFiles] = useState<File[]>([]);

  const [stage, setStage] = useState<Stage>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [paywallLink, setPaywallLink] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const isPro = tier === "PRO";

  /* ----- live quote ----- */
  const quote = useMemo(() => {
    const base = parseFloat(baseAmount);
    return computeRazorpayQuote(Number.isFinite(base) ? base : 0, tier);
  }, [baseAmount, tier]);

  /* ----- esc / scroll lock ----- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  /* ----- reset when (re)opened ----- */
  useEffect(() => {
    if (!open) return;
    setStage("idle");
    setFormError(null);
    setPaywallLink(null);
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setClientName("");
    setClientEmail("");
    setProjectTitle("");
    setBaseAmount("");
    setDeliveryPassword("");
    setUsePassword(false);
    setAutoExpiry(true);
    setExpiryDays(DEFAULT_EXPIRY_DAYS);
    setPreviewFiles([]);
    setVaultFiles([]);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const validate = (): string | null => {
    if (!clientName.trim()) return "Client name is required.";
    if (!clientEmail.trim()) return "Client email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim()))
      return "Client email is not a valid address.";
    if (!projectTitle.trim()) return "Project title is required.";
    const base = parseFloat(baseAmount);
    if (!Number.isFinite(base) || base <= 0) return "Base invoice amount must be greater than $0.00.";
    if (usePassword && !deliveryPassword.trim()) return "Delivery password is enabled but empty.";
    if (!autoExpiry && expiryDays <= 0) return "Expiry days must be positive.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setStage("submitting");

    // Simulate paywall link generation (replace with real /api route).
    await new Promise((r) => setTimeout(r, 900));

    const slug =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const link = `https://pay.citeflow.io/d/${slug}`;

    setPaywallLink(link);
    setStage("success");

    onCreated?.({
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      projectTitle: projectTitle.trim(),
      baseAmount: parseFloat(baseAmount),
      tier,
      deliveryPassword: usePassword ? deliveryPassword.trim() : null,
      autoExpiryEnabled: autoExpiry,
      expiryDays,
      previewFiles,
      vaultFiles,
      quote,
      paywallLink: link,
    });
  };

  /* ----------------------------------------------------------- *
   * Render
   * ----------------------------------------------------------- */
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywalled-deliverable-title"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      <div
        ref={dialogRef}
        className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldCheckIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 id="paywalled-deliverable-title" className="text-base font-semibold leading-tight">
                Create Paywalled Deliverable
              </h2>
              <p className="text-xs text-muted-foreground">
                Razorpay checkout · {isPro ? "Pro tier" : "Free tier"} pricing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close dialog"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {stage === "success" && paywallLink ? (
            <SuccessView
              link={paywallLink}
              clientName={clientName}
              projectTitle={projectTitle}
              quote={quote}
              onClose={close}
            />
          ) : (
            <div className="space-y-5">
              {/* ---- client + project ---- */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cpd-client-name">Client Name</Label>
                  <Input
                    id="cpd-client-name"
                    placeholder="Jane Cooper"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cpd-client-email">Client Email</Label>
                  <Input
                    id="cpd-client-email"
                    type="email"
                    placeholder="jane@studio.co"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cpd-project-title">Project Title</Label>
                <Input
                  id="cpd-project-title"
                  placeholder="Commercial Render v2"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cpd-base-amount">Base Invoice Amount ($B)</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="cpd-base-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="500.00"
                      className="pl-6"
                      value={baseAmount}
                      onChange={(e) => setBaseAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-end">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                      isPro
                        ? "border-primary/30 bg-primary/5 text-primary"
                        : "border-muted bg-muted/40 text-muted-foreground",
                    )}
                  >
                    {isPro ? <ZapIcon className="h-3.5 w-3.5" /> : <ClockIcon className="h-3.5 w-3.5" />}
                    <span>
                      {isPro ? "Pro — $0 platform fee" : "Free — 10% platform fee"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ---- live Razorpay breakdown ---- */}
              <RazorpayBreakdown quote={quote} tier={tier} />

              {/* ---- optional delivery options ---- */}
              <div className="rounded-md border p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Delivery Options (optional)
                </p>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="cpd-use-password"
                      checked={usePassword}
                      onCheckedChange={(c) => setUsePassword(c === true)}
                    />
                    <Label htmlFor="cpd-use-password" className="flex items-center gap-1.5 text-sm font-normal">
                      <LockIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      Protect with delivery password
                    </Label>
                  </div>
                  {usePassword && (
                    <div className="pl-6">
                      <Input
                        type="text"
                        placeholder="Enter a delivery password"
                        value={deliveryPassword}
                        onChange={(e) => setDeliveryPassword(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="cpd-auto-expiry"
                      checked={autoExpiry}
                      onCheckedChange={(c) => setAutoExpiry(c === true)}
                    />
                    <Label htmlFor="cpd-auto-expiry" className="flex items-center gap-1.5 text-sm font-normal">
                      <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      Auto-expiry after
                      <Input
                        type="number"
                        min="1"
                        max="90"
                        value={expiryDays}
                        disabled={!autoExpiry}
                        onChange={(e) => setExpiryDays(parseInt(e.target.value || "0", 10) || 0)}
                        className="mx-1 h-7 w-16 text-center"
                      />
                      days
                      <span className="text-muted-foreground">(default 7)</span>
                    </Label>
                  </div>
                </div>
              </div>

              {/* ---- asset dropzones ---- */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <AssetDropzone kind="preview" files={previewFiles} onFiles={setPreviewFiles} />
                <AssetDropzone kind="vault" files={vaultFiles} onFiles={setVaultFiles} />
              </div>

              {formError && (
                <p className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircleIcon className="h-4 w-4" />
                  {formError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        {stage !== "success" && (
          <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
            <div className="text-xs text-muted-foreground">
              Client pays <span className="font-semibold text-foreground">{money(quote.totalClientDue)}</span> at checkout
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={close} disabled={stage === "submitting"}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={stage === "submitting"}>
                {stage === "submitting" ? (
                  <>
                    <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <ShieldCheckIcon className="mr-1.5 h-4 w-4" />
                    Generate Razorpay Paywall Link
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- *
 * Razorpay breakdown panel
 * -------------------------------------------------------------- */

function RazorpayBreakdown({
  quote,
  tier,
}: {
  quote: ReturnType<typeof computeRazorpayQuote>;
  tier: Tier;
}) {
  const rows: { label: string; value: number; hint?: string; emphasis?: boolean }[] = [
    { label: "Net Freelancer Payout", value: quote.netPayout, hint: "You keep the full base" },
    {
      label: "CiteFlow Platform Fee",
      value: quote.platformFee,
      hint: tier === "PRO" ? "Waived (Pro tier)" : "10% of base (Free tier)",
    },
    { label: "Razorpay Processing Charge", value: quote.razorpayFee, hint: "Grossed-up via 2.36% rate" },
    { label: "Total Client Due at Checkout", value: quote.totalClientDue, emphasis: true },
  ];

  return (
    <div className="rounded-md border bg-muted/20">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Razorpay Gross-Up Breakdown
        </span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          G = (B + P) / (1 − 0.0236)
        </code>
      </div>
      <dl className="divide-y">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              "flex items-center justify-between px-3 py-2",
              row.emphasis && "bg-primary/5",
            )}
          >
            <div>
              <dt
                className={cn(
                  "text-sm",
                  row.emphasis ? "font-semibold" : "text-muted-foreground",
                )}
              >
                {row.label}
              </dt>
              {row.hint && <p className="text-[11px] text-muted-foreground">{row.hint}</p>}
            </div>
            <dd
              className={cn(
                "tabular-nums",
                row.emphasis ? "text-base font-bold text-primary" : "text-sm font-medium",
              )}
            >
              {money(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------- *
 * Success view
 * -------------------------------------------------------------- */

function SuccessView({
  link,
  clientName,
  projectTitle,
  quote,
  onClose,
}: {
  link: string;
  clientName: string;
  projectTitle: string;
  quote: ReturnType<typeof computeRazorpayQuote>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <CheckCircle2Icon className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold">Paywall link ready</h3>
        <p className="text-sm text-muted-foreground">
          {projectTitle} · {clientName} · client pays {money(quote.totalClientDue)}
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <code className="flex-1 truncate text-sm">{link}</code>
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Send this link to your client. They will be charged {money(quote.totalClientDue)} via
        Razorpay; you receive {money(quote.netPayout)} on payment confirmation.
      </div>

      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

export default CreatePaywalledDeliverableDialog;

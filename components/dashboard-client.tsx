"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { DashboardInvoiceRow } from "@/app/dashboard/page";
import { createComment, parseInvoiceWorkflowMetadata, serializeWorkflowMetadata, type DeliverableType } from "@/lib/invoice-workflow";
import {
  WalletIcon,
  UsersIcon,
  ClockIcon,
  UploadCloudIcon,
  FileTextIcon,
  ImageIcon,
  CheckCircle2Icon,
  CopyIcon,
  Loader2Icon,
  XIcon,
  Trash2Icon,
  PlusIcon,
  ReceiptIcon,
  SearchInsightsIcon,
  ChevronDownIcon,
  MousePointerClickIcon,
} from "@/components/icons";

type PlanType = "FREE" | "PRO";

const DEFAULT_FREE_FEE_PERCENT = 10;
const STRIPE_FEE_PERCENT = 2.9;
const STRIPE_FEE_FIXED_CENTS = 30;
const MAX_DELIVERABLE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
const ACCEPTED_DELIVERABLE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "application/zip",
  "application/x-zip-compressed",
]);

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function getFeePreview(amount: number, tier: PlanType, customPlatformFeePercent: number | null) {
  const normalizedPercent =
    customPlatformFeePercent != null
      ? Math.max(0, Math.min(100, Number(customPlatformFeePercent)))
      : tier === "PRO"
        ? 0
        : DEFAULT_FREE_FEE_PERCENT;

  const baseAmountCents = Math.round(amount * 100);
  const platformFeeCents = Math.round((baseAmountCents * normalizedPercent) / 100);
  const stripeFeeCents =
    Math.round(baseAmountCents * (STRIPE_FEE_PERCENT / 100)) + STRIPE_FEE_FIXED_CENTS;
  const totalClientAmountCents = baseAmountCents + platformFeeCents + stripeFeeCents;

  return {
    platformFeeCents,
    stripeFeeCents,
    totalClientAmountCents,
    platformFeeDollars: platformFeeCents / 100,
    stripeFeeDollars: stripeFeeCents / 100,
    totalClientDollars: totalClientAmountCents / 100,
    effectiveFeePercent: normalizedPercent,
  };
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback for older browsers without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * The fully interactive body of the freelancer dashboard.
 *
 * Receives server-fetched seed data (`initialInvoices`, `planType`,
 * `freelancerId`) and then owns all optimistic client interactions:
 *  - rendering the 3 metric cards (totaled live from the invoice list)
 *  - the drag-and-drop dropzone + invoice creation form
 *  - uploading the deliverable to the private `deliverables` bucket under
 *    `freelancer_id/invoice_uuid_filename.ext`
 *  - inserting the row into `invoices` (with platform_fee per plan_type)
 *  - surfacing a premium success banner with a copyable client payment link
 *  - the "Recent Invoices" list with status badges
 */
export function DashboardClient({
  freelancerId,
  planType,
  customPlatformFeePercent,
  initialInvoices,
}: {
  freelancerId: string;
  planType: PlanType;
  customPlatformFeePercent?: number | null;
  initialInvoices: DashboardInvoiceRow[];
}) {
  const supabase = createClient();

  const [invoices, setInvoices] = useState<DashboardInvoiceRow[]>(initialInvoices);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLink, setSuccessLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<DeliverableType>("DRAFT_PREVIEW");
  const [workflowComment, setWorkflowComment] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(initialInvoices[0]?.id ?? null);
  const [finalVaultFiles, setFinalVaultFiles] = useState<File[]>([]);
  const [finalizingVault, setFinalizingVault] = useState(false);
  const [finalVaultError, setFinalVaultError] = useState<string | null>(null);
  const [finalVaultSuccess, setFinalVaultSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    amount: "",
  });

  // Manual GEO tracking inputs — part of the Phase 1 upgrade.
  const [geo, setGeo] = useState({
    targetKeywords: "",
    aiEngines: {
      chatgpt: false,
      perplexity: false,
      gemini: false,
      claude: false,
    },
    shareOfVoice: 0,
    citationSnippet: "",
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFree = planType === "FREE";

  // Metrics — computed live from the in-memory invoice list so a freshly
  // created invoice updates the cards instantly.
  const metrics = useMemo(() => {
    let collected = 0;
    let pendingVolume = 0;
    const clientSet = new Set<string>();

    for (const inv of invoices) {
      if (inv.status === "PAID") collected += Number(inv.total_charged);
      else pendingVolume += Number(inv.total_charged);
      clientSet.add(inv.client_name.trim().toLowerCase());
    }

    return {
      totalCollected: collected,
      pendingVolume,
      activeClients: clientSet.size,
    };
  }, [invoices]);

  /**
   * Step 1: preview the file selection (validation only — the real upload
   * happens on submit so we can use the freshly minted invoice UUID in the
   * storage path).
   */
  const onSelectFiles = useCallback((selected: FileList | File[] | null) => {
    const picked = Array.from(selected ?? []);
    if (picked.length === 0) return;

    const invalid = picked.find((file) => {
      const isAllowedType = ACCEPTED_DELIVERABLE_TYPES.has(file.type);
      const isAllowedExtension = /\.(pdf|png|jpe?g|webp|gif|mp4|mov|zip)$/i.test(file.name);
      return !isAllowedType && !isAllowedExtension;
    });

    if (invalid) {
      setError("Only PDF, image, video, or ZIP files are allowed.");
      return;
    }

    const oversized = picked.find((file) => file.size > MAX_DELIVERABLE_SIZE_BYTES);
    if (oversized) {
      setError("One or more files exceed the 5 GB upload limit.");
      return;
    }

    setError(null);
    setFiles(picked);
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    onSelectFiles(e.dataTransfer.files);
  };

  const onSelectFinalVaultFiles = useCallback((selected: FileList | File[] | null) => {
    const picked = Array.from(selected ?? []);
    if (picked.length === 0) return;

    const invalid = picked.find((file) => {
      const isAllowedType = ACCEPTED_DELIVERABLE_TYPES.has(file.type);
      const isAllowedExtension = /\.(pdf|png|jpe?g|webp|gif|mp4|mov|zip)$/i.test(file.name);
      return !isAllowedType && !isAllowedExtension;
    });

    if (invalid) {
      setFinalVaultError("Only PDF, image, video, or ZIP files are allowed.");
      return;
    }

    const oversized = picked.find((file) => file.size > MAX_DELIVERABLE_SIZE_BYTES);
    if (oversized) {
      setFinalVaultError("One or more files exceed the 5 GB upload limit.");
      return;
    }

    setFinalVaultError(null);
    setFinalVaultFiles(picked);
  }, []);

  /**
   * The full submit flow:
   * 1. Validate.  2. Mint a v4 UUID (via crypto.randomUUID).
   * 3. Upload to `deliverables/{freelancer_id}/{uuid}_{filename.ext}`.
   * 4. Insert invoices row.  5. Optimistically prepend it + show success link.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;

    setError(null);
    setCopied(false);
    setSuccessLink(null);

    const clientName = form.clientName.trim();
    const clientEmail = form.clientEmail.trim();
    const amount = parseFloat(form.amount);

    if (!clientName) return setError("Please enter the client's name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail))
      return setError("Please enter a valid client email address.");
    if (!Number.isFinite(amount) || amount <= 0)
      return setError("Base retainer amount must be greater than $0.");
    if (files.length === 0) return setError("Please attach at least one deliverable file.");

    setPending(true);

    const invoiceId = generateUuid();
    const workflowMeta = parseInvoiceWorkflowMetadata(null);

    const preview = getFeePreview(amount, planType, customPlatformFeePercent ?? null);
    const platformFee = preview.platformFeeDollars;
    const totalCharged = preview.totalClientDollars;
    const uploadedPaths: string[] = [];
    const attachments: Array<{
      id: string;
      name: string;
      path: string;
      size: number;
      type: string;
      uploadedAt: string;
    }> = [];

    try {
      for (const fileToUpload of files) {
        const attachmentId = generateUuid();
        const ext = fileToUpload.name.includes(".")
          ? fileToUpload.name.slice(fileToUpload.name.lastIndexOf(".") + 1).toLowerCase()
          : "bin";
        const fileExt = sanitizeFileName(ext) || "bin";
        const baseName = sanitizeFileName(fileToUpload.name.replace(/\.[^.]+$/, "") || "deliverable");
        const storagePath = `invoices/${invoiceId}/deliverables/${attachmentId}-${baseName}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("deliverables")
          .upload(storagePath, fileToUpload, {
            cacheControl: "3600",
            upsert: false,
            contentType: fileToUpload.type || "application/octet-stream",
          });

        if (uploadError) {
          if (uploadError.message.includes("already") || uploadError.name === "EntityAlreadyExists") {
            throw new Error("One of the deliverables already exists. Rename and retry.");
          }
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploadedPaths.push(storagePath);
        attachments.push({
          id: attachmentId,
          name: fileToUpload.name,
          path: storagePath,
          size: fileToUpload.size,
          type: fileToUpload.type || "application/octet-stream",
          uploadedAt: new Date().toISOString(),
          deliverableType: workflowMode,
        });
      }

      if (workflowComment.trim()) {
        workflowMeta.comments = [
          ...(workflowMeta.comments ?? []),
          createComment(invoiceId, "FREELANCER", workflowComment.trim()),
        ];
      }

      if (workflowMode === "DRAFT_PREVIEW") {
        workflowMeta.drafts = attachments;
        workflowMeta.workflowState = "DRAFT_REVIEW";
      } else {
        workflowMeta.finals = attachments;
        workflowMeta.workflowState = "FINAL_VAULT_READY";
        workflowMeta.draftApproved = true;
      }

      // Insert the invoice row. Includes the manual GEO tracking payload
      // so it flows into the new server-side invoice pipeline.
      const aiEnginesList = (Object.keys(geo.aiEngines) as (keyof typeof geo.aiEngines)[])
        .filter((k) => geo.aiEngines[k]);

      const row = {
        id: invoiceId,
        freelancer_id: freelancerId,
        client_name: clientName,
        client_email: clientEmail,
        amount,
        platform_fee: platformFee,
        total_charged: totalCharged,
        file_path: serializeWorkflowMetadata(workflowMeta),
        status: "PENDING" as const,
        target_keywords: geo.targetKeywords.trim(),
        ai_engines: aiEnginesList,
        share_of_voice: geo.shareOfVoice,
        citation_snippet: geo.citationSnippet.trim(),
      };

      const { error: insertError, data: inserted } = await supabase
        .from("invoices")
        .insert(row)
        .select(
          "id, client_name, client_email, amount, platform_fee, total_charged, status, created_at, file_path",
        )
        .single();

      if (insertError || !inserted) {
        // Roll back any uploaded objects so we don't leave orphan files.
        if (uploadedPaths.length > 0) {
          await supabase.storage.from("deliverables").remove(uploadedPaths);
        }
        throw new Error(
          insertError?.message ?? "Failed to create the invoice row.",
        );
      }

      // Optimistically prepend to the live list + reveal the success link.
      setInvoices((prev) => [inserted as DashboardInvoiceRow, ...prev]);
      const shareUrl = `${window.location.origin}/share/${inserted.id}`;
      setSuccessLink(shareUrl);

      // Reset form + dropzone + GEO inputs.
      setForm({ clientName: "", clientEmail: "", amount: "" });
      setGeo({
        targetKeywords: "",
        aiEngines: {
          chatgpt: false,
          perplexity: false,
          gemini: false,
          claude: false,
        },
        shareOfVoice: 0,
        citationSnippet: "",
      });
      setFiles([]);
      setWorkflowComment("");
      setWorkflowMode("DRAFT_PREVIEW");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please retry.";
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const copyLink = async () => {
    if (!successLink) return;
    try {
      await navigator.clipboard.writeText(successLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback select-all trick for older browsers.
      if (inputRef.current) {
        inputRef.current.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    }
  };

  const removeSelectedFiles = () => {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinalizeApprovedDraft = async () => {
    if (!selectedInvoiceId) {
      setFinalVaultError("Select an invoice to finalize.");
      return;
    }

    if (finalVaultFiles.length === 0) {
      setFinalVaultError("Choose at least one final vault file.");
      return;
    }

    setFinalizingVault(true);
    setFinalVaultError(null);
    setFinalVaultSuccess(null);

    try {
      const { data: invoiceRow, error: invoiceError } = await supabase
        .from("invoices")
        .select("id, file_path")
        .eq("id", selectedInvoiceId)
        .maybeSingle();

      if (invoiceError || !invoiceRow) {
        throw new Error("The selected invoice could not be found.");
      }

      const workflowMeta = parseInvoiceWorkflowMetadata(invoiceRow.file_path as string | null | undefined);
      const uploadedPaths: string[] = [];
      const finalAttachments: Array<{
        id: string;
        name: string;
        path: string;
        size: number;
        type: string;
        uploadedAt: string;
        deliverableType: "FINAL_VAULT";
      }> = [];

      for (const fileToUpload of finalVaultFiles) {
        const attachmentId = generateUuid();
        const ext = fileToUpload.name.includes(".")
          ? fileToUpload.name.slice(fileToUpload.name.lastIndexOf(".") + 1).toLowerCase()
          : "bin";
        const fileExt = sanitizeFileName(ext) || "bin";
        const baseName = sanitizeFileName(fileToUpload.name.replace(/\.[^.]+$/, "") || "deliverable");
        const storagePath = `invoices/${selectedInvoiceId}/deliverables/${attachmentId}-${baseName}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("deliverables")
          .upload(storagePath, fileToUpload, {
            cacheControl: "3600",
            upsert: false,
            contentType: fileToUpload.type || "application/octet-stream",
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploadedPaths.push(storagePath);
        finalAttachments.push({
          id: attachmentId,
          name: fileToUpload.name,
          path: storagePath,
          size: fileToUpload.size,
          type: fileToUpload.type || "application/octet-stream",
          uploadedAt: new Date().toISOString(),
          deliverableType: "FINAL_VAULT",
        });
      }

      workflowMeta.finals = finalAttachments;
      workflowMeta.workflowState = "FINAL_VAULT_READY";
      workflowMeta.draftApproved = true;
      workflowMeta.lastUpdatedAt = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("invoices")
        .update({ file_path: serializeWorkflowMetadata(workflowMeta) })
        .eq("id", selectedInvoiceId);

      if (updateError) {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from("deliverables").remove(uploadedPaths);
        }
        throw new Error(updateError.message ?? "Failed to update the invoice.");
      }

      setInvoices((prev) => prev.map((invoice) => (invoice.id === selectedInvoiceId ? { ...invoice, file_path: serializeWorkflowMetadata(workflowMeta) } : invoice)));
      setFinalVaultFiles([]);
      setFinalVaultSuccess("Final vault files are now ready for the client to unlock after payment.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setFinalVaultError(message);
    } finally {
      setFinalizingVault(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Heading */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Create locked invoices, deliver performance reports, and track every
          client payment in one elegant workspace.
        </p>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Collected"
          value={currency(metrics.totalCollected)}
          sublabel="Sum of paid invoices"
          icon={<WalletIcon className="h-5 w-5" />}
          tone="indigo"
        />
        <MetricCard
          label="Active Clients"
          value={metrics.activeClients.toLocaleString()}
          sublabel="Unique client names"
          icon={<UsersIcon className="h-5 w-5" />}
          tone="emerald"
        />
        <MetricCard
          label="Pending Volume"
          value={currency(metrics.pendingVolume)}
          sublabel="Sum of pending invoices"
          icon={<ClockIcon className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {/* Success Banner */}
      {successLink && (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-emerald-500 text-white shadow-sm">
              <CheckCircle2Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                Invoice created — share this link with your client
              </p>
              <p className="mt-0.5 text-xs text-emerald-700/90 dark:text-emerald-200/80">
                Your client will review the locked deliverable and pay securely.
              </p>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2 sm:flex-none">
            <input
              ref={inputRef}
              readOnly
              value={successLink}
              onClick={(e) => e.currentTarget.select()}
              className="h-10 w-full min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 font-mono text-xs text-emerald-900 shadow-inner sm:w-80 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-100"
            />
            <Button
              type="button"
              onClick={copyLink}
              className="bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              {copied ? (
                <>
                  <CheckCircle2Icon className="h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <CopyIcon className="h-4 w-4" />
                  Copy
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={() => setSuccessLink(null)}
              aria-label="Dismiss"
              className="grid h-10 w-10 flex-none place-items-center rounded-lg text-emerald-700 transition-colors hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="text-sm font-medium text-rose-800 dark:text-rose-200">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="grid h-7 w-7 flex-none place-items-center rounded-md text-rose-700 transition-colors hover:bg-rose-100 dark:text-rose-200 dark:hover:bg-rose-500/20"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Grid: Form (left) + Recent Invoices (right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* LEFT — Create Premium Locked Invoice */}
        <section className="lg:col-span-3">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                  <ReceiptIcon className="h-4 w-4" />
                </span>
                Create secure invoice
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {isFree
                  ? "Free tier — 10% platform fee plus Stripe processing, shown clearly to clients."
                  : "Pro tier — 0% platform fee and only Stripe processing is passed through."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="client_name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Client Name
                  </Label>
                  <Input
                    id="client_name"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. Acme Studios"
                    value={form.clientName}
                    onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                    disabled={pending}
                    className="h-10"
                  />
                </Field>
                <Field>
                  <Label htmlFor="client_email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Client Email
                  </Label>
                  <Input
                    id="client_email"
                    type="email"
                    autoComplete="off"
                    placeholder="billing@acme.com"
                    value={form.clientEmail}
                    onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
                    disabled={pending}
                    className="h-10"
                  />
                </Field>
              </div>

              <Field>
                <Label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Base Retainer Amount ($)
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                    $
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="1500.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    disabled={pending}
                    className="h-10 pl-7"
                  />
                </div>
                {Number.isFinite(parseFloat(form.amount)) &&
                  parseFloat(form.amount) > 0 && (() => {
                    const preview = getFeePreview(
                      parseFloat(form.amount),
                      planType,
                      customPlatformFeePercent ?? null,
                    );
                    return (
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                        ClientLockbox fee {currency(preview.platformFeeDollars)} · Stripe {currency(preview.stripeFeeDollars)} · Total due {currency(preview.totalClientDollars)}
                      </p>
                    );
                  })()}
              </Field>

              {/* GEO Tracking Sub-form */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                    <ReceiptIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      GEO Tracking Inputs
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Manual generative-engine optimization metrics for this invoice.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5">
                  {/* 1. Target Keywords */}
                  <Field>
                    <Label
                      htmlFor="geo_keywords"
                      className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      Target Keywords
                    </Label>
                    <Input
                      id="geo_keywords"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. saas billing, freelance invoicing, client portal"
                      value={geo.targetKeywords}
                      onChange={(e) =>
                        setGeo({ ...geo, targetKeywords: e.target.value })
                      }
                      disabled={pending}
                      className="h-10"
                    />
                  </Field>

                  {/* 2. AI Engine Toggles */}
                  <Field>
                    <Label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                      AI Engine Toggles
                    </Label>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(
                        [
                          ["chatgpt", "CHATGPT"],
                          ["perplexity", "PERPLEXITY"],
                          ["gemini", "GEMINI"],
                          ["claude", "CLAUDE"],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                            geo.aiEngines[key]
                              ? "border-indigo-300 bg-indigo-100/70 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
                              : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
                          )}
                        >
                          <Checkbox
                            checked={geo.aiEngines[key]}
                            onCheckedChange={(checked) =>
                              setGeo({
                                ...geo,
                                aiEngines: {
                                  ...geo.aiEngines,
                                  [key]: checked === true,
                                },
                              })
                            }
                            disabled={pending}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </Field>

                  {/* 3. Share of Voice Gauge */}
                  <Field>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Label
                        htmlFor="geo_sov"
                        className="block text-sm font-medium text-slate-700 dark:text-slate-200"
                      >
                        Share of Voice
                      </Label>
                      <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                        {geo.shareOfVoice}%
                      </span>
                    </div>
                    <input
                      id="geo_sov"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={geo.shareOfVoice}
                      onChange={(e) =>
                        setGeo({
                          ...geo,
                          shareOfVoice: parseInt(e.target.value, 10),
                        })
                      }
                      disabled={pending}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600 dark:bg-slate-700"
                    />
                    <div className="mt-1 flex justify-between text-xs text-slate-400 dark:text-slate-500">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </Field>

                  {/* 4. Citation Snippet */}
                  <Field>
                    <Label
                      htmlFor="geo_citation"
                      className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      Citation Snippet
                    </Label>
                    <textarea
                      id="geo_citation"
                      rows={4}
                      placeholder="Paste the exact citation text surfaced by the AI engine..."
                      value={geo.citationSnippet}
                      onChange={(e) =>
                        setGeo({ ...geo, citationSnippet: e.target.value })
                      }
                      disabled={pending}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </Field>
                </div>
              </div>

              <Field>
                <Label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Workflow mode
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ["DRAFT_PREVIEW", "Draft preview"],
                    ["FINAL_VAULT", "Final vault"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setWorkflowMode(value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        workflowMode === value
                          ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300"
                          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                  {workflowMode === "DRAFT_PREVIEW"
                    ? "Draft previews are viewable and can be commented on before the client approves the work."
                    : "Final vault files remain locked until the client pays for the invoice."}
                </p>
              </Field>

              <Field>
                <Label htmlFor="workflow_comment" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Optional review note for the client
                </Label>
                <textarea
                  id="workflow_comment"
                  rows={3}
                  placeholder="Share a note about the draft or a request for feedback..."
                  value={workflowComment}
                  onChange={(e) => setWorkflowComment(e.target.value)}
                  disabled={pending}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </Field>

              <Field>
                <Label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Finalize approved draft
                </Label>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <Label htmlFor="finalize_invoice" className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                        Invoice
                      </Label>
                      <select
                        id="finalize_invoice"
                        value={selectedInvoiceId ?? ""}
                        onChange={(e) => setSelectedInvoiceId(e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {invoices.map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoice.client_name} · {invoice.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="final_vault_files" className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                        Final vault files
                      </Label>
                      <input
                        id="final_vault_files"
                        type="file"
                        multiple
                        onChange={(e) => onSelectFinalVaultFiles(e.target.files)}
                        className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-700 dark:text-slate-400"
                      />
                    </div>
                  </div>
                  {finalVaultError ? (
                    <p className="mt-3 text-sm text-rose-600">{finalVaultError}</p>
                  ) : null}
                  {finalVaultSuccess ? (
                    <p className="mt-3 text-sm text-emerald-600">{finalVaultSuccess}</p>
                  ) : null}
                  <Button type="button" onClick={handleFinalizeApprovedDraft} disabled={finalizingVault || !selectedInvoiceId || finalVaultFiles.length === 0} className="mt-4 h-10">
                    {finalizingVault ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                    Upload final vault
                  </Button>
                </div>
              </Field>

              {/* Dropzone */}
              <Field>
                <Label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Deliverables (PDF / Image / Video / ZIP)
                </Label>

                {files.length === 0 ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={cn(
                      "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                      dragging
                        ? "border-indigo-500 bg-indigo-50/70 dark:bg-indigo-500/10"
                        : "border-slate-300 bg-slate-50/60 hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/5",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-12 w-12 place-items-center rounded-full border transition-colors",
                        dragging
                          ? "border-indigo-400 bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20"
                          : "border-slate-200 bg-white text-slate-400 group-hover:border-indigo-200 group-hover:text-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:group-hover:border-indigo-500/40",
                      )}
                    >
                      <UploadCloudIcon className="h-6 w-6" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Drop one or more files here, or{" "}
                        <span className="text-indigo-600 dark:text-indigo-400">
                          browse
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                        PDF, image, video, or ZIP · up to 5 GB each
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,application/zip,application/x-zip-compressed"
                      multiple
                      onChange={(e) => onSelectFiles(e.target.files)}
                    />
                  </div>
                ) : (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {files.length} file{files.length > 1 ? "s" : ""} selected
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Stored privately under your invoice folder and unlocked after payment.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeSelectedFiles}
                        aria-label="Remove files"
                        className="grid h-8 w-8 flex-none place-items-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    </div>
                    <ul className="space-y-2">
                      {files.map((file) => (
                        <li key={`${file.name}-${file.size}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/80 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
                          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                            <FilePreviewIcon type={file.type} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                              {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "file"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Field>

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  By creating this invoice, your client receives a secure,
                  unguessable payment link.
                </p>
                <Button
                  type="submit"
                  disabled={pending}
                  className="h-11 w-full bg-indigo-600 px-6 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition-colors hover:bg-indigo-700 disabled:opacity-70 sm:w-auto"
                >
                  {pending ? (
                    <>
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Creating invoice…
                    </>
                  ) : (
                    <>
                      <PlusIcon className="h-4 w-4" />
                      Create Locked Invoice
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </section>

        {/* RIGHT — Recent Invoices */}
        <section className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                Recent Invoices
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {invoices.length} total
              </span>
            </div>

            {pending && invoices.length === 0 ? (
              <SkeletonList />
            ) : invoices.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-col gap-1.5 px-6 py-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {inv.client_name}
                      </p>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>{formatDate(inv.created_at)}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {currency(Number(inv.total_charged))}
                      </span>
                    </div>
                    <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                      {inv.client_email}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Sub-components                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function Field({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

const TONE_CLASSES: Record<string, string> = {
  indigo:
    "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400",
  emerald:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
};

function MetricCard({
  label,
  value,
  sublabel,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ReactNode;
  tone: "indigo" | "emerald" | "amber";
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {label}
          </p>
          <p className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            {value}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {sublabel}
          </p>
        </div>
        <span
          className={cn(
            "grid h-11 w-11 flex-none place-items-center rounded-xl",
            TONE_CLASSES[tone],
          )}
        >
          {icon}
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "PAID" | "PENDING" }) {
  return status === "PAID" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      PAID
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      PENDING
    </span>
  );
}

function FilePreviewIcon({ type }: { type: string }) {
  if (type.startsWith("image/")) return <ImageIcon className="h-5 w-5" />;
  return <FileTextIcon className="h-5 w-5" />;
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex animate-pulse flex-col gap-2 px-6 py-4">
          <div className="flex justify-between">
            <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-5 w-14 rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>
          <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800/60" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <ReceiptIcon className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        No invoices yet
      </p>
      <p className="max-w-xs text-xs text-slate-400 dark:text-slate-500">
        Create your first locked invoice to the left — it’ll appear here
        instantly.
      </p>
    </div>
  );
}

/** Lowercases + dashes the freelancer id for a clean storage folder name. */
function freelancer_id_path(id: string): string {
  return id;
}

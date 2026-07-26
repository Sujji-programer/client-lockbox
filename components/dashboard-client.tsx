"use client";

import { useState, useMemo } from "react";
import type { DashboardInvoiceRow } from "@/app/dashboard/page";
import {
  PlusIcon,
  WalletIcon,
  ClockIcon,
  UnlockIcon,
  CopyIcon,
  FileCodeIcon,
  Trash2Icon,
  EyeIcon,
  ShieldCheckIcon,
  BanknoteIcon,
  BadgeCheckIcon,
  TrendingUpIcon,
  VideoIcon,
  IndianRupeeIcon,
  Loader2Icon,
  CheckCircle2Icon,
  PlayCircleIcon,
  FilmIcon,
  MailIcon,
  ArrowRightIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type PlanType = "FREE" | "PRO";

const MOCK_ANALYTICS: Record<string, { watched: string; total: string }> = {
  "1": { watched: "3:42", total: "5:00" },
  "2": { watched: "1:15", total: "2:30" },
  "3": { watched: "4:58", total: "5:00" },
};

function currency(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Seed demo rows so the table is never empty
// ---------------------------------------------------------------------------

const DEMO_INVOICES: DashboardInvoiceRow[] = [
  {
    id: "demo-1",
    client_name: "Arjun Mehta",
    client_email: "arjun@brandstudio.in",
    amount: 85000,
    platform_fee: 0,
    total_charged: 85000,
    status: "PAID",
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    file_path: "",
  },
  {
    id: "demo-2",
    client_name: "Priya Desai",
    client_email: "priya@motionhaus.co",
    amount: 42000,
    platform_fee: 4200,
    total_charged: 46200,
    status: "PENDING",
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    file_path: "",
  },
  {
    id: "demo-3",
    client_name: "Ravi Krishnan",
    client_email: "ravi@agencycraft.com",
    amount: 120000,
    platform_fee: 0,
    total_charged: 120000,
    status: "PAID",
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    file_path: "",
  },
  {
    id: "demo-4",
    client_name: "Simran Kaur",
    client_email: "simran@filmframe.in",
    amount: 65000,
    platform_fee: 6500,
    total_charged: 71500,
    status: "PENDING",
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    file_path: "",
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  sublabel,
  icon,
  accentColor,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ReactNode;
  accentColor: string;
}) {
  return (
    <div
      className="relative flex flex-col gap-3 overflow-hidden rounded-2xl p-5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Glow accent top-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-30"
        style={{ background: accentColor }}
      />
      <div
        className="grid h-10 w-10 place-items-center rounded-xl"
        style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}30` }}
      >
        <span style={{ color: accentColor }}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="mt-0.5 text-sm font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
          {label}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          {sublabel}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "PAID" | "PENDING" }) {
  if (status === "PAID") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          background: "rgba(34,197,94,0.12)",
          border: "1px solid rgba(34,197,94,0.25)",
          color: "#22C55E",
        }}
      >
        <CheckCircle2Icon className="h-3 w-3" />
        Paid
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        background: "rgba(249,115,22,0.12)",
        border: "1px solid rgba(249,115,22,0.25)",
        color: "#F97316",
      }}
    >
      <ClockIcon className="h-3 w-3" />
      Unpaid
    </span>
  );
}

function AnalyticsBubble({ invoiceId }: { invoiceId: string }) {
  const data = MOCK_ANALYTICS[invoiceId.slice(-1)] ?? { watched: "2:10", total: "5:00" };
  const [w, t] = [data.watched, data.total].map((s) => {
    const [m, sec] = s.split(":").map(Number);
    return m * 60 + sec;
  });
  const pct = Math.round((w / t) * 100);

  return (
    <div className="flex items-center gap-2">
      <PlayCircleIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "#00E5FF" }} />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-xs font-medium text-white">
          {data.watched} of {data.total}
        </span>
        <div className="h-1 w-20 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: "linear-gradient(90deg,#00E5FF,#7C3AED)" }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Deliverable Modal (inline drawer)
// ---------------------------------------------------------------------------

function CreateDeliverableForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ clientName: "", projectTitle: "", amount: "", clientEmail: "" });
  const [step, setStep] = useState<"form" | "success">("form");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("success");
  };

  if (step === "success") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span
          className="grid h-14 w-14 place-items-center rounded-full"
          style={{ background: "rgba(0,229,255,0.12)", border: "1px solid rgba(0,229,255,0.25)" }}
        >
          <CheckCircle2Icon className="h-7 w-7" style={{ color: "#00E5FF" }} />
        </span>
        <div>
          <p className="text-lg font-bold text-white">Deliverable Created!</p>
          <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
            Your paywalled invoice link is ready to share.
          </p>
        </div>
        <div
          className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3"
          style={{ background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.15)" }}
        >
          <span className="truncate text-xs font-mono text-white/60">
            https://citeflow.app/share/inv_{Date.now().toString(36)}
          </span>
          <CopyIcon className="h-4 w-4 shrink-0" style={{ color: "#00E5FF" }} />
        </div>
        <button
          onClick={onClose}
          className="mt-2 text-sm font-semibold text-white/50 underline underline-offset-4 hover:text-white/80 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {[
        { id: "clientName", label: "Client Name", placeholder: "Arjun Mehta", type: "text" },
        { id: "clientEmail", label: "Client Email", placeholder: "arjun@studio.in", type: "email" },
        { id: "projectTitle", label: "Project Title", placeholder: "Brand Reel — Q3 Campaign", type: "text" },
        { id: "amount", label: "Base Amount (₹)", placeholder: "85000", type: "number" },
      ].map(({ id, label, placeholder, type }) => (
        <div key={id} className="flex flex-col gap-1.5">
          <label htmlFor={`cf-${id}`} className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
            {label}
          </label>
          <input
            id={`cf-${id}`}
            type={type}
            required
            placeholder={placeholder}
            value={form[id as keyof typeof form]}
            onChange={(e) => setForm((p) => ({ ...p, [id]: e.target.value }))}
            className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition-all"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,229,255,0.4)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
          />
        </div>
      ))}

      {/* Deliverable type */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Deliverable Type</p>
        <div className="grid grid-cols-2 gap-2">
          {["Watermarked Preview", "4K Final Vault"].map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition-all"
              style={{
                background: "rgba(0,229,255,0.06)",
                border: "1px solid rgba(0,229,255,0.18)",
                color: "#00E5FF",
              }}
            >
              <input type="radio" name="delivType" value={opt} defaultChecked={opt === "Watermarked Preview"} className="sr-only" />
              {opt === "Watermarked Preview" ? <VideoIcon className="h-3.5 w-3.5" /> : <UnlockIcon className="h-3.5 w-3.5" />}
              {opt}
            </label>
          ))}
        </div>
      </div>

      <button
        type="submit"
        className="mt-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-[#090D16] transition-all hover:-translate-y-px"
        style={{
          background: "linear-gradient(135deg,#00E5FF 0%,#0099AA 100%)",
          boxShadow: "0 4px 20px rgba(0,229,255,0.25)",
        }}
      >
        <FilmIcon className="h-4 w-4" />
        Create Paywalled Deliverable
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Client
// ---------------------------------------------------------------------------

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
  void freelancerId;
  void customPlatformFeePercent;

  const invoices = useMemo(() => {
    const merged = [...initialInvoices, ...DEMO_INVOICES];
    // Deduplicate by id
    const seen = new Set<string>();
    return merged.filter((inv) => {
      if (seen.has(inv.id)) return false;
      seen.add(inv.id);
      return true;
    });
  }, [initialInvoices]);

  const metrics = useMemo(() => {
    let totalEarnings = 0;
    let activePaywalled = 0;
    let pendingUnlocks = 0;
    for (const inv of invoices) {
      if (inv.status === "PAID") totalEarnings += Number(inv.total_charged);
      else {
        activePaywalled++;
        pendingUnlocks++;
      }
    }
    return { totalEarnings, activePaywalled, pendingUnlocks };
  }, [invoices]);

  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const visibleInvoices = invoices.filter((inv) => !deletedIds.has(inv.id));

  const copyLink = (id: string) => {
    const url = `https://citeflow.app/share/${id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteInvoice = (id: string) => {
    setDeletedIds((prev) => new Set([...prev, id]));
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "#090D16" }}
    >
      {/* Subtle grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,229,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.8) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative mx-auto w-full max-w-7xl px-5 pb-16 pt-8 sm:px-8">

        {/* Page header */}
        <div className="mb-8 flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Editor Dashboard
          </h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
            Manage paywalled deliverables, track client payments, and export revision markers.
          </p>
        </div>

        {/* Metrics */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            label="Total Earnings"
            value={currency(metrics.totalEarnings)}
            sublabel="Sum of all paid invoices"
            icon={<IndianRupeeIcon className="h-5 w-5" />}
            accentColor="#00E5FF"
          />
          <MetricCard
            label="Active Paywalled Invoices"
            value={metrics.activePaywalled.toString()}
            sublabel="Awaiting client payment"
            icon={<WalletIcon className="h-5 w-5" />}
            accentColor="#A855F7"
          />
          <MetricCard
            label="Pending Deliverable Unlocks"
            value={metrics.pendingUnlocks.toString()}
            sublabel="4K files awaiting payment"
            icon={<UnlockIcon className="h-5 w-5" />}
            accentColor="#F97316"
          />
        </div>

        {/* Primary CTA */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="group flex items-center gap-2.5 rounded-xl px-6 py-3.5 text-sm font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-2xl"
            style={{
              background: "linear-gradient(135deg,#00E5FF 0%,#0099AA 100%)",
              color: "#090D16",
              boxShadow: "0 4px 24px rgba(0,229,255,0.3)",
            }}
          >
            <PlusIcon className="h-5 w-5" />
            Create Paywalled Deliverable
          </button>
        </div>

        {/* Create form slide-in */}
        {showCreate && (
          <div className="mb-8">
            <div
              className="rounded-2xl p-6"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(0,229,255,0.15)",
                boxShadow: "0 0 40px rgba(0,229,255,0.06)",
              }}
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-bold text-white">New Paywalled Deliverable</h2>
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg p-1 text-white/40 transition-colors hover:text-white/80"
                >
                  &#x2715;
                </button>
              </div>
              <CreateDeliverableForm onClose={() => setShowCreate(false)} />
            </div>
          </div>
        )}

        {/* Invoices Table */}
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          {/* Table header */}
          <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <h2 className="text-sm font-semibold text-white">Invoices</h2>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: "rgba(0,229,255,0.1)", color: "#00E5FF" }}
            >
              {visibleInvoices.length} total
            </span>
          </div>

          {/* Scrollable table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {["Client", "Project Title", "Amount", "Date", "Status", "View Analytics", "Actions"].map((col) => (
                    <th
                      key={col}
                      className={cn(
                        "py-3 px-4 text-left text-xs font-semibold",
                        col === "Actions" ? "text-right" : "",
                      )}
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((inv, i) => {
                  const projectTitle = inv.client_email.split("@")[0]
                    .split(".")
                    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                    .join(" ") + " Reel";

                  return (
                    <tr
                      key={inv.id}
                      className="transition-colors"
                      style={{
                        borderBottom: i < visibleInvoices.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "rgba(255,255,255,0.02)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                    >
                      {/* Client */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                            style={{ background: "linear-gradient(135deg,#00E5FF20,#7C3AED30)", border: "1px solid rgba(255,255,255,0.1)" }}
                          >
                            {inv.client_name.charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">{inv.client_name}</p>
                            <p className="truncate text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{inv.client_email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Project Title */}
                      <td className="px-4 py-4">
                        <span className="text-xs text-white/70">{projectTitle}</span>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-4">
                        <span className="text-sm font-semibold text-white">
                          {currency(Number(inv.total_charged))}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-4">
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                          {formatDate(inv.created_at)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <StatusBadge status={inv.status} />
                      </td>

                      {/* Analytics */}
                      <td className="px-4 py-4">
                        <AnalyticsBubble invoiceId={inv.id} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Copy link */}
                          <button
                            type="button"
                            title="Copy Delivery Link"
                            onClick={() => copyLink(inv.id)}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
                            style={{
                              background: copiedId === inv.id ? "rgba(34,197,94,0.12)" : "rgba(0,229,255,0.08)",
                              border: `1px solid ${copiedId === inv.id ? "rgba(34,197,94,0.2)" : "rgba(0,229,255,0.15)"}`,
                              color: copiedId === inv.id ? "#22C55E" : "#00E5FF",
                            }}
                          >
                            {copiedId === inv.id ? (
                              <CheckCircle2Icon className="h-3.5 w-3.5" />
                            ) : (
                              <CopyIcon className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden sm:inline">
                              {copiedId === inv.id ? "Copied" : "Link"}
                            </span>
                          </button>

                          {/* Export XML */}
                          <button
                            type="button"
                            title="Export Revisions .XML"
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
                            style={{
                              background: "rgba(168,85,247,0.08)",
                              border: "1px solid rgba(168,85,247,0.15)",
                              color: "#A855F7",
                            }}
                          >
                            <FileCodeIcon className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">.XML</span>
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            title="Delete Invoice"
                            onClick={() => deleteInvoice(inv.id)}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
                            style={{
                              background: "rgba(239,68,68,0.07)",
                              border: "1px solid rgba(239,68,68,0.12)",
                              color: "rgba(239,68,68,0.7)",
                            }}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {visibleInvoices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                      No invoices yet. Create your first paywalled deliverable above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trust footer badge */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <div
            className="inline-flex items-center gap-2.5 rounded-2xl px-5 py-3"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <BanknoteIcon className="h-5 w-5" style={{ color: "#06B6D4" }} />
            <span className="text-sm font-medium text-white">
              Funds Secured via{" "}
              <span className="font-bold" style={{ color: "#06B6D4" }}>Razorpay Escrow</span>
            </span>
            <span className="h-4 w-px" style={{ background: "rgba(255,255,255,0.1)" }} />
            <ShieldCheckIcon className="h-4 w-4" style={{ color: "#22C55E" }} />
            <span className="text-xs font-semibold" style={{ color: "#22C55E" }}>
              PCI DSS L1 Compliant
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

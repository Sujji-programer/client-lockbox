import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResend, getFromAddress } from "@/lib/email";
import { reminderEmail, overdueEmail } from "@/lib/email-templates";

/**
 * POST /api/cron/reminder-sweep
 *
 * Scheduled job that scans all PENDING invoices and sends:
 *
 *   1. **3-day reminder** — invoices with a due_date 3 days from today,
 *      where `reminders_sent` does NOT already contain today's date.
 *   2. **Overdue alert**  — invoices with a due_date in the past, where
 *      `reminders_sent` does NOT already contain today's date.
 *
 * Idempotency: each sent email appends today's date (YYYY-MM-DD) to the
 * integer-array column `reminders_sent`, so a retry or re-delivery by the
 * cron provider never double-sends.
 *
 * Auth: protected by `CRON_SECRET` header. Designed to be called by
 * Vercel Cron (see `vercel.json`), Supabase pg_cron (see setup guide),
 * or any HTTP cron provider.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim() === "") {
    if (process.env.NODE_ENV === "development") return true;
    return false;
  }
  return (request.headers.get("x-cron-secret") ?? "") === secret;
}

/** Today as an integer tag YYYYMMDD — used as the idempotency key in the `reminders_sent` int[] column. */
function todayTag(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return y * 10000 + m * 100 + d; // e.g. 20260719
}

export async function POST(request: Request) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const tag = todayTag();
  const todayISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ── 3-day reminder ─────────────────────────────────────────────────
  // due_date = today + 3 days, status = PENDING, tag not in reminders_sent.
  const threeDaysFromNow = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 3);
    return d.toISOString().slice(0, 10);
  })();

  let remindersSent = 0;
  let overdueSent = 0;

  const { data: remindInvoices, error: remindErr } = await admin
    .from("invoices")
    .select(
      "id, client_email, client_name, amount, currency, due_date, reminders_sent",
    )
    .eq("status", "PENDING")
    .eq("due_date", threeDaysFromNow)
    .limit(200);

  if (!remindErr && remindInvoices) {
    for (const inv of remindInvoices) {
      const sent: Array<string | number> = Array.isArray(inv.reminders_sent)
        ? (inv.reminders_sent as Array<string | number>)
        : [];
      if (sent.includes(tag)) continue; // already sent today

      await sendReminderEmail(inv, tag, admin);
      remindersSent++;
    }
  }

  // ── Overdue alerts ──────────────────────────────────────────────────
  const { data: overdueInvoices, error: overdueErr } = await admin
    .from("invoices")
    .select(
      "id, client_email, client_name, amount, currency, due_date, reminders_sent",
    )
    .eq("status", "PENDING")
    .lt("due_date", todayISO)
    .limit(200);

  if (!overdueErr && overdueInvoices) {
    for (const inv of overdueInvoices) {
      const sent: Array<string | number> = Array.isArray(inv.reminders_sent)
        ? (inv.reminders_sent as Array<string | number>)
        : [];
      if (sent.includes(tag)) continue;

      const dueDate = inv.due_date ?? "";
      const dueMs = new Date(dueDate + "T00:00:00Z").getTime();
      const todayMs = new Date(todayISO + "T00:00:00Z").getTime();
      const daysOverdue = Math.max(0, Math.round((todayMs - dueMs) / 86_400_000));

      await sendOverdueEmail(inv, tag, daysOverdue, admin);
      overdueSent++;
    }
  }

  return NextResponse.json({
    tag,
    remindersSent,
    overdueSent,
  });
}

// ── Send helpers ────────────────────────────────────────────────────────

type InvoiceRow = {
  id: string;
  client_email: string;
  client_name: string;
  amount: number | string;
  currency: string;
  due_date: string | null;
  reminders_sent: Array<string | number>;
};

async function sendReminderEmail(
  inv: InvoiceRow,
  tag: number,
  admin: ReturnType<typeof createAdminClient>,
) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://clientlockbox.com";

  try {
    const resend = getResend();
    const from = getFromAddress();
    const { subject, html } = reminderEmail(
      {
        clientEmail: inv.client_email,
        clientName: inv.client_name,
        amount: Number(inv.amount),
        currency: inv.currency ?? "usd",
        dueDate: inv.due_date ?? "",
        invoiceId: inv.id,
      },
      { appUrl },
    );

    await resend.emails.send({ from, to: [inv.client_email], subject, html });

    // Mark as sent (append today's tag to reminders_sent).
    const sent: Array<string | number> = Array.isArray(inv.reminders_sent)
      ? (inv.reminders_sent as Array<string | number>)
      : [];
    await admin
      .from("invoices")
      .update({ reminders_sent: [...sent, tag] })
      .eq("id", inv.id);
  } catch (err) {
    console.error(
      "[cron.reminder] failed for invoice",
      inv.id,
      err instanceof Error ? err.message : err,
    );
  }
}

async function sendOverdueEmail(
  inv: InvoiceRow,
  tag: number,
  daysOverdue: number,
  admin: ReturnType<typeof createAdminClient>,
) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://clientlockbox.com";

  try {
    const resend = getResend();
    const from = getFromAddress();
    const { subject, html } = overdueEmail(
      {
        clientEmail: inv.client_email,
        clientName: inv.client_name,
        amount: Number(inv.amount),
        currency: inv.currency ?? "usd",
        dueDate: inv.due_date ?? "",
        daysOverdue,
        invoiceId: inv.id,
      },
      { appUrl },
    );

    await resend.emails.send({ from, to: [inv.client_email], subject, html });

    const sent: Array<string | number> = Array.isArray(inv.reminders_sent)
      ? (inv.reminders_sent as Array<string | number>)
      : [];
    await admin
      .from("invoices")
      .update({ reminders_sent: [...sent, tag] })
      .eq("id", inv.id);
  } catch (err) {
    console.error(
      "[cron.overdue] failed for invoice",
      inv.id,
      err instanceof Error ? err.message : err,
    );
  }
}

import { money } from "@/lib/format";

/**
 * HTML email templates for transactional alerts.
 *
 * All templates are plain functions returning HTML strings — no external
 * templating engine. They share a common wrapper for brand consistency.
 */

type EmailContext = {
  /** The app's public URL, used to build the share link. */
  appUrl: string;
};

// ── Shared wrapper ──────────────────────────────────────────────────────

function shell(title: string, bodyHtml: string, ctx: EmailContext): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <!-- brand -->
          <tr>
            <td style="padding:0 0 24px 0;">
              <span style="display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#1e293b;">
                <span style="display:inline-grid;place-items:center;width:36px;height:36px;border-radius:12px;background:#6366f1;color:#fff;font-size:16px;font-weight:700;">C</span>
                Client<span style="color:#6366f1;">Lockbox</span>
              </span>
            </td>
          </tr>
          <!-- card -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
                <tr>
                  <td style="padding:32px 28px;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.18em;">
                ClientLockbox &middot; Secure Client Portal
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── 1. Invoice Created ──────────────────────────────────────────────────

export function invoiceCreatedEmail(
  params: {
    clientEmail: string;
    clientName: string;
    amount: number;
    currency: string;
    scopeOfWork: string;
    dueDate: string | null;
    invoiceId: string;
    freelancerName: string;
  },
  ctx: EmailContext,
): { subject: string; html: string } {
  const { clientName, amount, currency, scopeOfWork, dueDate, invoiceId, freelancerName } = params;
  const amountStr = money(amount, currency);
  const shareLink = `${ctx.appUrl}/share/${invoiceId}`;
  const dueLine = dueDate
    ? `<p style="margin:0 0 0 0;font-size:13px;color:#64748b;">Due: <strong style="color:#1e293b;">${dueDate}</strong></p>`
    : "";

  return {
    subject: `You have a new invoice for ${amountStr} from ${freelancerName}`,
    html: shell(
      "New Invoice",
      `
        <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#1e293b;">
          You have a new invoice
        </h1>
        <p style="margin:0 0 20px 0;font-size:15px;color:#475569;line-height:1.5;">
          <strong style="color:#1e293b;">${freelancerName}</strong> has sent you an invoice for
          <strong style="color:#6366f1;">${amountStr}</strong>.
          Review the scope of work below and pay securely online.
        </p>

        <!-- scope card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:20px;">
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#94a3b8;">
                Scope of work
              </p>
              <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.6;white-space:pre-line;">
                ${escapeHtml(scopeOfWork)}
              </p>
              ${dueLine}
            </td>
          </tr>
        </table>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr>
            <td align="center" style="padding:0;">
              <a href="${shareLink}" target="_blank" rel="noopener"
                 style="display:inline-block;width:100%;max-width:320px;padding:14px 24px;background:#6366f1;color:#ffffff;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:12px;">
                Review &amp; Pay Invoice
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
          Or copy this link: <a href="${shareLink}" style="color:#6366f1;">${shareLink}</a>
        </p>
      `,
      ctx,
    ),
  };
}

// ── 2. Payment Reminder (3 days before due) ─────────────────────────────

export function reminderEmail(
  params: {
    clientEmail: string;
    clientName: string;
    amount: number;
    currency: string;
    dueDate: string;
    invoiceId: string;
  },
  ctx: EmailContext,
): { subject: string; html: string } {
  const { clientName, amount, currency, dueDate, invoiceId } = params;
  const amountStr = money(amount, currency);
  const shareLink = `${ctx.appUrl}/share/${invoiceId}`;

  return {
    subject: `Reminder: Your invoice for ${amountStr} is due in 3 days`,
    html: shell(
      "Payment Reminder",
      `
        <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#1e293b;">
          Friendly reminder
        </h1>
        <p style="margin:0 0 20px 0;font-size:15px;color:#475569;line-height:1.5;">
          This is a quick note that your invoice for
          <strong style="color:#6366f1;">${amountStr}</strong>
          is due on <strong style="color:#1e293b;">${dueDate}</strong>.
          If you've already paid, please disregard this message.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr>
            <td align="center" style="padding:0;">
              <a href="${shareLink}" target="_blank" rel="noopener"
                 style="display:inline-block;width:100%;max-width:320px;padding:14px 24px;background:#6366f1;color:#ffffff;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:12px;">
                Pay Now
              </a>
            </td>
          </tr>
        </table>
      `,
      ctx,
    ),
  };
}

// ── 3. Overdue Alert ───────────────────────────────────────────────────

export function overdueEmail(
  params: {
    clientEmail: string;
    clientName: string;
    amount: number;
    currency: string;
    dueDate: string;
    daysOverdue: number;
    invoiceId: string;
  },
  ctx: EmailContext,
): { subject: string; html: string } {
  const { clientName, amount, currency, dueDate, daysOverdue, invoiceId } = params;
  const amountStr = money(amount, currency);
  const shareLink = `${ctx.appUrl}/share/${invoiceId}`;

  return {
    subject: `Action needed: Invoice for ${amountStr} is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue`,
    html: shell(
      "Overdue Notice",
      `
        <div style="text-align:center;margin-bottom:20px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:#fef2f2;color:#ef4444;font-size:22px;font-weight:700;">!</span>
        </div>

        <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#1e293b;">
          Invoice overdue
        </h1>
        <p style="margin:0 0 20px 0;font-size:15px;color:#475569;line-height:1.5;">
          Your invoice for <strong style="color:#6366f1;">${amountStr}</strong>
          (due ${dueDate}) is now <strong style="color:#ef4444;">${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue</strong>.
          Please submit payment at your earliest convenience to avoid any disruption.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr>
            <td align="center" style="padding:0;">
              <a href="${shareLink}" target="_blank" rel="noopener"
                 style="display:inline-block;width:100%;max-width:320px;padding:14px 24px;background:#ef4444;color:#ffffff;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:12px;">
                Pay Overdue Invoice
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
          If you believe this is an error, please contact your freelancer directly.
        </p>
      `,
      ctx,
    ),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

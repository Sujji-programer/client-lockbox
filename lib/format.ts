/**
 * Thin money formatting + currency/symbol helpers shared by the client
 * portal, dashboard create-form, and invoices table.
 *
 * Always pass the ISO-4217 lowercase currency stored on the invoice row —
 * never assume USD at the call site. Intl handles the symbol + decimals per
 * currency (JPY = 0 decimals, USD/EUR/GBP = 2, INR = 2 with grouping etc.).
 */

const ZERO_DECIMAL_CURRENCIES = new Set(["jpy", "krw", "vnd", "krw", "clp"]);

export type CurrencyCode = "usd" | "eur" | "gbp" | "inr" | "aud" | "cad" | "aed" | "sgd";

export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
  "usd", "eur", "gbp", "inr", "aud", "cad", "aed", "sgd",
];

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  usd: "USD — US Dollar",
  eur: "EUR — Euro",
  gbp: "GBP — British Pound",
  inr: "INR — Indian Rupee",
  aud: "AUD — Australian Dollar",
  cad: "CAD — Canadian Dollar",
  aed: "AED — UAE Dirham",
  sgd: "SGD — Singapore Dollar",
};

/** Format a Number-or-string money value (in major units, e.g. 12.34) into a localized currency string. */
export function money(value: number | string, currency: string): string {
  const v = Number(value);
  const safe = Number.isFinite(v) ? v : 0;
  const code = (currency ?? "usd").toLowerCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2,
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2,
    }).format(safe);
  } catch {
    // Intl occasionally throws on exotic currencies in old V8s — fall back.
    return `$${safe.toFixed(2)}`;
  }
}

/** Format a cents (Stripe) value into the same localized currency form. */
export function moneyFromCents(cents: number, currency: string): string {
  return money(cents / 100, currency);
}

export function formatDate(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...opts,
  }).format(new Date(iso));
}

export function formatRelativeDue(iso: string | null): { label: string; tone: "neutral" | "warning" | "danger" } {
  if (!iso) return { label: "No due date", tone: "neutral" };
  const due = new Date(iso + "T00:00:00Z").getTime();
  const now = Date.now();
  const dayMs = 86_400_000;
  const diffDays = Math.round((due - now) / dayMs);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, tone: "danger" };
  if (diffDays === 0) return { label: "Due today", tone: "warning" };
  if (diffDays === 1) return { label: "Due tomorrow", tone: "warning" };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, tone: "warning" };
  return { label: `Due in ${diffDays}d`, tone: "neutral" };
}

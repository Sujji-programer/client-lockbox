import { Resend } from "resend";

/**
 * Server-only Resend client singleton.
 *
 * Used by the email-alert routes (`/api/email/invoice-created`,
 * `/api/cron/reminder-sweep`). Never import from a Client Component.
 *
 * Created lazily so a missing key doesn't crash the build — only the email
 * routes fail at request time.
 */
let cached: Resend | null = null;

export function getResend(): Resend {
  if (cached) return cached;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "RESEND_API_KEY is not set. Email delivery is disabled. " +
        "Get a key at https://resend.com and add it to your environment.",
    );
  }

  cached = new Resend(apiKey);
  return cached;
}

/** The "from" address shown to recipients. Must be a verified domain in Resend. */
export function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? "billing@clientlockbox.com";
}

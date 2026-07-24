# Stripe Connect — Industry-Grade Setup Guide (ClientLockbox)

This is the **exact** configuration to paste into the Stripe Dashboard so that
freelancers onboard via Stripe Express, clients pay through ClientLockbox, the
platform keeps the 5% (capped $30/mo) application fee, and the freelancer
receives the rest in their Stripe balance.

Everything below corresponds to code that already exists in this repo:

| Concern | File |
| --- | --- |
| Express onboarding API | `app/api/stripe/onboard/route.ts` (alias: `/api/stripe/onboarding`) |
| Onboarding-return status sync | `app/api/stripe/refresh/route.ts` |
| Checkout / PaymentIntent creation | `app/api/checkout/route.ts` |
| **Webhook receiver (canonical)** | `app/api/stripe/webhook/route.ts` |
| Webhook receiver (legacy alias) | `app/api/webhook/route.ts` |
| Fee math (5%, capped $30/mo) | `lib/stripe/fees.ts` + RPC `compute_fee_cents()` |
| DB schema for fees | `plans/phase2-migration.md` |

---

## 1. Environment variables

Put these in `.env.local` for development and in your hosting provider's
dashboard for production. **All of them are required for a working flow.**

```bash
# ── Supabase ───────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJ...           # "anon"/publishable key
SUPABASE_SERVICE_ROLE_KEY=eyJ...                       # server-only; NEVER expose to the browser

# ── Stripe platform keys (your account, the platform) ─────────────────
STRIPE_SECRET_KEY=sk_live_...                          # or sk_test_... in test mode
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...         # or pk_test_...
STRIPE_CLIENT_ID=ca_...                                # from Connect → Settings → Express
STRIPE_WEBHOOK_SECRET=whsec_...                        # from the webhook endpoint you create in §3

# ── App URL (used to build return/refresh URLs) ───────────────────────
NEXT_PUBLIC_APP_URL=https://your-domain.com            # http://localhost:3000 in dev
```

> ⚠️ **`STRIPE_WEBHOOK_SECRET` is now fail-closed.** If it is missing or empty,
> `/api/stripe/webhook` returns HTTP 500 for every request. There is no bypass.
> For local dev use the Stripe CLI forwarder (§4) and copy the `whsec_…` it
> prints.

---

## 2. Stripe Connect settings (one-time)

In the Stripe Dashboard:

1. **Connect → Settings → Onboarding type**: choose **Express**. (The code
   creates `type: 'express'` accounts — if your platform isn't approved for
   Express you'll get an error on `accounts.create`.)
2. **Connect → Settings → Branding**: upload your logo + brand color. This is
   what freelancers see during onboarding.
3. **Connect → Identifiers → Business tax ID / Platform feefrom the platform's
   account** — only relevant once you go live; test mode doesn't require it.
4. Copy your **Client ID** (`ca_…`) from Connect → Settings and put it in
   `STRIPE_CLIENT_ID`.

---

## 3. Webhook endpoint (THE critical piece)

Stripe Dashboard → **Developers → Webhooks → Add endpoint**.

| Field | Value |
| --- | --- |
| **Endpoint URL** | `https://your-domain.com/api/stripe/webhook` |
| **Description** | `ClientLockbox Connect receiver` |
| **Events to send** (select exactly these) | `payment_intent.succeeded`<br>`charge.refunded`<br>`account.updated` |

After creating the endpoint:

1. Click the endpoint → **Signing secret → Reveal** → copy the `whsec_…`.
2. Paste it into `STRIPE_WEBHOOK_SECRET` (locally + your host).
3. **Redeploy** so the env var is live.

> If you previously pointed Stripe at `/api/webhook`, update it to
> `/api/stripe/webhook`. The old path still works (it's a re-export) but you
> must **only have one endpoint registered per event** — registering both will
> double-process events.

### Why these events

| Event | What the webhook does |
| --- | --- |
| `payment_intent.succeeded` | Marks the invoice `PAID`, calls `compute_fee_cents()` which journals the CHARGE into `fee_ledger` + `fee_transactions` (5% capped at $30/mo, atomic). |
| `charge.refunded` | Marks invoice `REFUNDED`, reverses the most-recent fee on that invoice. |
| `account.updated` | Syncs `profiles.stripe_account_status` (PENDING/RESTRICTED/ENABLED) so the dashboard pill reflects Stripe's authoritative state. |

---

## 4. Local development with the Stripe CLI

`stripe listen` signs events with a real `whsec_…` and forwards them, so the
fail-closed verification path runs end-to-end locally:

```bash
# 1. Install the Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login

# 2. Forward signed events to your local canonical webhook:
stripe listen --forward-to localhost:3000/api/stripe/webhook

# 3. It prints:
#   > Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxxxxx (^C to quit)
#    Copy whsec_xxx into STRIPE_WEBHOOK_SECRET in .env.local.

# 4. In another terminal, trigger events to test:
stripe trigger payment_intent.succeeded
stripe trigger charge.refunded
stripe trigger account.updated
```

Note: `stripe trigger` sends generic test events **without** your invoice
metadata, so the handler will respond `{ received: true, ignored: "no_metadata" }`
— that's expected. To test end-to-end, complete a real checkout via the share
page with a test card (`4242 4242 4242 4242`); the live `payment_intent.succeeded`
event *will* carry your `invoice_id` / `freelancer_id` metadata.

---

## 5. The money flow (what actually happens at payment)

For a $100 invoice, with the freelancer at $0 of fees this month:

1. Client clicks Pay on `/share/[id]` → `POST /api/checkout` creates a
   PaymentIntent on the freelancer's Express account:
   - `amount: 10000`, `application_fee_amount: 500` (5% of $100, below cap),
   - `on_behalf_of: <freelancer acct>` + `transfer_data.destination` so funds
     land in the freelancer's balance, not the platform's.
2. Client completes 3DS / card auth in Stripe Elements.
3. Stripe fires `payment_intent.succeeded` → `POST /api/stripe/webhook`.
4. Webhook verifies signature, checks the replay guard, calls
   `compute_fee_cents()` (atomic), which:
   - UPSERTs `fee_ledger` for this month,
   - under `SELECT … FOR UPDATE` computes `min(5%·gross, cap − accumulated)`,
   - writes a `fee_transactions` CHARGE row,
   - returns the fee (e.g. 500).
5. Webhook flips `invoices.status: PENDING → PAID` (status-predicate guarded).

Result: **platform balance += $5.00**, **freelancer Stripe balance += $95.00**,
invoice PAID. Payouts to the freelancer's bank happen on Stripe's normal Express
payout schedule (daily/weekly/monthly per their dashboard setting).

---

## 6. Security checklist (audited)

- ✅ **Fail-closed webhook signature.** Missing/empty `STRIPE_WEBHOOK_SECRET`
  → HTTP 500; never parses untrusted JSON. (`app/api/stripe/webhook/route.ts`)
- ✅ **Raw-body HMAC verification** before any JSON parse.
- ✅ **Replay guard.** `fee_transactions (payment_intent_id, kind)` is checked
  *before* any ledger mutation; the invoice status update is additionally
  predicate-guarded.
- ✅ **Atomic fee capping.** The monthly $30 cap is enforced inside the
  `compute_fee_cents()` SECURITY DEFINER RPC under `SELECT … FOR UPDATE` — two
  concurrent payments to the same freelancer cannot race past the cap.
- ✅ **Privileged writes only server-side.** The webhook and admin writes use
  the service-role client, never reachable from the browser bundle.
- ✅ **Terminal-state protection.** A redelivered `charge.refunded` cannot
  resurrect a PAID→REFUNDED row back to PAID.

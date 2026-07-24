# ClientLockbox — Phase 2 "Stripe Connect + Capped-Fee" Upgrade

> Target: transform CiteFlow (single-account Stripe, hardcoded USD, deliverable
> paywall) into a high-performance SaaS for freelancers with **Stripe Connect
> Express + capped 5% fee ledger**, a **60-second clientflow**, premium
> **Inter / adaptive theme** design system, and **automated reminders** via
> Supabase Edge Functions + Resend.
>
> Staged so each phase is independently reviewable:
> 1. **Phase A** — Database + Stripe Connect + Capped-Fee ledger
> 2. **Phase B** — 3-Pillar UX rewrite + design system
> 3. **Phase C** — Automated email reminders + share-link utilities

```mermaid
flowchart LR
    subgraph Freelancer
        DASH[Dashboard] -->|insert invoice| DB[(supabase: invoices)]
        DASH -->|/api/stripe/onboard| STRIPE_E[Express onboarding]
    end
    subgraph Client
        SHARE[/share/id] --> SIGN[Accept terms + signature]
        SIGN -->|/api/checkout| CHECKOUT[Stripe PaymentIntent]
        CHECKOUT -->|application_fee_amount via fee-cap logic| STRIPE_C[Stripe Connect]
    end
    STRIPE_C -->|webhook| WH[/api/webhook/]
    WH -->|update invoices.PAID + fee_ledger| DB
    CRON[(pg_cron -> Edge fn cron-reminders)] -->|resend| MAIL[(Resend)]
    MAIL -->|3d before / 1d overdue| CLIENT_EMAIL[Client Inbox]
```

---

## Phase A — Database, Stripe Connect, Capped-Fee Logic

### A.1 SQL migration (idempotent, paste into Supabase SQL Editor)

File: [`plans/phase2-migration.sql`](plans/phase2-migration.sql)

New / altered objects:
| Object | Change |
|---|---|
| `profiles.plan_type` | unchanged (FREE only now — Premium deferred) |
| `profiles.stripe_account_id` | `text` — Connect Express account id (`acct_…`) |
| `profiles.stripe_account_status` | `text` CHECK in (`PENDING`,`RESTRICTED`,`ENABLED`) |
| `invoices.scope_of_work` | `text not null` — replaces the "file paywall" payload |
| `invoices.currency` | `text not null default 'usd'` (ISO-4217 lowercase) |
| `invoices.due_date` | `date` — nullable for "no due date" option |
| `invoices.terms` | `text` — short terms string |
| `invoices.signature` | `text` — client-typed digital signature |
| `invoices.accepted_at` | `timestamptz` — terms acceptance timestamp |
| `invoices.file_path` | **dropped** (no more file paywall — invoice-first model) |
| `invoices.target_keywords`,`ai_engines`,`share_of_voice`,`citation_snippet` | **dropped** (GEO clutter removed) |
| `invoices.amount` | `numeric(10,2)` — base amount (excludes fee) |
| `platform_fee` | kept (set to the **capped application fee** at charge time) |
| `total_charged` | kept — client pays `amount + platform_fee` |
| `fee_ledger` | **NEW table** — one row per freelancer per calendar month |
| `fee_transactions` | **NEW table** — immutable journal of each fee applied |

`fee_ledger`:
```sql
create table public.fee_ledger (
  freelancer_id uuid primary key references public.profiles(id) on delete cascade,
  period_month int  not null,   -- 1..12
  period_year  int  not null,   -- e.g. 2026
  fees_accumulated_cents bigint not null default 0,
  cap_cents bigint not null default 3000,  -- $30 cap
  updated_at timestamptz not null default now()
);
```
`fee_transactions` (append-only, immutable):
```sql
create table public.fee_transactions (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references public.profiles(id) on delete cascade,
  invoice_id uuid references public.invoices(id),
  payment_intent_id text,
  gross_cents bigint not null,
  fee_cents bigint not null,           -- the actual fee applied (0 if cap hit)
  cumulative_cents bigint not null,     -- running total this period AFTER this charge
  period_month int not null,
  period_year int not null,
  kind text not null check (kind in ('CHARGE','REFUND')),
  created_at timestamptz not null default now()
);
create index fee_transactions_fl_idx on public.fee_transactions (freelancer_id, period_year, period_month);
```

RLS:
- `fee_ledger` + `fee_transactions` are owner-readable (`auth.uid() = freelancer_id`), service-role writable.
- A ` SECURITY DEFINER` helper `public.compute_fee_cents(p_fl uuid, p_gross int)` enforces the cap atomically in a single transaction and inserts the journal row; returns the fee to charge.

### A.2 Stripe Connect wiring

New files:
| File | Purpose |
|---|---|
| [`app/api/stripe/onboard/route.ts`](app/api/stripe/onboard/route.ts) | `POST`: creates/reuses Express account, calls `stripe.accountLinks.create`, returns the Stripe onboarding URL. |
| [`app/api/stripe/refresh/route.ts`](app/api/stripe/refresh/route.ts) | `GET`: refresh link when Stripe bounces back (`https://…/connect/refresh`). |
| [`lib/stripe/server.ts`](lib/stripe/server.ts) | singleton Stripe server client. |
| [`lib/stripe/fees.ts`](lib/stripe/fees.ts) | `computeApplicationFeeCents(stripe, supabaseAdmin, freelancerId, grossCents)` — calls the `compute_fee_cents` RPC. |

Edited files:
| File | Change |
|---|---|
| [`app/api/checkout/route.ts`](app/api/checkout/route.ts) | Switch to **Destination Charge on the connected account** via `paymentIntentData.applicationFeeAmount` + `onBehalfOf`/`transferData.destination`. Reads `profiles.stripe_account_id`. Enforces `invoices.status === PENDING` AND `accepted_at IS NOT NULL` AND `signature IS NOT NULL`. Currency from `invoices.currency`. |
| [`app/api/webhook/route.ts`](app/api/webhook/route.ts) | Handle `payment_intent.succeeded` AND `charge.refunded`. RPC appends to `fee_transactions` (`CHARGE` or `REFUND`) and updates `fee_ledger`. Marks invoice `PAID` (or `REFUNDED`). Idempotent on `payment_intent_id`. |
| [`components/dashboard-nav.tsx`](components/dashboard-nav.tsx) | Add "Stripe Connect" pill showing account status. |

### A.3 Onboarding UX

Below the create-invoice form:
- If `stripe_account_status !== 'ENABLED'` → banner "Connect Stripe to start collecting → [Onboard]".
- If `ENABLED` → green pill "Stripe connected". Both cards live-update after onboarding redirect via `/api/stripe/refresh`.

---

## Phase B — 3-Pillar UX & Design System

### B.1 Design tokens

File: [`app/globals.css`](app/globals.css) (rewrite tokens)
- New HSL palette: `--background` near-white (`0 0% 100%`) light / `222 47% 8%` (deep slate) dark.
- `--foreground` `222 47% 11%` light / `210 40% 98%` dark.
- `--primary` indigo `243 75% 59%` (light + dark).
- `--muted-foreground` `215 16% 47%` light / `215 19% 65%` dark.
- `--radius` bumped to `0.75rem` (softer, premium).
- Add `--card-elevated` and skeleton shimmer @keyframes.

File: [`tailwind.config.ts`](tailwind.config.ts)
- Add `fontFamily.sans = ['Inter', ...systemFallbacks]`.
- Add `keyframes.shimmer / fadeIn / scaleIn` and matching `animation.*` utilities.
- Add `boxShadow.glow = '0 0 40px -12px hsl(var(--primary) / 0.4)'`.

### B.2 Pillar 1 — The 60-second Invoice Flow

Replace `dashboard-client.tsx` (946 lines) → [`components/create-invoice-form.tsx`](components/create-invoice-form.tsx) (~220 lines):
- Exactly 4 inputs per spec: **Client Email**, **Scope of Work** (textarea), **Amount** (`<select>` currency toggle: USD, EUR, GBP, INR, AUD, CAD, AED, SGD), **Due Date** + **Terms** row.
- On submit: insert row, immediately show the share-link **action sheet** (not a banner-only) with:
  - **Copy Secure Payment Link** (single call to `navigator.clipboard`)
  - **Share via WhatsApp** (`https://wa.me/?text=…`)
  - **Share via SMS** (`sms:?&body=…`)
- Loading skeleton on the action sheet while the insert resolves.

### B.3 Pillar 2 — The Client Portal (The Checkout Page)

Rewrite [`app/share/[id]/paywall-client.tsx`](app/share/[id]/paywall-client.tsx) (~400 lines):
- Hero card: freelancer-defined scope of work, amount (`Intl.NumberFormat` with `invoices.currency`), due date chip.
- **Accept Terms & Conditions** checkbox + **digital signature** text input (client types their full name to enable submit). Acceptance timestamp stored via `POST /api/accept-terms`.
- **Stripe Elements** payment form embedded inline on the same page (not Stripe-hosted checkout). Use [`@stripe/stripe-js`](https://npmjs.com/@stripe/stripe-js) + Payment Element with `mode: 'payment'`.
- Submit → create PaymentIntent on the connected account with the capped `application_fee_amount`.
- Success state: full-screen animated check (scale-In), 2s auto-dismiss, show "We've notified your freelancer" CTA.

### B.4 Pillar 3 — Micro-CRM Table

New: [`components/invoices-table.tsx`](components/invoices-table.tsx)
- Server-fetched data table with columns: Client · Amount · Fee · Status badge (PENDING/PAID/REFUNDED) · Due Date · Created.
- Empty state, virtualized-friendly (just slice first 100 rows), search box filtering `client_email`.
- Refreshes from a `revalidatePath` after webhook hits → next render sees PAID.

### B.5 Mobile-first pass

- Audit the create-invoice form: stack all inputs in `<div className="grid grid-cols-1 sm:grid-cols-2">` — never side-by-side on `<640px`.
- Client portal: single column, sticky **Pay $X** button on mobile bottom-bar with loading skeleton.
- Test in Chrome device-mode iOS 12 / Android Pixel sizes (mental check during rewrite).

---

## Phase C — Automated Reminders + Share Utilities

### C.1 Edge Function + pg_cron

New: [`supabase/functions/cron-reminders/index.ts`](supabase/functions/cron-reminders/index.ts)
- Service-role client reads every `PENDING` invoice with `due_date` set.
- For each:
  - `due_date - 3 days === today` → send `reminder-pre-due` email.
  - `due_date + 1 day === today` → send `reminder-overdue` email.
  - Idempotency via `invoices.reminders_sent` `int[]` appending `{3,1}` to avoid re-sends.

New: [`plans/phase2-migration.sql`](plans/phase2-migration.sql) tail block:
- `alter table public.invoices add column reminders_sent int[] not null default '{}';`
- `grant select, update on fee_ledger, fee_transactions to anon;` (only via RPC; standard RLS keeps anon off).
- pg_cron registration:
  ```sql
  select cron.schedule(
    'reminder-loop','0 9 * * *',
    $$ select net.http_post(
      url := 'https://YOUR-PROJECT.functions.supabase.co/cron-reminders',
      headers := jsonb_build_object('Authorization','Bearer <anon>'),
      body := jsonb_build_object()
    ); $$);
  ```

### C.2 Resend integration

New: [`lib/email/resend.ts`](lib/email/resend.ts) — `sendReminderEmail({ to, invoice, kind })`.
New: [`lib/email/templates/reminder.tsx`](lib/email/templates/reminder.tsx) — React Email template (client-friendly, on-brand).
Add dep: `resend` + `react-email` (peer).

### C.3 Env additions (`.env.local` / production)

```
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_CLIENT_ID=ca_…         # Connect Express client id from Stripe dashboard
RESEND_API_KEY=re_…
RESEND_FROM=ClientLockbox <no-reply@…>
CRON_SECRET=<random>
```

---

## Deployment-readiness checklist

- [ ] All secrets set in Vercel project env (strip `.env.local` references before commit).
- [ ] `STRIPE_SECRET_KEY` set to live or test mode (test for staging).
- [ ] Webhook endpoint registered in Stripe Dashboard → `https://<prod>/api/webhook` for events: `payment_intent.succeeded`, `charge.refunded`, `account.updated`.
- [ ] Run `plans/phase2-migration.sql` in Supabase SQL Editor (I'll ask before running).
- [ ] Deploy Supabase Edge Function `cron-reminders` + set `CRON_SECRET`.
- [ ] Set pg_cron schedule.
- [ ] Run `npm run build` to confirm no type errors.
- [ ] Smoke flow: signup → onboard Stripe (Express) → create invoice → open share link on phone → accept terms + pay test card → see webhook flip `PAID` → see fee ledger increment → after `due_date`-3 ≥ reminder fires (test by setting `due_date` near `now()`).

---

## Out-of-scope (deliberately cut for fastest-possible ship)

- Premium plan + Stripe Subscriptions (the cap already delivers the moat; Premium is a future lever).
- Multi-deliverable attachments per invoice (one scope-of-work string is enough for the 60-second flow).
- Refund initiation UI (only webhook-driven refunds handled).
- PDF invoice downloads (replaced by share-link action sheet, per spec).

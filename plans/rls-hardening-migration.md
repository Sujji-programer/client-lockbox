# ClientLockbox — Row-Level Security Hardening Migration

> Source-of-truth SQL to **enforce Row-Level Security (RLS)** across the entire
> database, tightening the loose `invoices_select_public_by_id` policy inherited
> from [`database-schema.md`](./database-schema.md) into a **scan-proof,
> single-row-by-token** Client Portal path.
>
> **How to use:** copy the entire SQL block below and paste it into the
> **Supabase Dashboard → SQL Editor → New query**, then click **Run**.
> It is idempotent and safe to re-run.
>
> Companion docs:
> - [`database-schema.md`](./database-schema.md) — original schema + loose anon policy.
> - [`storage-setup.md`](./storage-setup.md) — private `deliverables` bucket.

---

## What this migration does

| Table | Action |
|---|---|
| `public.profiles` | Enable RLS · owner-only SELECT / INSERT / UPDATE / DELETE via `auth.uid() = id`. |
| `public.invoices` | Enable RLS · freelancer full CRUD on `auth.uid() = freelancer_id`. Anon/authenticated **cannot** read/write directly. |
| `public.fee_ledger` | Enable RLS · owner-only SELECT. No user-space INSERT/UPDATE/DELETE (writes via the `compute_fee_cents()` SECURITY DEFINER RPC + service role). |
| `public.fee_transactions` | Enable RLS · owner-only SELECT. Same write restriction as `fee_ledger`. |
| `public.invoices.share_token` | NEW column — a unique, unguessable `uuid` (122-bit secret) minted per invoice. This is the **only** handle the Client Portal may use. |
| `public.public_invoices` | NEW SECURITY DEFINER view exposing the bare minimum columns a client needs to see/render the Portal. The Client Portal queries this view by `share_token`, never the base table. |
| Anon grants on base tables | **REVOKE** `SELECT` on `public.invoices` from `anon` / `authenticated` so the loose `invoices_select_public_by_id` policy can no longer leak rows even if it stays defined. |

### Why this is scan-proof

RLS policies are row filters, not row-count limiters — an anon `select * from
invoices` with a wide-open `using (true)` policy would happily stream every
invoice row in the table. The original schema flagged this risk explicitly and
offered the `public_invoices` view as an alternative. This migration implements
that alternative and additionally:

1. **Removes anon SELECT from the base `invoices` table** (`revoke`), so even a
   misconfigured policy cannot be exercised by anon.
2. **Replaces the open anon policy with a single SECURITY DEFINER view** that
   is granted to `anon` only on the view, not the table.
3. **The view does not carry `id`** — clients reference invoices by
   `share_token`, which is a distinct, per-row UUID minted at insert time and
   never derivable from the row's PK.

> The Node share route at [`app/share/[id]/page.tsx`](../app/share/[id]/page.tsx:42)
> currently looks the invoice up by its PK `id`. After this migration, that
> route must switch from `.eq("id", id)` to the view lookup
> `.from("public_invoices").select(...).eq("share_token", token).maybeSingle()`
> (route param renamed `[token]`). The signed-Storage-URL flow in
> [`lib/supabase/admin.ts`](../lib/supabase/admin.ts:14) continues to use the
> service role key against the base table and is unaffected.

---

## Complete SQL — paste into Supabase SQL Editor

```sql
-- ============================================================================
-- ClientLockbox — RLS Hardening Migration
-- Tables:  public.profiles, public.invoices,
--          public.fee_ledger, public.fee_transactions
-- + new:   public.invoices.share_token (uuid, unique, not null, default gen_random_uuid())
-- + new:   public.public_invoices  (SECURITY DEFINER view, scan-proof client portal)
--
-- Idempotent; safe to re-run.
-- ============================================================================

-- 0. Extensions -------------------------------------------------------------
-- gen_random_uuid() lives in pgcrypto. Supabase ships it; ensure it's enabled.
create extension if not exists pgcrypto;

-- 1. Ensure RLS is ENABLED on every table -----------------------------------
-- Idempotent: `enable row level security` is a no-op if already enabled.
alter table public.profiles         enable row level security;
alter table public.invoices         enable row level security;
alter table public.fee_ledger       enable row level security;
alter table public.fee_transactions enable row level security;

-- Optional hardening for production: force RLS even for table owners so a
-- compromised service role still respects policies in day-to-day code paths.
-- Uncomment when you no longer need the service role to bypass RLS cleanly
-- (note: this WILL break the signed-URL mint flow in lib/supabase/admin.ts;
-- only enable after migrating that path to a SECURITY DEFINER RPC).
-- alter table public.profiles         force row level security;
-- alter table public.invoices         force row level security;
-- alter table public.fee_ledger       force row level security;
-- alter table public.fee_transactions force row level security;

-- ============================================================================
-- 2. profiles — owner-only CRUD (auth.uid() = id) ----------------------------
-- ============================================================================
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own"
    on public.profiles for select
    to authenticated
    using (auth.uid() = id);

create policy "profiles_insert_own"
    on public.profiles for insert
    to authenticated
    with check (auth.uid() = id);

create policy "profiles_update_own"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);

create policy "profiles_delete_own"
    on public.profiles for delete
    to authenticated
    using (auth.uid() = id);

-- ============================================================================
-- 3. invoices — freelancer full CRUD on own invoices ------------------------
-- ============================================================================
drop policy if exists "invoices_select_own"        on public.invoices;
drop policy if exists "invoices_insert_own"        on public.invoices;
drop policy if exists "invoices_update_own"        on public.invoices;
drop policy if exists "invoices_delete_own"        on public.invoices;

create policy "invoices_select_own"
    on public.invoices for select
    to authenticated
    using (auth.uid() = freelancer_id);

create policy "invoices_insert_own"
    on public.invoices for insert
    to authenticated
    with check (auth.uid() = freelancer_id);

create policy "invoices_update_own"
    on public.invoices for update
    to authenticated
    using (auth.uid() = freelancer_id)
    with check (auth.uid() = freelancer_id);

create policy "invoices_delete_own"
    on public.invoices for delete
    to authenticated
    using (auth.uid() = freelancer_id);

-- ============================================================================
-- 4. Scan-proof Client Portal path ------------------------------------------
--    Replace the loose `invoices_select_public_by_id` (using(true)) policy
--    with a SECURITY DEFINER view queried by an unguessable share_token.
--    The base table is no longer readable by anon/authenticated at all.
-- ============================================================================

-- 4.1 Drop the legacy wide-open anon policy so it can never be exercised.
drop policy if exists "invoices_select_public_by_id" on public.invoices;

-- 4.2 Revoke direct SELECT on the base table from anon / authenticated.
--     The service role bypasses RLS entirely and is NOT affected by this.
revoke select on public.invoices from anon;
revoke select on public.invoices from authenticated;

-- 4.3 Add the unguessable share_token column to invoices.
--     Defaulted to a fresh gen_random_uuid() so existing rows get a secret
--     token immediately; NOT NULL once backfilled. UNIQUE so two distinct
--     invoices can never share a token (defense-in-depth against aliasing).
alter table public.invoices
    add column if not exists share_token uuid
    not null
    default gen_random_uuid();

-- Backfill any rows that pre-date the column (the DEFAULT covers new inserts,
-- but be explicit for any NULLs that might exist on partially-applied runs).
update public.invoices
   set share_token = gen_random_uuid()
 where share_token is null;

-- Unique index = unguessable AND collision-free lookups.
create unique index if not exists invoices_share_token_uniq
    on public.invoices (share_token);

comment on column public.invoices.share_token
    is 'Unguessable UUID handle used by the Client Portal to fetch a single invoice row via the public_invoices view. NOT the same as the PK id — clients never see id.';

-- 4.4 The scan-proof Client Portal view.
--     SECURITY DEFINER runs as the view owner (postgres), which bypasses RLS
--     on the base table — but the view projects only the columns a client
--     needs to see, and intentionally omits:
--       * id                  (clients reference rows by share_token, not PK)
--       * freelancer_id       (prevents deanonymizing the freelancer)
--       * file_path           (private bucket key — never exposed to clients)
--       * stripe_payment_intent_id / stripe_transfer_id  (platform bookkeeping)
--     The view exposes share_token so the lookup query is token-scoped.
create or replace view public.public_invoices
    with (security_barrier = true) as
    select
        share_token,
        client_name,
        client_email,
        scope_of_work,
        amount,
        platform_fee,
        total_charged,
        currency,
        due_date,
        terms,
        signature,
        accepted_at,
        status,
        created_at
    from public.invoices;

comment on view public.public_invoices
    is 'Scan-proof Client Portal projection of public.invoices. Queryable only by share_token (an unguessable per-row UUID). Omits id, freelancer_id, file_path, and Stripe bookkeeping columns.';

-- 4.5 Grant anon + authenticated SELECT on the VIEW only — never the table.
--     file_path stays unreachable from this view; signed Storage URLs are
--     minted by the service role against the base table in lib/supabase/admin.ts.
grant select on public.public_invoices to anon;
grant select on public.public_invoices to authenticated;

-- ============================================================================
-- 5. fee_ledger + fee_transactions — owner-readable; service-role writable -
--    Freelancers may READ their own rows only. All writes happen through the
--    `compute_fee_cents()` SECURITY DEFINER RPC (webhook path) or the service
--    role. No direct INSERT/UPDATE/DELETE policy is granted to ordinary users.
-- ============================================================================
drop policy if exists "fee_ledger_select_own"       on public.fee_ledger;
drop policy if exists "fee_transactions_select_own" on public.fee_transactions;

create policy "fee_ledger_select_own"
    on public.fee_ledger for select
    to authenticated
    using (auth.uid() = freelancer_id);

create policy "fee_transactions_select_own"
    on public.fee_transactions for select
    to authenticated
    using (auth.uid() = freelancer_id);

-- ============================================================================
-- Verification helpers (run AFTER this migration in a separate query tab)
-- ============================================================================

-- Tables + RLS status — every row below must show rowsecurity = true.
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in ('profiles', 'invoices', 'fee_ledger', 'fee_transactions')
-- order by tablename;

-- Active policies per table.
-- select schemaname, tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;

-- Confirm anon can NOT scan the base table, but CAN reach one row by token.
--   set role anon;
--   -- These should both return ERROR: permission denied for table invoices:
--   select * from public.invoices limit 1;
--   select * from public.invoices where id = '00000000-0000-0000-0000-000000000000';
--   -- This returns a single row or empty set, depending on the token supplied.
--   -- It can never leak more than one row because share_token is UNIQUE.
--   select * from public.public_invoices where share_token = $1;
--   reset role;
```

---

## Required application-side change

After running the SQL above, update the share page to read by `share_token`
through the view instead of by PK through the base table:

```ts
// app/share/[token]/page.tsx  (rename [id] -> [token])
const { token } = await params;
const supabase = await createClient();

const { data: invoice } = await supabase
  .from("public_invoices")            // view, not base table
  .select("share_token, client_name, client_email, scope_of_work, amount, platform_fee, total_charged, currency, due_date, terms, signature, accepted_at, status, created_at")
  .eq("share_token", token)           // unguessable UUID handle
  .maybeSingle();
```

The signed-Storage-URL mint path ([`lib/supabase/admin.ts`](../lib/supabase/admin.ts:14))
already uses the **service role** key against the base `invoices` table, which
bypasses RLS — it needs no changes, but its callers must resolve the base-row
`file_path` from the share_token through a server-side lookup (e.g. an RPC)
rather than re-querying `public_invoices` (which omits `file_path`).

---

## Notes

- **`share_token` ≠ `id`.** The PK remains the internal handle; the token is a
  separate per-row UUID the client carries as a secret. This blocks any
  enumeration of invoices by walking the PK space.
- **`SECURITY DEFINER` view** is intentional: the view runs as `postgres`, so
  it can read the base table without any anon SELECT grant on the table itself.
  `security_barrier = true` prevents predicate-pushdown optimizations from
  leaking row data to the caller's planner.
- **No `force row level security`** is set by default, so the **service role**
  (which bypasses RLS) can still mint signed Storage URLs for any `file_path`
  regardless of caller. This is required for the signed-URL flow in
  [`storage-setup.md`](./storage-setup.md).
- **Backwards compatibility:** the old `invoices_select_public_by_id` policy is
  dropped; anyone hitting the share route via PK `id` will now receive a 404.
  Cut over the share route in the same release as this migration.
```

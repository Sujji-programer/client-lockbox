/**
 * POST /api/webhook  — LEGACY COMPAT ALIAS.
 *
 * The canonical Stripe webhook receiver now lives at
 * `/api/stripe/webhook` (see `app/api/stripe/webhook/route.ts`). This file
 * forwards to that handler so any Stripe dashboard still pointed at the old
 * URL keeps working until you update the endpoint.
 *
 * ⚠️  Do NOT register both `/api/webhook` and `/api/stripe/webhook` in the
 * Stripe dashboard — Stripe would deliver each event to both and the ledger
 * would be touched twice. Point your endpoint at `/api/stripe/webhook` and
 * delete this file (and its folder) once the cutover is done.
 */
export { POST } from "@/app/api/stripe/webhook/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

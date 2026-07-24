/**
 * POST /api/stripe/onboarding  — alias of /api/stripe/onboard.
 *
 * The actual implementation lives in `app/api/stripe/onboard/route.ts`. This
 * file exposes the same handler under the `/onboarding` path so integrators
 * using the longer name (matching Stripe's own vocabulary) are routed to the
 * exact same code.
 *
 * It is a literal re-export rather than a copy so the two paths can never
 * drift. The dashboard currently calls `/api/stripe/onboard` — both work.
 */
export { POST } from "@/app/api/stripe/onboard/route";

import Link from "next/link";
import { CheckCircle2, Sparkles, ArrowRight } from "lucide-react";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "/mo",
    tagline: "Launch your payment-protected delivery workflow at zero cost.",
    accent: false,
    badge: null,
    cta: { label: "Get Started Free", href: "/auth" },
    features: [
      "Watermarked streaming preview player",
      "Payment-locked 4K file delivery",
      "Cloudflare R2 storage vault",
      "Stripe Connect payouts",
      "AI Timeline-to-Marker Export (.XML / .EDL)",
      "Automated invoice reminders",
      "10% platform transaction fee",
      "Standard R2 storage (5 GB)",
    ],
  },
  {
    name: "Pro",
    price: "$29",
    cadence: "/mo",
    tagline: "Remove all platform fees and keep 100% of every invoice.",
    accent: true,
    badge: "Most Popular",
    cta: { label: "Start Pro Free Trial", href: "/auth" },
    features: [
      "Everything in Free, plus:",
      "0% platform transaction fee — keep 100%",
      "Custom branding & white-label portal",
      "Unlimited Cloudflare R2 uploads",
      "Priority Stripe Connect payouts",
      "Advanced AI marker export templates",
      "Client analytics & view tracking",
      "Priority support & onboarding",
    ],
  },
] as const;

export function LandingPricing() {
  return (
    <section id="pricing" className="relative z-10 mx-auto w-full max-w-7xl px-5 py-24 sm:px-8">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-violet-600/10 blur-[100px]"
      />

      {/* Section header */}
      <div className="relative mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-1.5 text-xs font-medium text-cyan-300">
          <Sparkles className="h-3 w-3" />
          Simple, transparent pricing
        </div>
        <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Start free.{" "}
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
            Scale when you&apos;re ready.
          </span>
        </h2>
        <p className="mt-3 text-slate-400 sm:text-base leading-relaxed">
          The barbell strategy — launch at $0 with a transparent fee, or go Pro
          and keep every dollar you earn.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="relative mt-14 mx-auto grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
        {TIERS.map((tier) => (
          <article
            key={tier.name}
            className={`relative overflow-hidden rounded-2xl border p-8 backdrop-blur transition duration-300 ${
              tier.accent
                ? "border-cyan-400/30 bg-gradient-to-b from-cyan-950/40 to-[#0D1220] shadow-2xl shadow-cyan-500/10"
                : "border-white/[0.07] bg-[#0D1220] hover:border-white/[0.12]"
            }`}
          >
            {/* Popular badge */}
            {tier.badge && (
              <div className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-violet-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-inset ring-cyan-400/30">
                <Sparkles className="h-3 w-3" />
                {tier.badge}
              </div>
            )}

            {/* Inner glow for pro tier */}
            {tier.accent && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  boxShadow: "inset 0 1px 0 0 rgba(6,182,212,0.2)",
                }}
              />
            )}

            <div className="relative">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {tier.name}
              </h3>

              <div className="mt-4 flex items-end gap-1.5">
                <span className="text-5xl font-bold tracking-tight text-white">
                  {tier.price}
                </span>
                <span className="mb-2 text-sm text-slate-500">{tier.cadence}</span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-slate-400">{tier.tagline}</p>

              {/* Fee callout for free tier */}
              {!tier.accent && (
                <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3.5 py-2.5">
                  <p className="text-xs text-amber-300/80">
                    <span className="font-semibold text-amber-300">10% platform fee</span> — charged transparently at checkout. Clients see it upfront.
                  </p>
                </div>
              )}

              {/* 0% fee callout for pro */}
              {tier.accent && (
                <div className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.07] px-3.5 py-2.5">
                  <p className="text-xs text-cyan-300/80">
                    <span className="font-semibold text-cyan-300">0% platform fee</span> — only standard Stripe processing (~2.9% + 30¢) passed through.
                  </p>
                </div>
              )}

              <Link
                href={tier.cta.href}
                className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold transition duration-200 ${
                  tier.accent
                    ? "bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50"
                    : "border border-slate-700 bg-transparent text-slate-100 hover:border-slate-500 hover:bg-slate-800/50"
                }`}
              >
                {tier.cta.label}
                <ArrowRight className="h-4 w-4" />
              </Link>

              {/* Features list */}
              <ul className="mt-8 space-y-3.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-slate-300">
                    <CheckCircle2
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        tier.accent ? "text-cyan-400" : "text-slate-500"
                      }`}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      {/* Bottom note */}
      <p className="mt-8 text-center text-xs text-slate-600">
        All plans include Cloudflare R2 storage, Stripe Connect escrow, and automated invoice reminders.
        No hidden fees. No surprises.
      </p>
    </section>
  );
}

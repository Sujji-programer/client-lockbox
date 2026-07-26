import { ShieldCheck, BadgeCheck, Lock, Zap, Globe } from "lucide-react";

const TRUST_BADGES = [
  {
    icon: ShieldCheck,
    title: "Funds held safely by Stripe",
    description:
      "All client payments are held in Stripe's regulated escrow infrastructure — the same stack trusted by Amazon, Shopify, and Lyft.",
    accent: "cyan",
  },
  {
    icon: BadgeCheck,
    title: "First Payment Protection Guarantee",
    description:
      "If a client disputes their first payment on CiteFlow without cause, we cover 100% of the lost invoice — up to $500.",
    accent: "violet",
  },
  {
    icon: Lock,
    title: "AES-256 Encrypted Vault",
    description:
      "Every file is encrypted at rest and in transit inside Cloudflare R2. Only paying clients can access their deliverables.",
    accent: "cyan",
  },
] as const;

const STATS = [
  { value: "0%", label: "Egress fees on R2 storage" },
  { value: "$0", label: "To start protecting invoices" },
  { value: "100%", label: "Earnings kept on Pro tier" },
  { value: "<2 min", label: "Avg. Stripe Connect payout" },
] as const;

const accentMap = {
  cyan: {
    icon: "bg-cyan-400/10 text-cyan-400 ring-1 ring-inset ring-cyan-400/20",
    border: "border-cyan-400/15",
    glow: "bg-cyan-500/8",
  },
  violet: {
    icon: "bg-violet-400/10 text-violet-400 ring-1 ring-inset ring-violet-400/20",
    border: "border-violet-400/15",
    glow: "bg-violet-500/8",
  },
};

export function LandingTrust() {
  return (
    <section id="trust" className="relative z-10 mx-auto w-full max-w-7xl px-5 py-24 sm:px-8">

      {/* Section header */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-slate-300">
          <ShieldCheck className="h-3 w-3 text-cyan-400" />
          Enterprise-grade security for freelancers
        </div>
        <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Your money is protected.{" "}
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
            Your work is safe.
          </span>
        </h2>
        <p className="mt-3 text-slate-400 sm:text-base leading-relaxed">
          We&apos;ve built every layer of CiteFlow around one principle — you should always get paid for your work.
        </p>
      </div>

      {/* Trust badges grid */}
      <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
        {TRUST_BADGES.map((badge) => {
          const Icon = badge.icon;
          const a = accentMap[badge.accent];
          return (
            <div
              key={badge.title}
              className={`group relative overflow-hidden rounded-2xl border ${a.border} bg-[#0D1220] p-7 transition duration-300`}
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full ${a.glow} blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
              />
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${a.icon}`}>
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-base font-semibold text-white">{badge.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{badge.description}</p>
            </div>
          );
        })}
      </div>

      {/* Stats strip */}
      <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] md:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="bg-[#090D16] px-6 py-7"
          >
            <div className="text-3xl font-bold tracking-tight text-white">{stat.value}</div>
            <div className="mt-1.5 text-xs text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Partner trust logos row */}
      <div className="mt-14 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-600">
          Powered by infrastructure you trust
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-8">
          {/* Stripe */}
          <div className="flex items-center gap-2 opacity-40 transition hover:opacity-70">
            <Zap className="h-4 w-4 text-slate-300" />
            <span className="text-sm font-semibold text-slate-300">Stripe</span>
          </div>
          {/* Cloudflare */}
          <div className="flex items-center gap-2 opacity-40 transition hover:opacity-70">
            <Globe className="h-4 w-4 text-slate-300" />
            <span className="text-sm font-semibold text-slate-300">Cloudflare R2</span>
          </div>
          {/* Vercel */}
          <div className="flex items-center gap-2 opacity-40 transition hover:opacity-70">
            <svg className="h-4 w-4 fill-slate-300" viewBox="0 0 76 65" aria-label="Vercel">
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
            </svg>
            <span className="text-sm font-semibold text-slate-300">Vercel</span>
          </div>
          {/* Supabase */}
          <div className="flex items-center gap-2 opacity-40 transition hover:opacity-70">
            <Lock className="h-4 w-4 text-slate-300" />
            <span className="text-sm font-semibold text-slate-300">Supabase Auth</span>
          </div>
        </div>
      </div>
    </section>
  );
}

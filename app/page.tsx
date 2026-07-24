import Link from "next/link";
import {
  LockboxLogoIcon,
  ShieldCheckIcon,
  WalletIcon,
  SparklesIcon,
  CheckCircle2Icon,
  UsersIcon,
} from "@/components/icons";

/**
 * CiteFlow — public marketing landing page.
 *
 * Conversion-optimized B2B SaaS page targeting high-ticket freelancers and
 * GEO/SEO agencies. Deep slate aesthetic with indigo glow accents, glassy
 * cards, and clean responsive layouts. Server component — no client state.
 */

const PILLARS = [
  {
    icon: ShieldCheckIcon,
    title: "Payment-Locked Delivery",
    body: "Clients can see that their monthly report or performance assets are ready, but files remain completely secure behind an encrypted paywall until payment clears.",
  },
  {
    icon: WalletIcon,
    title: "Zero-Fee Scale",
    body: "Start free with a transparent 10% client-facing platform fee, or upgrade to Pro and keep 100% of the invoice value after Stripe processing.",
  },
  {
    icon: UsersIcon,
    title: "High-Ticket Client Experience",
    body: "Swap messy email threads and text links for a pristine, white-labeled, secure document room that commands professional authority.",
  },
] as const;

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "/mo",
    tagline: "Everything you need to launch a premium client portal.",
    accent: false,
    cta: { label: "Get Started Free", href: "/auth/sign-up" },
    features: [
      "Fully featured workspace",
      "Custom secure file uploads",
      "White-labeled client delivery rooms",
      "Automated invoice reminders",
      "Encrypted payment-locked paywall",
      "Transparent 10% platform fee applied at checkout on Free tier",
    ],
  },
  {
    name: "Pro",
    price: "$100",
    cadence: "/mo",
    tagline: "Remove client-facing platform fees and operate at 100% margins.",
    accent: true,
    cta: { label: "Upgrade to Pro", href: "/auth/sign-up" },
    features: [
      "Everything in Free, plus:",
      "Completely removes the client-facing platform fee",
      "Flat monthly billing — zero surprises",
      "Only Stripe processing is passed through at checkout",
      "Dedicated priority support",
      "100% margins on every deliverable",
    ],
  },
] as const;

const STATS = [
  { value: "0%", label: "Platform take when on Pro" },
  { value: "10%", label: "Transparent fee on Free tier" },
  { value: "100%", label: "White-labeled client experience" },
] as const;

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100 antialiased">
      {/* Ambient backdrop glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute left-1/2 top-[-10rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute right-[-8rem] top-1/3 h-[28rem] w-[28rem] rounded-full bg-indigo-500/10 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(99,102,241,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,0.08) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)",
          }}
        />
      </div>

      {/* Nav */}
      <header className="relative z-20 mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
            <LockboxLogoIcon className="h-4 w-4" />
          </span>
          <span className="text-base">CiteFlow</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/auth/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
          >
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-200"
          >
            Get Started Free
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 pb-16 pt-16 text-center sm:px-8 sm:pt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200 backdrop-blur">
          <SparklesIcon className="h-3.5 w-3.5" />
          Built for high-ticket digital marketing & GEO/SEO specialists
        </div>

        <h1 className="mt-7 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Secure Your Deliverables.{" "}
          <span className="bg-gradient-to-r from-indigo-300 via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
            Accelerate Client Payments.
          </span>
        </h1>

        <p className="mt-6 max-w-3xl text-base leading-relaxed text-slate-300 sm:text-lg">
          The white-labeled client portal built for high-ticket
          digital marketing & GEO/SEO specialists. Automate invoice
          reminders, protect your proof-of-work, and show every fee clearly
          before the client pays.
        </p>

        <div className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:w-auto">
          <Link
            href="/auth/sign-up"
            className="group relative inline-flex w-full items-center justify-center overflow-hidden rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 sm:w-auto"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            Get Started Free
          </Link>
          <Link
            href="/auth/login"
            className="inline-flex w-full items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/60 px-6 py-3 text-sm font-semibold text-slate-100 backdrop-blur transition hover:border-slate-500 hover:bg-slate-800/70 sm:w-auto"
          >
            Sign In
          </Link>
        </div>

        {/* Trust stat strip */}
        <div className="mt-14 grid w-full grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800/50 sm:grid-cols-3">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="bg-slate-950/70 px-5 py-5 text-left backdrop-blur"
            >
              <div className="text-2xl font-semibold tracking-tight text-white">
                {s.value}
              </div>
              <div className="mt-1 text-xs text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pain points / Core pillars grid */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Three pillars that protect your revenue
          </h2>
          <p className="mt-3 text-sm text-slate-400 sm:text-base">
            Every high-ticket deliverable deserves a delivery experience that
            matches its price tag.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <article
                key={p.title}
                className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur transition duration-300 hover:border-indigo-400/40"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-indigo-500/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {p.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Pricing matrix */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A pricing model engineered for both of you
          </h2>
          <p className="mt-3 text-sm text-slate-400 sm:text-base">
            Start free and pass a transparent fee to clients, or upgrade to
            Pro and keep every dollar.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {TIERS.map((tier) => (
            <article
              key={tier.name}
              className={
                "relative overflow-hidden rounded-2xl border p-7 backdrop-blur transition duration-300 " +
                (tier.accent
                  ? "border-indigo-400/50 bg-gradient-to-b from-indigo-500/10 to-slate-900/70 shadow-2xl shadow-indigo-500/20"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700")
              }
            >
              {tier.accent && (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_1px_0_0_rgba(129,140,248,0.35)]"
                  />
                  <div className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-200 ring-1 ring-inset ring-indigo-400/40">
                    <SparklesIcon className="h-3 w-3" /> Recommended
                  </div>
                </>
              )}

              <div className="relative">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  {tier.name}
                </h3>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-5xl font-semibold tracking-tight text-white">
                    {tier.price}
                  </span>
                  <span className="mb-2 text-sm text-slate-400">
                    {tier.cadence}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-400">{tier.tagline}</p>

                <Link
                  href={tier.cta.href}
                  className={
                    "mt-7 inline-flex w-full items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition " +
                    (tier.accent
                      ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400"
                      : "border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-500 hover:bg-slate-800/70")
                  }
                >
                  {tier.cta.label}
                </Link>

                <ul className="mt-7 space-y-3">
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-3 text-sm text-slate-300"
                    >
                      <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-500">
          <ShieldCheckIcon className="h-3.5 w-3.5" />
          Encrypted delivery · No card required to start · Cancel anytime
        </p>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mt-8 border-t border-slate-800/80 bg-slate-950/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:px-8">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
              <LockboxLogoIcon className="h-3 w-3" />
            </span>
            <span className="font-medium text-slate-400">
              CiteFlow
            </span>
          </div>
          <nav className="flex items-center gap-5">
            <Link
              href="/terms"
              className="transition hover:text-slate-200"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className="transition hover:text-slate-200"
            >
              Privacy Policy
            </Link>
          </nav>
          <p className="text-slate-500">
            © {new Date().getFullYear()} CiteFlow. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}

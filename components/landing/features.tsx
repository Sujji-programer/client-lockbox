import {
  Film,
  Cpu,
  Cloud,
  Zap,
  Lock,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: Film,
    badge: "Watermark Player",
    title: "Dynamic Unpaid Watermark Player",
    description:
      "Clients stream a fully-functional preview with your CiteFlow watermark burned in real-time. The moment payment lands, the watermark vanishes and 4K unlocks automatically.",
    accent: "cyan",
    tags: ["HLS streaming", "Real-time burn", "Auto-unlock"],
    large: true,
  },
  {
    icon: Cpu,
    badge: "AI Export",
    title: "AI Timeline-to-Marker Export",
    description:
      "Generate .XML and .EDL marker files from your edit directly to Premiere Pro and DaVinci Resolve with a single click.",
    accent: "violet",
    tags: [".XML / .EDL", "Premiere Pro", "DaVinci Resolve"],
    large: false,
  },
  {
    icon: Cloud,
    badge: "R2 Vault",
    title: "0% Egress Cloudflare R2 Vault",
    description:
      "All files land in Cloudflare R2 — zero egress fees, global CDN, and military-grade encryption at rest and in transit.",
    accent: "cyan",
    tags: ["Zero egress", "Global CDN", "AES-256"],
    large: false,
  },
  {
    icon: Zap,
    badge: "Stripe Connect",
    title: "Stripe Connect Instant Payouts",
    description:
      "Get paid directly to your bank or debit card in minutes via Stripe Connect. No third-party wallets, no manual transfers, no waiting.",
    accent: "violet",
    tags: ["Instant payouts", "Stripe Connect", "Global currencies"],
    large: false,
  },
] as const;

const accentMap = {
  cyan: {
    badge: "bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/25",
    icon: "bg-cyan-400/10 text-cyan-400 ring-1 ring-inset ring-cyan-400/20",
    tag: "bg-cyan-400/8 text-cyan-400/70 border border-cyan-400/15",
    glow: "bg-cyan-500/10",
    border: "hover:border-cyan-400/30",
  },
  violet: {
    badge: "bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/25",
    icon: "bg-violet-400/10 text-violet-400 ring-1 ring-inset ring-violet-400/20",
    tag: "bg-violet-400/8 text-violet-400/70 border border-violet-400/15",
    glow: "bg-violet-500/10",
    border: "hover:border-violet-400/30",
  },
};

export function LandingFeatures() {
  return (
    <section id="features" className="relative z-10 mx-auto w-full max-w-7xl px-5 py-24 sm:px-8">
      {/* Section header */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-4 py-1.5 text-xs font-medium text-violet-300">
          <Lock className="h-3 w-3" />
          Everything you need to get paid
        </div>
        <h2 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
          The payment protection stack{" "}
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
            built for video pros
          </span>
        </h2>
        <p className="mt-3 text-slate-400 sm:text-base leading-relaxed">
          Four interlocking systems that eliminate late payments, protect your
          creative output, and put more money in your pocket.
        </p>
      </div>

      {/* Features grid */}
      <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* Large card — watermark player */}
        {FEATURES.filter((f) => f.large).map((feat) => {
          const Icon = feat.icon;
          const a = accentMap[feat.accent];
          return (
            <article
              key={feat.title}
              className={`group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0D1220] p-7 transition duration-300 md:col-span-2 lg:col-span-1 ${a.border}`}
            >
              {/* Glow */}
              <div
                aria-hidden
                className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full ${a.glow} blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
              />

              <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${a.badge}`}>
                {feat.badge}
              </div>

              <div className={`mt-5 flex h-11 w-11 items-center justify-center rounded-xl ${a.icon}`}>
                <Icon className="h-5 w-5" />
              </div>

              <h3 className="mt-4 text-lg font-semibold text-white">{feat.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feat.description}</p>

              {/* Tags */}
              <div className="mt-5 flex flex-wrap gap-2">
                {feat.tags.map((t) => (
                  <span key={t} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${a.tag}`}>
                    {t}
                  </span>
                ))}
              </div>

              {/* Animated watermark preview */}
              <div className="mt-6 overflow-hidden rounded-xl border border-white/[0.06] bg-[#070B12] p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-medium text-slate-500">preview_final.mp4</span>
                  <span className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-400/25">
                    <Lock className="h-2.5 w-2.5" /> UNPAID
                  </span>
                </div>
                <div className="relative aspect-video rounded-lg bg-gradient-to-br from-slate-900 via-slate-950 to-violet-950/40 overflow-hidden">
                  <div
                    className="absolute inset-0 flex items-center justify-center opacity-20 select-none pointer-events-none"
                    style={{ transform: "rotate(-15deg)" }}
                  >
                    <span className="text-lg font-black uppercase tracking-widest text-white whitespace-nowrap">
                      CITEFLOW WATERMARK
                    </span>
                  </div>
                  <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5">
                    <span className="text-[10px] text-slate-400">Preview • 720p</span>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {/* Smaller feature cards */}
        {FEATURES.filter((f) => !f.large).map((feat) => {
          const Icon = feat.icon;
          const a = accentMap[feat.accent];
          return (
            <article
              key={feat.title}
              className={`group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0D1220] p-6 transition duration-300 ${a.border}`}
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full ${a.glow} blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
              />

              <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${a.badge}`}>
                {feat.badge}
              </div>

              <div className={`mt-5 flex h-11 w-11 items-center justify-center rounded-xl ${a.icon}`}>
                <Icon className="h-5 w-5" />
              </div>

              <h3 className="mt-4 text-base font-semibold text-white">{feat.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feat.description}</p>

              <div className="mt-5 flex flex-wrap gap-2">
                {feat.tags.map((t) => (
                  <span key={t} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${a.tag}`}>
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-1 text-xs font-medium text-slate-500 transition group-hover:text-slate-300">
                Learn more <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

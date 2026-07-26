import Link from "next/link";
import { ArrowRight, Play, Lock } from "lucide-react";

export function LandingHero() {
  return (
    <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-5 pb-20 pt-36 text-center sm:px-8 sm:pt-44">

      {/* Announcement pill */}
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-1.5 text-xs font-medium text-cyan-300 backdrop-blur">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
        Built for freelance video editors & motion designers
      </div>

      {/* Headline */}
      <h1 className="mt-7 max-w-4xl text-balance text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
        Never Get Ghosted on a{" "}
        <span
          className="bg-gradient-to-r from-cyan-400 via-cyan-300 to-violet-400 bg-clip-text text-transparent"
        >
          Final Video Payment
        </span>{" "}
        Again.
      </h1>

      {/* Subheadline */}
      <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg">
        Send watermarked streaming previews with instant payment-locked 4K
        deliverable unlocks. Your footage stays safe until the invoice clears.
      </p>

      {/* CTAs */}
      <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:w-auto">
        <Link
          href="/auth"
          className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 px-7 py-3.5 text-sm font-bold text-slate-950 shadow-xl shadow-cyan-500/30 transition hover:shadow-cyan-500/50 sm:w-auto"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          Start Protecting Invoices Free
          <ArrowRight className="h-4 w-4" />
        </Link>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/50 px-7 py-3.5 text-sm font-semibold text-slate-100 backdrop-blur transition hover:border-slate-500 hover:bg-slate-800/60 sm:w-auto"
        >
          <Play className="h-4 w-4 text-cyan-400" />
          Watch 90-sec demo
        </button>
      </div>

      {/* Social proof */}
      <p className="mt-6 text-xs text-slate-500">
        No credit card required · Cancel anytime · Razorpay Escrow secured
      </p>

      {/* Video preview mockup */}
      <div className="relative mt-16 w-full max-w-4xl">
        {/* Outer glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-2xl opacity-60"
          style={{
            background:
              "linear-gradient(135deg, rgba(6,182,212,0.3) 0%, rgba(139,92,246,0.2) 50%, transparent 100%)",
            filter: "blur(1px)",
          }}
        />

        {/* Card shell */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D1220] shadow-2xl shadow-black/60">

          {/* Editor toolbar */}
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0A0F1A] px-4 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
            <div className="mx-3 h-5 w-px bg-white/10" />
            <span className="text-xs font-medium text-slate-500">
              CiteFlow — client_preview_v3_FINAL.mp4
            </span>
            <div className="ml-auto flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1 ring-1 ring-inset ring-amber-400/30">
              <Lock className="h-3 w-3 text-amber-400" />
              <span className="text-[11px] font-semibold text-amber-300">
                PAYMENT REQUIRED TO UNLOCK 4K
              </span>
            </div>
          </div>

          {/* Video area */}
          <div className="relative bg-[#070B12]">
            {/* 16:9 placeholder */}
            <div className="aspect-video w-full relative overflow-hidden">
              {/* Grid overlay */}
              <div
                aria-hidden
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(6,182,212,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(6,182,212,0.15) 1px, transparent 1px)",
                  backgroundSize: "48px 48px",
                }}
              />
              {/* Gradient hero image stand-in */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/30 via-slate-950 to-violet-900/30" />
                {/* Watermark text overlay */}
                <div
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(-45deg, transparent, transparent 80px, rgba(255,255,255,0.02) 80px, rgba(255,255,255,0.02) 81px)",
                  }}
                >
                  <div
                    className="text-center select-none pointer-events-none"
                    style={{ transform: "rotate(-20deg)", opacity: 0.12 }}
                  >
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="text-2xl font-bold uppercase tracking-widest text-white whitespace-nowrap py-6"
                      >
                        UNPAID · CITEFLOW WATERMARK · UNPAID · CITEFLOW WATERMARK
                      </div>
                    ))}
                  </div>
                </div>
                {/* Play button */}
                <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur">
                  <Play className="h-7 w-7 translate-x-0.5 text-white" />
                </div>
              </div>
            </div>

            {/* Timeline bar */}
            <div className="border-t border-white/[0.06] bg-[#0A0F1A] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">0:00</span>
                <div className="relative flex-1 h-1.5 rounded-full bg-slate-800">
                  <div className="absolute left-0 h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400" />
                  <div className="absolute left-1/3 -translate-x-1/2 -top-1 h-3.5 w-3.5 rounded-full border-2 border-cyan-400 bg-[#0A0F1A]" />
                  {/* Marker bars */}
                  {[18, 35, 55, 72, 88].map((pos) => (
                    <div
                      key={pos}
                      className="absolute top-1/2 -translate-y-1/2 h-3 w-px bg-violet-400/60"
                      style={{ left: `${pos}%` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-slate-500">2:34</span>
                {/* Lock icon over remaining */}
                <div className="flex items-center gap-1.5 rounded-md bg-slate-800/80 px-2 py-1">
                  <Lock className="h-3 w-3 text-cyan-400" />
                  <span className="text-[11px] text-slate-400">4K locked</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating badge — payment lock */}
        <div className="absolute -right-4 top-16 hidden lg:flex items-center gap-2.5 rounded-xl border border-cyan-400/20 bg-[#0D1B26]/90 px-4 py-3 shadow-xl backdrop-blur">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 ring-1 ring-cyan-400/30">
            <Lock className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-white">4K File Locked</p>
            <p className="text-[11px] text-slate-400">Unlocks on payment</p>
          </div>
        </div>

        {/* Floating badge — payout */}
        <div className="absolute -left-4 bottom-20 hidden lg:flex items-center gap-2.5 rounded-xl border border-violet-400/20 bg-[#130D26]/90 px-4 py-3 shadow-xl backdrop-blur">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-400/15 ring-1 ring-violet-400/30">
            <span className="text-sm">💸</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-white">+₹2,64,000 paid out</p>
            <p className="text-[11px] text-slate-400">via Razorpay Escrow</p>
          </div>
        </div>
      </div>
    </section>
  );
}

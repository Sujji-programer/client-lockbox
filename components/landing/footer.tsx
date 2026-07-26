import Link from "next/link";
import { Film, ArrowRight } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="relative z-10 border-t border-white/[0.06] bg-[#070A12]">
      {/* CTA banner */}
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#0D1A26] to-[#0D1220] p-10 text-center">
          {/* Background glows */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/4 top-0 h-40 w-40 -translate-x-1/2 rounded-full bg-cyan-500/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-1/4 bottom-0 h-40 w-40 translate-x-1/2 rounded-full bg-violet-500/15 blur-3xl"
          />
          <div className="relative">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl text-balance">
              Stop chasing payments. Start delivering with confidence.
            </h2>
            <p className="mt-3 text-sm text-slate-400">
              Join thousands of freelance video editors and motion designers protecting their work with CiteFlow.
            </p>
            <Link
              href="/auth"
              className="group mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 px-7 py-3.5 text-sm font-bold text-slate-950 shadow-xl shadow-cyan-500/30 transition hover:shadow-cyan-500/50"
            >
              Start Protecting Invoices Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <p className="mt-4 text-xs text-slate-600">
              No credit card required · 10% fee on Free · 0% fee on Pro
            </p>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/[0.05]">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-5 px-5 py-7 text-xs text-slate-600 sm:flex-row sm:px-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-inset ring-cyan-400/25">
              <Film className="h-3.5 w-3.5 text-cyan-400" />
            </span>
            <span className="font-semibold text-slate-400">
              Cite<span className="text-cyan-400">Flow</span>
            </span>
          </Link>

          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="/terms" className="transition hover:text-slate-300">
              Terms of Service
            </Link>
            <Link href="/privacy" className="transition hover:text-slate-300">
              Privacy Policy
            </Link>
            <a href="#features" className="transition hover:text-slate-300">
              Features
            </a>
            <a href="#pricing" className="transition hover:text-slate-300">
              Pricing
            </a>
          </nav>

          <p className="text-slate-600">
            &copy; {new Date().getFullYear()} CiteFlow. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

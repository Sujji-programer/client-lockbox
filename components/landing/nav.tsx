import Link from "next/link";
import { Film } from "lucide-react";

export function LandingNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#090D16]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-violet-500/20 ring-1 ring-inset ring-cyan-400/30">
            <Film className="h-4 w-4 text-cyan-400" />
          </span>
          <span className="text-base font-semibold tracking-tight text-white">
            Cite<span className="text-cyan-400">Flow</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a href="#features" className="transition hover:text-white">Features</a>
          <a href="#pricing" className="transition hover:text-white">Pricing</a>
          <a href="#trust" className="transition hover:text-white">Security</a>
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
          >
            Sign In
          </Link>
          <Link
            href="/auth"
            className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:shadow-cyan-500/40"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            Get Started Free
          </Link>
        </div>
      </div>
    </header>
  );
}

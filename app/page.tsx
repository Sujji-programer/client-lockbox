import { LandingNav } from "@/components/landing/nav";
import { LandingHero } from "@/components/landing/hero";
import { LandingFeatures } from "@/components/landing/features";
import { LandingPricing } from "@/components/landing/pricing";
import { LandingTrust } from "@/components/landing/trust";
import { LandingFooter } from "@/components/landing/footer";

/**
 * CiteFlow — public marketing landing page.
 *
 * Dark-themed high-converting SaaS page targeting freelance video editors,
 * motion designers, and agency creators. Deep slate/black (#090D16), glowing
 * cyan/purple accents, glassmorphism cards, timeline imagery.
 * Server component — no client state.
 */
export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#090D16] text-slate-100 antialiased">
      {/* ── Ambient background ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* Top center cyan glow */}
        <div className="absolute left-1/2 top-[-6rem] h-[40rem] w-[70rem] -translate-x-1/2 rounded-full bg-cyan-600/[0.07] blur-[120px]" />
        {/* Top right violet */}
        <div className="absolute right-[-12rem] top-[-4rem] h-[32rem] w-[32rem] rounded-full bg-violet-600/[0.06] blur-[100px]" />
        {/* Bottom left cyan */}
        <div className="absolute left-[-10rem] bottom-[10rem] h-[28rem] w-[28rem] rounded-full bg-cyan-500/[0.05] blur-[90px]" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(6,182,212,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(6,182,212,0.12) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse 100% 70% at 50% 0%, #000 30%, transparent 100%)",
          }}
        />
      </div>

      {/* ── Sections ── */}
      <LandingNav />
      <LandingHero />
      <LandingFeatures />
      <LandingPricing />
      <LandingTrust />
      <LandingFooter />
    </main>
  );
}

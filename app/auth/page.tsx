"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MailIcon,
  ArrowRightIcon,
  FilmIcon,
  ShieldCheckIcon,
  LockIcon,
  BadgeCheckIcon,
} from "@/components/icons";

// ---------------------------------------------------------------------------
// Auth Page — /auth
// Unified glassmorphic card: "Continue with Google" + "Send Magic Link"
// ---------------------------------------------------------------------------

export default function AuthPage() {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;
    setLoading(true);
    // Simulate sending — in production wire to supabase.auth.signInWithOtp
    await new Promise((r) => setTimeout(r, 1200));
    setMagicSent(true);
    setLoading(false);
  };

  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-4 py-12"
      style={{ background: "#090D16" }}
    >
      {/* Background grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,229,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.6) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Glow orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(0,229,255,0.15) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 right-1/4 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)" }}
      />

      {/* Brand mark */}
      <Link href="/" className="mb-8 flex items-center gap-2.5 text-white no-underline">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl"
          style={{ background: "linear-gradient(135deg,#00E5FF 0%,#7C3AED 100%)" }}
        >
          <FilmIcon className="h-5 w-5 text-white" />
        </span>
        <span className="text-xl font-bold tracking-tight">
          Cite<span style={{ color: "#00E5FF" }}>Flow</span>
        </span>
      </Link>

      {/* Glassmorphic card */}
      <div
        className="relative w-full max-w-md rounded-2xl border p-8 shadow-2xl"
        style={{
          background: "rgba(255,255,255,0.04)",
          borderColor: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 0 60px rgba(0,229,255,0.06), 0 24px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Tab switcher */}
        <div
          className="mb-7 flex rounded-xl p-1"
          style={{ background: "rgba(255,255,255,0.05)" }}
          role="tablist"
          aria-label="Sign in or sign up"
        >
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => { setTab(t); setMagicSent(false); setEmail(""); }}
              className="flex-1 rounded-lg py-2 text-sm font-semibold transition-all duration-200"
              style={
                tab === t
                  ? {
                      background: "rgba(0,229,255,0.12)",
                      color: "#00E5FF",
                      boxShadow: "inset 0 0 0 1px rgba(0,229,255,0.25)",
                    }
                  : { color: "rgba(255,255,255,0.45)" }
              }
            >
              {t === "signin" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* Headline */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">
            {tab === "signin" ? "Welcome back" : "Start protecting invoices"}
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
            {tab === "signin"
              ? "Access your CiteFlow editor dashboard."
              : "Free forever. No credit card required."}
          </p>
        </div>

        {magicSent ? (
          /* ── Magic link sent state ── */
          <div
            className="flex flex-col items-center gap-3 rounded-xl py-8 text-center"
            style={{ border: "1px solid rgba(0,229,255,0.2)", background: "rgba(0,229,255,0.05)" }}
          >
            <span
              className="grid h-12 w-12 place-items-center rounded-full"
              style={{ background: "rgba(0,229,255,0.15)" }}
            >
              <MailIcon className="h-6 w-6" style={{ color: "#00E5FF" }} />
            </span>
            <p className="text-sm font-semibold text-white">Check your inbox</p>
            <p className="max-w-xs text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              We sent a magic link to <strong className="text-white">{email}</strong>. Click it to sign in — no password needed.
            </p>
            <button
              onClick={() => setMagicSent(false)}
              className="mt-2 text-xs underline underline-offset-4"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              Resend or use a different email
            </button>
          </div>
        ) : (
          <>
            {/* Continue with Google */}
            <button
              type="button"
              className="group mb-4 flex w-full items-center justify-center gap-3 rounded-xl py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-px"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "white",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
              }}
            >
              {/* Google G */}
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.08)" }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>or continue with email</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* Magic link form */}
            <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="auth-email" className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
                  Work email
                </label>
                <div className="relative">
                  <MailIcon
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@studio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 outline-none transition-all"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.10)",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,229,255,0.4)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="group mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all duration-200 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg,#00E5FF 0%,#0099AA 100%)",
                  color: "#090D16",
                  boxShadow: "0 4px 20px rgba(0,229,255,0.25)",
                }}
              >
                {loading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#090D16]/30 border-t-[#090D16]" />
                ) : (
                  <>
                    Send Magic Link
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          </>
        )}

        {/* Trust footer */}
        <div className="mt-7 flex items-center justify-center gap-4 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          <span className="flex items-center gap-1">
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            AES-256 encrypted
          </span>
          <span className="h-3 w-px" style={{ background: "rgba(255,255,255,0.12)" }} />
          <span className="flex items-center gap-1">
            <LockIcon className="h-3.5 w-3.5" />
            No passwords stored
          </span>
          <span className="h-3 w-px" style={{ background: "rgba(255,255,255,0.12)" }} />
          <span className="flex items-center gap-1">
            <BadgeCheckIcon className="h-3.5 w-3.5" />
            SOC 2 ready
          </span>
        </div>
      </div>

      {/* Bottom note */}
      <p className="mt-6 text-center text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
        By continuing you agree to CiteFlow&apos;s{" "}
        <Link href="#" className="underline underline-offset-4 hover:text-white/60 transition-colors">Terms</Link>
        {" & "}
        <Link href="#" className="underline underline-offset-4 hover:text-white/60 transition-colors">Privacy</Link>.
      </p>
    </div>
  );
}

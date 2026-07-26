"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FilmIcon,
  LogOutIcon,
  SparklesIcon,
  BanknoteIcon,
  BadgeCheckIcon,
  UserIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { useState } from "react";

type PlanType = "FREE" | "PRO";

/**
 * Top navigation bar for the CiteFlow authenticated dashboard.
 * Dark glassmorphic header with Razorpay Bank Payouts badge.
 */
export function DashboardNav({
  email,
  planType,
  userId,
}: {
  email: string;
  planType: PlanType;
  userId: string;
}) {
  void userId;
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth");
    router.refresh();
  };

  const initials = email
    ? email.slice(0, 2).toUpperCase()
    : "CF";

  return (
    <header
      className="sticky top-0 z-40 w-full border-b"
      style={{
        background: "rgba(9,13,22,0.85)",
        borderColor: "rgba(255,255,255,0.07)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Brand */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 no-underline"
        >
          <span
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: "linear-gradient(135deg,#00E5FF 0%,#7C3AED 100%)" }}
          >
            <FilmIcon className="h-4.5 w-4.5 text-white" />
          </span>
          <span className="text-base font-bold tracking-tight text-white">
            Cite<span style={{ color: "#00E5FF" }}>Flow</span>
          </span>
        </Link>

        {/* Right-side controls */}
        <div className="flex items-center gap-2.5">
          {/* Plan badge */}
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex",
              planType === "PRO"
                ? "border-cyan-500/30 text-cyan-300"
                : "border-white/10 text-white/50",
            )}
            style={
              planType === "PRO"
                ? { background: "rgba(0,229,255,0.08)" }
                : { background: "rgba(255,255,255,0.05)" }
            }
          >
            <SparklesIcon className="h-3 w-3" />
            {planType === "PRO" ? "Pro Tier — 0% Fee" : "Free Tier — 10% Fee"}
          </span>

          {/* Razorpay badge */}
          <span
            className="hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex"
            style={{
              borderColor: "rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.65)",
            }}
          >
            <BanknoteIcon className="h-3.5 w-3.5" style={{ color: "#06B6D4" }} />
            Razorpay Bank Payouts:
            <BadgeCheckIcon className="h-3.5 w-3.5" style={{ color: "#22C55E" }} />
            <span style={{ color: "#22C55E" }}>Verified</span>
          </span>

          {/* Avatar chip */}
          <div
            className="flex items-center gap-2 rounded-full border px-2.5 py-1.5"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <span
              className="grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg,#00E5FF 0%,#7C3AED 100%)" }}
              aria-hidden="true"
            >
              {initials}
            </span>
            <span
              className="hidden max-w-[160px] truncate text-xs font-medium sm:block"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {email}
            </span>
            <UserIcon className="h-3.5 w-3.5 sm:hidden" style={{ color: "rgba(255,255,255,0.4)" }} />
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all duration-150 disabled:opacity-50",
              "hover:border-white/20 hover:text-white",
            )}
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            {signingOut ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            ) : (
              <LogOutIcon className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {signingOut ? "Signing out" : "Sign out"}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

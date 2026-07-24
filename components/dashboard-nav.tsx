"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LockboxLogoIcon,
  LogOutIcon,
  UserIcon,
  SparklesIcon,
  ZapIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

type PlanType = "FREE" | "PRO";

type StripeAccountStatus = "PENDING" | "RESTRICTED" | "ENABLED" | "NONE";

/**
 * Top navigation bar for the authenticated freelancer dashboard.
 *
 * Premium aesthetic: slim, frosted-glass header pinned to the top, brand
 * mark on the left, account chip + plan badge + sign-out on the right.
 *
 * `userId` / `email` / `planType` are passed down from the server layout so
 * the navbar can render instantly without a second round-trip.
 */
export function DashboardNav({
  email,
  planType,
  userId,
  stripeAccountStatus,
  stripeAccountId,
}: {
  email: string;
  planType: PlanType;
  userId: string;
  stripeAccountStatus?: StripeAccountStatus;
  stripeAccountId?: string | null;
}) {
  void userId;
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<StripeAccountStatus>(
    stripeAccountStatus ?? "NONE",
  );

  // After Stripe Connect bounces the user back to /dashboard?stripe_connect=…
  // pull the canonical status from Stripe so the pill flips green once
  // charges are actually enabled.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeParam = params.get("stripe_connect");
    if (stripeParam === "returned" || stripeParam === "refresh") {
      fetch("/api/stripe/refresh", { method: "GET" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.status) setStripeStatus(data.status);
        })
        .catch(() => {})
        .finally(() => {
          // Stripe the URL so a refresh doesn't re-fire the lookup.
          const clean = window.location.pathname + window.location.hash;
          window.history.replaceState({}, "", clean);
          router.refresh();
        });
    }
  }, [router]);

  const handleStripeOnboard = useCallback(async () => {
    if (onboarding) return;
    setOnboarding(true);
    try {
      const res = await fetch("/api/stripe/onboard", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Onboarding failed.");
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      setOnboarding(false);
      // soft fallback: refresh the page so user can re-attempt
    }
  }, [onboarding]);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 font-semibold tracking-tight text-slate-900 dark:text-slate-50"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
            <LockboxLogoIcon className="h-5 w-5" />
          </span>
          <span className="text-base">
            Cite<span className="text-indigo-600">Flow</span>
          </span>
        </Link>

        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
              planType === "PRO"
                ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            <SparklesIcon className="h-3 w-3" />
            {planType === "PRO" ? "Pro tier" : "Free tier"}
          </span>

          {/* Stripe Connect pill + one-click onboard button */}
          {stripeStatus === "ENABLED" ? (
            <span
              title={`Stripe account ${stripeAccountId ?? ""}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Stripe connected
            </span>
          ) : (
            <button
              type="button"
              onClick={handleStripeOnboard}
              disabled={onboarding}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20",
                onboarding && "cursor-wait",
              )}
              title={
                stripeStatus === "RESTRICTED"
                  ? "Stripe account is restricted — finish verification"
                  : stripeStatus === "PENDING"
                    ? "Continue Stripe onboarding"
                    : "Connect Stripe to receive client payments"
              }
            >
              {onboarding ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
              ) : (
                <ZapIcon className="h-3 w-3" />
              )}
              {stripeStatus === "RESTRICTED"
                ? "Verify Stripe"
                : stripeStatus === "PENDING"
                  ? "Finish Stripe"
                  : "Connect Stripe"}
            </button>
          )}

          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <UserIcon className="h-3.5 w-3.5 text-slate-400" />
            <span className="max-w-[180px] truncate">{email}</span>
          </div>

          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
              signingOut && "cursor-wait",
            )}
          >
            {signingOut ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
            ) : (
              <LogOutIcon className="h-3.5 w-3.5" />
            )}
            {signingOut ? "Signing out" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}

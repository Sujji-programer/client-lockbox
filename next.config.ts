import type { NextConfig } from "next";

// cacheComponents is intentionally disabled: this app's routes are inherently
// per-request (auth-gated dashboard + signed-URL minting on /share), so static
// prerendering would force dynamic access into <Suspense> shells that don't
// make sense for an auth guard. Plain on-demand rendering keeps the original
// `force-dynamic`-style semantics the Phase 1-3 routes were authored against.
const nextConfig: NextConfig = {};

export default nextConfig;
/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

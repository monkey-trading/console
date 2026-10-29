/** Next.js configuration: security headers, the geo-block rewrite, and static-rendering options. */

import type { NextConfig } from "next";

import { geoBlockRewrites } from "./src/lib/geo-block";

const isDev = process.env.NODE_ENV === "development";

// The page is statically rendered, so its inline bootstrap scripts cannot carry a nonce; the policy
// allows inline scripts and styles but nothing from another origin. Dev mode also needs eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The console is not for search indexes; the root layout sets the matching robots meta tag.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  // Keep `next dev` from writing its own block into the curated AGENTS.md.
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Matched before files, at the edge, so a blocked visitor is served the restricted page alone.
  async rewrites() {
    return { beforeFiles: geoBlockRewrites() };
  },
};

export default nextConfig;

/** Next.js configuration: security headers, the geo-block rewrite, and static-rendering options. */

import type { NextConfig } from "next";

import { parseDeploy, rawDeploy, streamOrigin, WALLETCONNECT_RELAY } from "./src/lib/engine/deploy";
import { geoBlockRewrites } from "./src/lib/geo-block";

const isDev = process.env.NODE_ENV === "development";
const deploy = parseDeploy(rawDeploy());
// The engine node's origin is the one cross-origin destination, with its wss: stream; a live build also loads the verifier's WebAssembly.
const nodeOrigins = deploy.origin === null ? [] : [deploy.origin, streamOrigin(deploy.origin)];
// A build with a WalletConnect project id also reaches WalletConnect's relay, and nothing else of WalletConnect's (monkey-trading/console#7).
const relayOrigins = deploy.walletConnectProjectId === null ? [] : [WALLETCONNECT_RELAY];

// The page is statically rendered, so its inline bootstrap scripts cannot carry a nonce; the policy
// allows inline scripts and styles but nothing from another origin but the pinned node's and the relay. Dev mode also needs eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${deploy.origin === null ? "" : " 'wasm-unsafe-eval'"}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  ["connect-src 'self'", ...nodeOrigins, ...relayOrigins].join(" "),
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

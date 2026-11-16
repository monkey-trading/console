/** The root layout: fonts, metadata, and the viewport. */

import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteUrl } from "@/lib/site";

import "./globals.css";

// Shipped with the console (Geist Mono, SIL OFL 1.1, `fonts/OFL.txt`), so no build or page load reaches Google Fonts.
const mono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  // Metric-compatible while the font loads: Geist Mono and these are all 0.6 em wide per character, so a line wraps the same before and after the swap. Next's own fallback is Arial scaled to its average width, which does not.
  adjustFontFallback: false,
  fallback: ["Courier New", "Menlo", "Liberation Mono", "ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: false, follow: false },
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: SITE_NAME, title: SITE_TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = {
  // `--color-ink`, the page background.
  themeColor: "#050607",
  colorScheme: "dark",
};

/** The document shell around every page. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Browser extensions (a password manager's, for one) set attributes on <html> before hydration.
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

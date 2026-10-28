/** The root layout: fonts, metadata, and the viewport. */

import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteUrl } from "@/lib/site";

import "./globals.css";

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
};

export const viewport: Viewport = {
  // `--color-ink`, the page background.
  themeColor: "#050607",
  colorScheme: "dark",
};

/** The document shell around every page. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

"use client";

/** The terminal's frame: one full view with a slim top strip, the workspace, and a risk line. */

import type { ReactNode } from "react";

import { AccessGate } from "./AccessGate";
import { AttestationBanner } from "./AttestationBanner";
import { FundingDrawer } from "./FundingDrawer";
import { RiskStrip } from "./RiskStrip";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";

/** Fills the viewport on large screens and scrolls as one page on small ones. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-1 lg:h-dvh lg:overflow-hidden">
      <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded focus-visible:border focus-visible:border-glow focus-visible:bg-ink focus-visible:px-3 focus-visible:py-2 focus-visible:text-caption">
        Skip to content
      </a>
      <TopBar />
      <AttestationBanner />
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        <AccessGate>{children}</AccessGate>
      </main>
      <RiskStrip />
      <FundingDrawer />
      <Toasts />
    </div>
  );
}

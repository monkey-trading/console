/** The terminal's frame: one full view with a slim top strip, the workspace, and a risk line. */

import type { ReactNode } from "react";

import { AccessGate } from "./AccessGate";
import { AttestationBanner } from "./AttestationBanner";
import { ExitNotice } from "./ExitNotice";
import { PageNotices } from "./PageNotices";
import { RiskStrip } from "./RiskStrip";
import { SetupDialog } from "./SetupDialog";
import { TopBar } from "./TopBar";
import { WalletConnectPairing } from "./WalletConnectPairing";

/** Fills the viewport on large screens and scrolls as one page on small ones. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-1 max-lg:has-[[data-phone-nav]]:pb-(--bar-height,var(--spacing-bar)) lg:h-dvh lg:overflow-hidden">
      <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded focus-visible:border focus-visible:border-glow focus-visible:bg-ink focus-visible:px-3 focus-visible:py-2 focus-visible:text-caption">
        Skip to content
      </a>
      <TopBar />
      <AttestationBanner />
      <PageNotices />
      <ExitNotice />
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        <AccessGate>{children}</AccessGate>
      </main>
      <RiskStrip />
      <WalletConnectPairing />
      <SetupDialog />
    </div>
  );
}

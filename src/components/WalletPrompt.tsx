"use client";

/** While the wallet waits for the user, says what it was asked to sign or send; over the page, or inside the funding drawer while it is open. */

import { useConsole } from "./ConsoleProvider";

/** `inDrawer` places it in the funding drawer, which shows it while open; the page's copy shows it otherwise. */
export function WalletPrompt({ inDrawer }: { inDrawer: boolean }) {
  const { prompt, fundingOpen } = useConsole();
  const shown = prompt !== null && fundingOpen === inDrawer ? prompt : null;
  const place = inDrawer ? "" : "fixed inset-x-4 bottom-[calc(var(--bar-height,var(--spacing-bar))+1rem)] z-40 mx-auto max-w-md lg:bottom-12";
  return (
    <div role="status" className={place}>
      {shown !== null && <p className="rounded border border-amber/60 bg-ink-2 px-3 py-3 text-caption text-amber shadow-platform">{shown}</p>}
    </div>
  );
}

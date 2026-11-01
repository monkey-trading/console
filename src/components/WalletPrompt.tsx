"use client";

/** While the wallet waits for the user, says what it was asked to sign or send, over the page. */

import { useConsole } from "./ConsoleProvider";

export function WalletPrompt() {
  const { prompt } = useConsole();
  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(var(--bar-height,var(--spacing-bar))+1rem)] z-40 mx-auto max-w-md lg:bottom-12">
      {prompt !== null && <p className="rounded border border-amber/60 bg-ink-2 px-3 py-3 text-caption text-amber shadow-platform">{prompt}</p>}
    </div>
  );
}

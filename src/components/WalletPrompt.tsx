"use client";

/** The screen-reader status of what the wallet was asked to sign or send; `Toasts` shows the same text over the page. */

import { useConsole } from "./ConsoleProvider";

export function WalletPrompt() {
  const { prompt } = useConsole();
  return <div role="status" className="sr-only">{prompt}</div>;
}

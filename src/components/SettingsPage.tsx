"use client";

/** The settings page: the trading preferences kept in this browser, then the account's active sessions. */

import Link from "next/link";

import { PreferencesCard } from "./PreferencesCard";
import { SessionsCard } from "./SessionsCard";

/** Settings screen; the console's layout supplies the provider, the access gate and the shell. */
export function SettingsPage() {
  return (
    // Keyboard scrolling needs a tab stop on the scroll container, as on the House page.
    <div role="region" aria-label="Settings details" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lead tracking-caps text-glow uppercase">Settings</h2>
          <Link href="/" className="inline-flex min-h-11 items-center text-caption text-fg-2 underline hover:text-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0">Back to trading</Link>
        </div>
        <PreferencesCard />
        <SessionsCard />
      </div>
    </div>
  );
}

"use client";

/** The one line every other page shows when the account's exit needs the trader; the Funding page has the panel itself. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isCurrentPage } from "@/lib/nav";
import { exitView } from "@/lib/store/exit-view";

import { useConsoleValue } from "./ConsoleProvider";

const LINE = "border-b px-4 py-1 text-center text-label";
const TONE = { calm: `${LINE} border-line text-fg-3`, warn: `${LINE} border-amber/40 bg-amber/10 text-amber`, bad: `${LINE} border-ember/50 bg-ember/10 text-ember` } as const;

export function ExitNotice() {
  const exit = useConsoleValue((state) => state.exit);
  const wallet = useConsoleValue((state) => state.wallet);
  const pathname = usePathname();
  const { notice } = exitView(exit, wallet);
  if (notice === null || isCurrentPage(pathname, "/funding")) return null;
  return (
    <div role="status" className={TONE[notice.tone]}>
      {notice.text} <Link href="/funding" className="underline focus-visible:outline-2 focus-visible:outline-glow">See Funding</Link>
    </div>
  );
}

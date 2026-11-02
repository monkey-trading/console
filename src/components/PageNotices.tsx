"use client";

/** What happened to the account or the node that no control caused: a slim row under the node's banner, in the page's flow, until the user dismisses it. The account's is also dropped with a change of wallet. */

import type { Notice, NoticeSurface } from "@/lib/store/state";

import { useConsole, useSession } from "./ConsoleProvider";

const SURFACES: readonly NoticeSurface[] = ["account", "node"];
const LINE = "border-b px-4 py-1 text-center text-label";
const TONE = { error: `${LINE} border-ember/50 bg-ember/10 text-ember`, info: `${LINE} border-amber/40 bg-amber/10 text-amber` } as const;

/** The notices of `SURFACES` with this tone, each with the button that dismisses it. */
function Rows({ tone }: { tone: Notice["tone"] }) {
  const { notices } = useConsole();
  const { store } = useSession();
  return SURFACES.map((surface) => {
    const notice = notices[surface];
    if (notice === undefined || notice.tone !== tone) return null;
    return (
      <div key={`${surface}-${notice.id}`} className={TONE[tone]}>
        {notice.text}
        <button type="button" onClick={() => { store.clearNotice(surface); document.getElementById("main")?.focus(); }} className="ml-2 min-h-6 rounded border border-current px-1.5 hover:bg-fg/10 focus-visible:outline-2 focus-visible:outline-glow">Dismiss<span className="sr-only"> this notice</span></button>
      </div>
    );
  });
}

/** Both live regions stay mounted, so a notice that arrives is announced. */
export function PageNotices() {
  return (
    <section aria-label="Notices">
      <div role="status" className="empty:hidden"><Rows tone="info" /></div>
      <div role="alert" className="empty:hidden"><Rows tone="error" /></div>
    </section>
  );
}

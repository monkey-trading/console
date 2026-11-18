"use client";

/** What happened to the account or the node that no control caused: a slim row under the node's banner, in the page's flow, until the user dismisses it. The account's is also dropped with a change of wallet. Above them, the operator's status notice, which stays until the operator clears it and which nothing here dismisses. */

import type { Notice, NoticeSurface } from "@/lib/store/state";

import { useConsole, useSession } from "./ConsoleProvider";

const SURFACES: readonly NoticeSurface[] = ["account", "node"];
const LINE = "border-b px-4 py-1 text-center text-label";
const TONE = { error: `${LINE} border-ember/50 bg-ember/10 text-ember`, info: `${LINE} border-amber/40 bg-amber/10 text-amber` } as const;

/** The notices of `SURFACES` with this tone, each with the button that dismisses it. */
function Rows({ tone }: { tone: Notice["tone"] }) {
  const { notices } = useConsole();
  const { store, announcer } = useSession();
  return SURFACES.map((surface) => {
    const notice = notices[surface];
    if (notice === undefined || notice.tone !== tone) return null;
    return (
      <div key={`${surface}-${notice.id}`} className={TONE[tone]}>
        {notice.text}
        <button type="button" onClick={() => {
          if (surface === "node") announcer.dismissShowing(); // a dismissed move notice stays dismissed for that move
          store.clearNotice(surface);
          document.getElementById("main")?.focus();
        }} className="ml-2 min-h-6 rounded border border-current px-1.5 hover:bg-fg/10 focus-visible:outline-2 focus-visible:outline-glow">Dismiss<span className="sr-only"> this notice</span></button>
      </div>
    );
  });
}

/** The operator's status notice, in the operator's own words after a sentence saying whose they are. */
function OperatorNotice() {
  const { notice } = useConsole();
  if (notice === null) return null;
  return <div className={`${LINE} border-amber/40 bg-amber/10 text-amber`}><strong className="font-medium">The operator has published the following notice.</strong> <span className="break-words">{notice.text}</span></div>;
}

/** Every live region stays mounted, so a notice that arrives is announced. */
export function PageNotices() {
  return (
    <section aria-label="Notices">
      <div role="status" className="empty:hidden"><OperatorNotice /></div>
      <div role="status" className="empty:hidden"><Rows tone="info" /></div>
      <div role="alert" className="empty:hidden"><Rows tone="error" /></div>
    </section>
  );
}

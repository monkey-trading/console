"use client";

/** The withdrawal queue's panels: what it owes in total, and where the connected account stands in it. */

import { fixedFromWire, formatUsd, type Fixed } from "@/lib/fixed";
import { exactTotals, queueMarks, type QueueTotals } from "@/lib/house";
import type { ConsoleState } from "@/lib/store/state";

import { Panel, Quiet, Row } from "./Panel";
import { useSelected } from "./use-feed";

/** The most segments the place bar draws, however long the queue. */
const SEGMENTS = 40;

const selectQueue = (s: ConsoleState): { totals: QueueTotals | null; failed: boolean } => ({ totals: s.withdrawalTotals, failed: s.queueFailed });
const selectPlace = (s: ConsoleState) => ({ queue: s.queue, read: s.accountQueueRead, wallet: s.wallet?.address ?? null, count: s.withdrawalTotals?.count ?? null, exact: exactTotals(s.withdrawalTotals, s.queueFailed) !== null });

const amount = (value: Fixed | null): string => (value === null ? "None" : formatUsd(value));

/** The queue's total, how many requests wait, its largest entry and the next to be paid. */
export function QueueStats() {
  const { totals, failed } = useSelected(selectQueue);
  return (
    <Panel title="Withdrawal queue" tip="Withdrawals the vault could not pay at once wait here and are paid in the order they were asked, each up to the collateral the vault holds.">
      {totals === null ? (
        <Quiet>{failed ? "The queue read keeps failing." : "Reading the queue…"}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Queue total" tip="The dollars every waiting request still owes." value={formatUsd(totals.remaining)} tone={totals.remaining > 0n ? "ember" : "fg"} />
            <Row label="Requests waiting" tip="How many withdrawal requests are in the queue." value={String(totals.count)} />
            <Row label="Largest entry" tip="The most any one waiting request still owes." value={amount(totals.largest)} />
            <Row label="Next to be paid" tip="What the request at the head of the queue still owes. It is paid first when the vault has funds." value={amount(totals.head)} />
          </dl>
          {!totals.complete && <p className="text-label text-fg-3">The queue&apos;s first pages only are counted, so these are lower bounds.</p>}
          {totals.complete && !totals.stable && <p className="text-label text-fg-3">The queue changed while it was read, so these figures are approximate.</p>}
          {failed && <p className="text-label text-fg-3">The last read failed, so these figures may be behind.</p>}
        </>
      )}
    </Panel>
  );
}

/** The connected account's place in the queue, or what to do to see it. */
export function QueuePlace() {
  const { queue, read, wallet, count, exact } = useSelected(selectPlace);
  const first = queue[0];
  // The queue's length is known only from a complete, steady read of it; otherwise the place stands alone, with no total to measure against.
  const waiting = exact && count !== null ? Math.max(count, ...queue.map((request) => request.position)) : null;
  const marks = waiting === null ? new Set<number>() : queueMarks(queue.map((request) => request.position), waiting, SEGMENTS);
  return (
    <Panel title="Your place" tip="Where the connected account's withdrawal requests stand in the queue.">
      {wallet === null ? (
        <Quiet>Connect a wallet to see your place in the queue.</Quiet>
      ) : !read ? (
        <Quiet>Reading your place in the queue. It appears once the node answers.</Quiet>
      ) : first === undefined ? (
        <Quiet>You have no withdrawal waiting.</Quiet>
      ) : (
        <>
          <p className="text-lead text-fg tabular-nums">#{first.position}{waiting !== null && <span className="text-caption text-fg-3"> of {waiting}</span>}</p>
          <p className="text-caption text-fg-2">{first.position === 1 ? "Next to be paid" : `${first.position - 1} ahead of you`}. {formatUsd(fixedFromWire(first.remaining))} left to pay.</p>
          {waiting !== null && (
            <>
              <ol aria-hidden="true" className="flex h-2 gap-px">
                {Array.from({ length: SEGMENTS }, (_, i) => <li key={i} className={`flex-1 ${marks.has(i + 1) ? "bg-glow" : "bg-line-2"}`} />)}
              </ol>
              <p className="text-label text-fg-3">Head of the queue on the left. {queue.length > 1 ? `Your ${queue.length} requests are lit.` : "Your request is lit."}</p>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

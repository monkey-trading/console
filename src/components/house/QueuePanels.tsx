"use client";

/** The withdrawal queue's panels: what it owes in total, and where the connected account stands in it. */

import { fixedFromWire, formatUsd, type Fixed } from "@/lib/fixed";
import { exactTotals, queueCaveats, queueMarks, type QueueTotals } from "@/lib/house";
import type { ConsoleState } from "@/lib/store/state";

import { Panel, Quiet, Row } from "./Panel";
import { useSelected } from "./use-feed";

/** The most segments the place bar draws, however long the queue. */
const SEGMENTS = 40;

const selectQueue = (s: ConsoleState): { totals: QueueTotals | null; failed: boolean } => ({ totals: s.withdrawalTotals, failed: s.queueFailed });
const selectPlace = (s: ConsoleState) => ({ queue: s.queue, read: s.accountRead, wallet: s.wallet?.address ?? null, count: s.withdrawalTotals?.count ?? null, exact: exactTotals(s.withdrawalTotals, s.queueFailed) !== null });

const amount = (value: Fixed | null): string => (value === null ? "None" : formatUsd(value));

/** The queue's total, how many requests wait, its largest entry and the next to be paid. */
export function QueueStats() {
  const { totals, failed } = useSelected(selectQueue);
  return (
    <Panel title="Withdrawal queue" tip="Withdrawals that cannot be paid immediately wait in this queue. They are paid in the order in which they were requested, as funds become available.">
      {totals === null ? (
        <Quiet>{failed ? "The withdrawal queue could not be loaded. The page will try again automatically." : "Loading the withdrawal queue…"}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Queue total" tip="The total amount still owed to everyone waiting in the queue, in US dollars." value={formatUsd(totals.remaining)} tone={totals.remaining > 0n ? "ember" : "fg"} />
            <Row label="Requests waiting" tip="The number of withdrawal requests waiting in the queue." value={String(totals.count)} />
            <Row label="Largest request" tip="The largest amount still owed on any single request." value={amount(totals.largest)} />
            <Row label="Next to be paid" tip="The amount still owed on the request at the front of the queue. This request is paid first when funds become available." value={amount(totals.head)} />
          </dl>
          {queueCaveats(totals, failed).map((line) => <p key={line} className="text-label text-fg-3">{line}</p>)}
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
    <Panel title="Your place" tip="The position of your withdrawal requests in the queue.">
      {wallet === null ? (
        <Quiet>Connect a wallet to see your place in the queue.</Quiet>
      ) : !read ? (
        <Quiet>Loading your place in the queue…</Quiet>
      ) : first === undefined ? (
        <Quiet>You have no withdrawals waiting in the queue.</Quiet>
      ) : (
        <>
          <p className="text-lead text-fg tabular-nums">#{first.position}{waiting !== null && <span className="text-caption text-fg-3"> of {waiting}</span>}</p>
          <p className="text-caption text-fg-2">{first.position === 1 ? "Your request is next to be paid" : `${first.position - 1} ${first.position === 2 ? "request is" : "requests are"} ahead of yours`}. {formatUsd(fixedFromWire(first.remaining))} remains to be paid.</p>
          {waiting !== null && (
            <>
              <ol aria-hidden="true" className="flex h-2 gap-px">
                {Array.from({ length: SEGMENTS }, (_, i) => <li key={i} className={`flex-1 ${marks.has(i + 1) ? "bg-glow" : "bg-line-2"}`} />)}
              </ol>
              <p className="text-label text-fg-3">The front of the queue is on the left. {queue.length > 1 ? `Your ${queue.length} requests are highlighted.` : "Your request is highlighted."}</p>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

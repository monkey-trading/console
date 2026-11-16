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
    <Panel title="Withdrawal queue" tip="Withdrawals that can't be paid straight away wait here. They're paid in the order they were requested, as funds become available.">
      {totals === null ? (
        <Quiet>{failed ? "Couldn't load the queue. Trying again automatically." : "Loading the queue…"}</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Queue total" tip="This is the total still owed to everyone waiting, in dollars." value={formatUsd(totals.remaining)} tone={totals.remaining > 0n ? "ember" : "fg"} />
            <Row label="Requests waiting" tip="This is the number of withdrawal requests waiting." value={String(totals.count)} />
            <Row label="Largest request" tip="This is the most still owed on any one request." value={amount(totals.largest)} />
            <Row label="Next to be paid" tip="This is what's still owed on the request at the front of the queue. It's paid first when funds are available." value={amount(totals.head)} />
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
    <Panel title="Your place" tip="This is where your withdrawal requests are in the queue.">
      {wallet === null ? (
        <Quiet>Connect a wallet to see your place in the queue.</Quiet>
      ) : !read ? (
        <Quiet>Loading your place in the queue…</Quiet>
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
              <p className="text-label text-fg-3">The front of the queue is on the left. {queue.length > 1 ? `Your ${queue.length} requests are highlighted.` : "Your request is highlighted."}</p>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

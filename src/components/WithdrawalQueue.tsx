"use client";

/** The account's withdrawal requests and where each stands in the vault's first-in first-out queue. */

import { formatFixedPlaces, fixedFromWire } from "@/lib/fixed";

import { useConsole } from "./ConsoleProvider";

export function WithdrawalQueue() {
  const { queue, wallet } = useConsole();
  return (
    <section aria-labelledby="queue-title" className="p-4">
      <h4 id="queue-title" className="text-label tracking-caps text-fg-3 uppercase">Withdrawal queue</h4>
      {queue.length === 0 ? (
        <p className="mt-3 text-caption text-fg-3">{wallet ? "No withdrawals are waiting." : "Connect a wallet to see your place in the queue."}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {queue.map((request) => (
            <li key={request.requested_seq} className="rounded border border-line-2 px-3 py-3 text-caption">
              <p className="flex justify-between gap-2">
                <span className="text-fg">Position {request.position}</span>
                <span className="text-fg-2">{request.position === 1 ? "Next to be paid" : `${request.position - 1} ahead`}</span>
              </p>
              <p className="mt-2 flex justify-between gap-2 text-fg-3">
                <span>Requested ${formatFixedPlaces(fixedFromWire(request.amount), 2)}</span>
                <span className="text-fg-2">${formatFixedPlaces(fixedFromWire(request.remaining), 2)} left to pay</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

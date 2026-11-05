"use client";

/** The House section's Withdrawals tab: the first-in first-out queue's totals, the connected account's place in it, and how healthy the queue is. */

import { WithdrawalHealth } from "./HouseDetails";
import { QueuePlace, QueueStats } from "./QueuePanels";
import { selectGate } from "./HouseSection";
import { useSelected } from "./use-feed";

/** The Withdrawals tab: the queue's totals, the connected account's place and the queue's health. */
export function HouseWithdrawals() {
  const { blocked, ready } = useSelected(selectGate);
  return (
    // The panels stay mounted while the node is not trusted, hidden, as on the other tabs.
    <div className="mt-4 flex flex-col gap-2">
      {ready && (
        <div hidden={blocked} className="grid grid-cols-1 items-start gap-2 md:grid-cols-2 xl:grid-cols-3">
          <QueueStats />
          <QueuePlace />
          <WithdrawalHealth />
        </div>
      )}
    </div>
  );
}

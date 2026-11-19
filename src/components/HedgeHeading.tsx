"use client";

/**
 * The heading over a hedge's positions in the Positions tab (monkey-trading/engine#913): its markets, net exposure and margin
 * offset, a Close hedge button that closes every position of it that can trade on one request (D7, never refused for margin),
 * and, while one cannot trade, what that leaves open and that the hedge earns no offset for new orders meanwhile (D10).
 */

import { useEffect, useId } from "react";

import { planGroupClose, pressBatch, targetsKey, type HedgeMember } from "@/lib/close-all";
import { CONFIRM_MIN_GAP_MS, CONFIRM_MS } from "@/lib/confirm-window";
import { formatUsd } from "@/lib/fixed";
import { CLOSE_ALL_REMOVES_LEVELS } from "@/lib/level-words";
import type { OffsetGroupModel } from "@/lib/portfolio";
import { describeUntradable, formatNetExposure, hedgeTitle, listSymbols, NET_EXPOSURE_TIP, OFFSET_TIP } from "@/lib/portfolio-words";
import { closeAll } from "@/lib/store/batch-actions";

import { useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { Term } from "./house/Panel";
import { useConfirmWindow } from "./use-confirm-window";
import { usePrefs } from "./use-prefs";

const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";
/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** `members` are the hedge's positions in row order; `removesLevels` whether one holds a take profit or stop loss; `disabled` holds the button while the console is busy or the wallet is read-only. */
export function HedgeHeading({ group, members, removesLevels, disabled, describedBy }: { group: OffsetGroupModel; members: readonly HedgeMember[]; removesLevels: boolean; disabled: boolean; describedBy: string | undefined }) {
  const { store } = useSession();
  const id = useId();
  const { armed, state, arm, cancel } = useConfirmWindow(CONFIRM_MS, CONFIRM_MIN_GAP_MS);
  const { confirmBatch } = usePrefs().prefs;
  const { targets, slippageBps, untradable } = planGroupClose(members);
  const count = targets.length;
  const confirming = armed && count > 0;
  const symbols = members.map((m) => m.symbol);
  const note = untradable.length === 0 ? null : describeUntradable(untradable, members.length);
  // The window confirms the list it was armed for, as Close all's does.
  const listed = targetsKey(targets);
  useEffect(() => cancel(), [listed, cancel]);
  const press = (event: { currentTarget: HTMLElement }) => {
    const action = pressBatch(confirmBatch, state(), count);
    if (action === "arm") arm();
    if (action !== "send") return;
    cancel();
    keepFocus(event.currentTarget);
    void closeAll(store, targets, slippageBps);
  };
  // A held Enter repeats its click: only a separate press may confirm.
  const holdsDown = (event: { repeat: boolean; preventDefault: () => void }) => { if (event.repeat) event.preventDefault(); };
  const positions = `${count} ${count === 1 ? "position" : "positions"}`;
  return (
    <div className="text-left font-normal normal-case tracking-normal">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-caption text-fg">{hedgeTitle(symbols)}</span>
        <span className="text-label text-fg-3"><Term label="Net exposure" tip={NET_EXPOSURE_TIP} /> <span className="text-fg-2">{formatNetExposure(group.netNotional)}</span></span>
        <span className="text-label text-fg-3"><Term label="Margin offset" tip={OFFSET_TIP} /> <span className="text-fg-2">{formatUsd(group.offset)}</span></span>
        <button type="button" disabled={disabled || count === 0} className={confirming ? ARMED : BUTTON} aria-label={confirming ? undefined : `Close hedge: ${listSymbols(symbols)}`} aria-describedby={describedBy ?? (note === null ? undefined : `${id}-note`)} onClick={press} onKeyDown={holdsDown}>
          {confirming ? `Confirm: close ${positions}` : "Close hedge"}
        </button>
      </div>
      <p role="status" className="sr-only">{confirming ? `Press again within ${CONFIRM_MS / 1000} seconds to close ${positions}.${removesLevels ? ` ${CLOSE_ALL_REMOVES_LEVELS}` : ""}` : ""}</p>
      {confirming && removesLevels && <p className="mt-1 max-w-[80ch] whitespace-normal text-label leading-relaxed text-fg-2">{CLOSE_ALL_REMOVES_LEVELS}</p>}
      {note !== null && <p id={`${id}-note`} className="mt-1 max-w-[80ch] whitespace-normal text-label leading-relaxed text-fg-3">{note}</p>}
    </div>
  );
}

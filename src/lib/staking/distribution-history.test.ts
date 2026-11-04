/** Tests for the account's distribution history: pages of two kinds folded by epoch, held only where both reach, the stream's arrivals, and the bound. */

import { describe, expect, it } from "vitest";

import type { HistoryEvent, HistoryPage, StreamMessage } from "../engine/types";
import { addMessage, addNewest, addPage, atBound, emptyHistory, epochsLeftOut, hasOperatorShare, HISTORY_KINDS, limitingKinds, MAX_EPOCHS, moreRemain, shownRows, type HistoryKind } from "./distribution-history";

const ME = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";

/** An allocation of `kind` for epoch `epoch`, closed at seq `10 * epoch`, of `amount` USDC base units. */
function event(kind: HistoryKind, epoch: number, amount: string, index = 0): HistoryEvent {
  return { type: kind, account: ME, epoch, amount, cursor: `${10 * epoch}:${index}`, ts: 1_000 * epoch };
}

/** A page of `epochs`, newest first, with `next` when more lie below. */
function page(kind: HistoryKind, epochs: number[], more: boolean): HistoryPage {
  const events = epochs.map((epoch) => event(kind, epoch, `${epoch}000`, kind === "distribution_allocated" ? 0 : 1));
  return { events, next: more ? (events[events.length - 1]?.cursor ?? null) : null };
}

const epochs = (rows: readonly { epoch: number }[]) => rows.map((row) => row.epoch);

describe("the distribution history's pages", () => {
  it("shows nothing until both kinds have been read once", () => {
    const one = addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", [9, 8, 7], false));
    expect(shownRows(one)).toEqual([]);
    const both = addPage(one, "operator_share_allocated", page("operator_share_allocated", [], false));
    expect(shownRows(both)).toEqual([
      { epoch: 9, seq: 90, ts: 9_000, staker: 9_000n, operator: null },
      { epoch: 8, seq: 80, ts: 8_000, staker: 8_000n, operator: null },
      { epoch: 7, seq: 70, ts: 7_000, staker: 7_000n, operator: null },
    ]);
    expect(moreRemain(both)).toBe(false);
  });

  it("folds a staker's and an operator's share of one epoch into one row", () => {
    let data = addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", [5, 4], false));
    data = addPage(data, "operator_share_allocated", page("operator_share_allocated", [5], false));
    expect(shownRows(data)).toEqual([
      { epoch: 5, seq: 50, ts: 5_000, staker: 5_000n, operator: 5_000n },
      { epoch: 4, seq: 40, ts: 4_000, staker: 4_000n, operator: null },
    ]);
    expect(hasOperatorShare(shownRows(data))).toBe(true);
    expect(hasOperatorShare(shownRows(data).slice(1))).toBe(false);
  });

  it("holds back epochs below where a stream with more to read stopped, and shows them once it reaches them", () => {
    // The staker stream read 20 to 18 and has more; the operator stream is read to its start.
    let data = addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", [20, 19, 18], true));
    data = addPage(data, "operator_share_allocated", page("operator_share_allocated", [19, 12], false));
    expect(epochs(shownRows(data))).toEqual([20, 19, 18]);
    expect(moreRemain(data)).toBe(true);
    // Epoch 12's operator share is held but its staker share is not read yet.
    expect(epochs(data.rows)).toEqual([20, 19, 18, 12]);
    data = addPage(data, "distribution_allocated", page("distribution_allocated", [17, 12], false));
    expect(epochs(shownRows(data))).toEqual([20, 19, 18, 17, 12]);
    expect(shownRows(data).at(-1)).toEqual({ epoch: 12, seq: 120, ts: 12_000, staker: 12_000n, operator: 12_000n });
    expect(moreRemain(data)).toBe(false);
  });

  it("keeps the oldest seq read when a later page comes back empty, and ignores amounts that are not whole base units", () => {
    let data = addPage(emptyHistory(), "distribution_allocated", { events: [event("distribution_allocated", 3, "1.5"), event("distribution_allocated", 2, "-4"), event("distribution_allocated", 1, "70")], next: null });
    data = addPage(data, "operator_share_allocated", { events: [], next: null });
    expect(shownRows(data)).toEqual([{ epoch: 1, seq: 10, ts: 1_000, staker: 70n, operator: null }]);
    expect(addPage(data, "distribution_allocated", { events: [], next: null }).cover.distribution_allocated.oldestSeq).toBe(10);
  });
});

describe("the distribution history's stream", () => {
  const message = (seq: number, events: StreamMessage["events"]): StreamMessage => ({ offset: `${seq}:0`, type: "command", seq, ts: seq * 100, cmd: { type: "tick" }, events });
  const read = () => addPage(addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", [3], false)), "operator_share_allocated", page("operator_share_allocated", [], false));

  it("adds the account's allocations as they arrive, at the cursor the history route would give them", () => {
    const data = addMessage(read(), message(55, [{ type: "market_opened", market: 1 }, { type: "distribution_allocated", account: ME.toUpperCase().replace("0X", "0x"), epoch: 4, amount: "12" }, { type: "operator_share_allocated", account: ME, epoch: 4, amount: "3" }]), ME);
    expect(shownRows(data)[0]).toEqual({ epoch: 4, seq: 55, ts: 5_500, staker: 12n, operator: 3n });
  });

  it("returns the same history for a message with nothing of the account's, so nothing re-renders", () => {
    const data = read();
    expect(addMessage(data, message(56, [{ type: "distribution_allocated", account: OTHER, epoch: 4, amount: "12" }, { type: "market_closed", market: 1 }]), ME)).toBe(data);
  });

  it("counts an allocation the stream and a page both carry once", () => {
    const live = addMessage(read(), message(40, [{ type: "distribution_allocated", account: ME, epoch: 4, amount: "4000" }]), ME);
    const again = addPage(live, "distribution_allocated", page("distribution_allocated", [4], false));
    expect(shownRows(again).filter((row) => row.epoch === 4)).toEqual([{ epoch: 4, seq: 40, ts: 4_000, staker: 4_000n, operator: null }]);
  });
});

describe("the distribution history's bound", () => {
  it("stops reading at the bound and, as arrivals push the oldest out, shows no epoch below the ones it kept", () => {
    const many = Array.from({ length: MAX_EPOCHS }, (_, i) => MAX_EPOCHS - i);
    let data = addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", many, true));
    data = addPage(data, "operator_share_allocated", page("operator_share_allocated", [], false));
    expect(moreRemain(data)).toBe(false);
    expect(shownRows(data)).toHaveLength(MAX_EPOCHS);
    const pushed = addMessage(data, { offset: "x", type: "command", seq: 10 * (MAX_EPOCHS + 1), ts: 0, cmd: { type: "tick" }, events: [{ type: "distribution_allocated", account: ME, epoch: MAX_EPOCHS + 1, amount: "1" }] }, ME);
    expect(pushed.rows).toHaveLength(MAX_EPOCHS);
    expect(epochs(shownRows(pushed)).slice(0, 2)).toEqual([MAX_EPOCHS + 1, MAX_EPOCHS]);
    expect(shownRows(pushed).at(-1)?.epoch).toBe(2);
    expect(moreRemain(pushed)).toBe(false);
  });
});

describe("paging toward the bound", () => {
  /** Serves `kind`'s events for `epochs`, newest first, 50 a page, as the history route pages them. */
  function served(kind: HistoryKind, epochs: number[]) {
    const events = [...epochs].sort((a, b) => b - a).map((epoch) => event(kind, epoch, "1", kind === "distribution_allocated" ? 0 : 1));
    return (before: string | null): HistoryPage => {
      const older = events.filter((entry) => before === null || seqOfCursor(entry.cursor) < seqOfCursor(before));
      const page = older.slice(0, 50);
      return { events: page, next: older.length > page.length ? (page[page.length - 1]?.cursor ?? null) : null };
    };
  }
  const seqOfCursor = (cursor: string) => Number(cursor.split(":")[0]);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it("reads only the stream that limits what shows, so a staker's newer epochs reach the bound past an operator's older ones", () => {
    // Staker shares in epochs 1 to 4,000; operator shares only in the oldest 2,000.
    const pages = { distribution_allocated: served("distribution_allocated", range(1, 4_000)), operator_share_allocated: served("operator_share_allocated", range(1, 2_000)) };
    let data = HISTORY_KINDS.reduce((held, kind) => addPage(held, kind, pages[kind](null)), emptyHistory());
    let presses = 0;
    while (moreRemain(data)) {
      const kinds = limitingKinds(data);
      data = kinds.reduce((held, kind) => addPage(held, kind, pages[kind](held.cover[kind].next)), data);
      presses += 1;
      // Only one page of the stream that does not limit is ever held below what shows.
      expect(data.rows.length - shownRows(data).length).toBeLessThanOrEqual(50);
    }
    expect(epochs(shownRows(data))).toEqual(range(2_001, 4_000).reverse());
    expect(atBound(data)).toBe(true);
    expect(presses).toBe(MAX_EPOCHS / 50 - 1);
  });

  it("reads both streams while both limit, and neither once both are read to their start", () => {
    const pages = { distribution_allocated: served("distribution_allocated", range(1, 120)), operator_share_allocated: served("operator_share_allocated", range(1, 120)) };
    let data = HISTORY_KINDS.reduce((held, kind) => addPage(held, kind, pages[kind](null)), emptyHistory());
    expect(limitingKinds(data)).toEqual(["distribution_allocated", "operator_share_allocated"]);
    while (moreRemain(data)) data = limitingKinds(data).reduce((held, kind) => addPage(held, kind, pages[kind](held.cover[kind].next)), data);
    expect(limitingKinds(data)).toEqual([]);
    expect(shownRows(data)).toHaveLength(120);
    expect(atBound(data)).toBe(false);
  });
});

describe("what is held and left out", () => {
  const arrival = (epoch: number): StreamMessage => ({ offset: `${10 * epoch}:0`, type: "command", seq: 10 * epoch, ts: epoch, cmd: { type: "tick" }, events: [{ type: "distribution_allocated", account: ME, epoch, amount: "1" }] });

  it("bounds the arrivals held while no read has landed to show them, and shows none below what it kept once one lands", () => {
    let data = emptyHistory();
    for (let epoch = 1; epoch <= 2 * MAX_EPOCHS + 5; epoch += 1) data = addMessage(data, arrival(epoch), ME);
    expect(data.rows).toHaveLength(2 * MAX_EPOCHS);
    expect(data.rows.at(-1)?.epoch).toBe(6);
    data = addPage(addPage(data, "distribution_allocated", { events: [], next: null }), "operator_share_allocated", { events: [], next: null });
    expect(shownRows(data)).toHaveLength(MAX_EPOCHS);
    expect(epochsLeftOut(data)).toBe(true);
  });

  it("says epochs are left out once arrivals push one out of a history read to its start, and not before", () => {
    const all = Array.from({ length: MAX_EPOCHS }, (_, i) => MAX_EPOCHS - i);
    let data = addPage(addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", all, false)), "operator_share_allocated", page("operator_share_allocated", [], false));
    expect(shownRows(data)).toHaveLength(MAX_EPOCHS);
    expect(epochsLeftOut(data)).toBe(false);
    data = addMessage(data, arrival(MAX_EPOCHS + 1), ME);
    expect(shownRows(data)).toHaveLength(MAX_EPOCHS);
    expect(epochsLeftOut(data)).toBe(true);
  });

  it("folds the newest page in again without moving where the streams were read to", () => {
    const data = addPage(addPage(emptyHistory(), "distribution_allocated", page("distribution_allocated", [9, 8], true)), "operator_share_allocated", page("operator_share_allocated", [], false));
    const again = addNewest(data, page("distribution_allocated", [10, 9], true));
    expect(again.cover).toEqual(data.cover);
    expect(epochs(shownRows(again))).toEqual([10, 9, 8]);
  });
});

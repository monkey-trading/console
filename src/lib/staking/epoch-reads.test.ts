/** Tests for the Staking page's reads of the closed distribution epochs from the node's signed route, against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import type { DistributionEpochsPage, EpochClose } from "../engine/staking-reads";
import { NODE_READ_MS } from "../monkey/panel";
import { flush, setup } from "../monkey/panel-kit";
import { checkedPage, EPOCH_PAGE, EpochReads, foldEpochs, MAX_HELD_EPOCHS } from "./epoch-reads";
import { RETRY_TICK_MS } from "./history-reads";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const close = (epoch: number, over: Partial<EpochClose> = {}): EpochClose => ({
  epoch, close_seq: epoch * 10, close_ms: epoch * 1_000, ended_ms: epoch * 1_000, nav: "5000000", floor: "4900000", excess_usdc_units: "100", allocated_usdc_units: "100",
  stakers_usdc_units: "80", stakers: 2, operator_shares: [{ account: "0x00000000000000000000000000000000000000a1", amount: "20" }], skipped: null, ...over,
});

/** A page of `epochs`, newest first, with `next` the cursor to read on from. */
const page = (epochs: number[], next: number | null): DistributionEpochsPage => ({
  seq: 1, time_ms: 1, epochs: epochs.map((epoch) => close(epoch)), next, begins_ms: 0, begins_seq: 0, from_genesis: true, truncated: false, retained_from_epoch: null,
});

/** The node's closes numbered 1 to `count`, served newest first and paged as the node pages them. */
function serve(count: number) {
  const reads: { before?: number; limit?: number }[] = [];
  const answer = async (params: { before?: number; limit?: number }) => {
    reads.push(params);
    const older = Array.from({ length: count }, (_, i) => count - i).filter((epoch) => params.before === undefined || epoch < params.before);
    const shown = older.slice(0, params.limit ?? 50);
    return page(shown, older.length > shown.length ? (shown[shown.length - 1] ?? null) : null);
  };
  return { reads, answer, more: () => { count += 1; } };
}

async function started(count: number, hidden = () => false) {
  const kit = await setup();
  const served = serve(count);
  kit.node.client.stats.distributionEpochs = (params) => served.answer(params);
  const epochs = new EpochReads(kit.store);
  const stop = epochs.start(hidden);
  await flush();
  return { ...kit, epochs, stop, served };
}

describe("checkedPage", () => {
  it("passes a well-formed page and refuses a malformed amount, recipient, epoch, skipped run or cursor", () => {
    const good = page([3, 2], 2);
    expect(checkedPage(good)).toBe(good);
    const bad: Partial<EpochClose>[] = [
      { stakers_usdc_units: "1.5" }, { allocated_usdc_units: "-1" }, { nav: "five" },
      { operator_shares: [{ account: "0x12", amount: "20" }] }, { operator_shares: [{ account: "0x00000000000000000000000000000000000000a1", amount: "2e3" }] },
      { epoch: 1.5 }, { close_ms: -1 }, { skipped: { first: 1, last: Number.NaN } },
    ];
    for (const over of bad) expect(() => checkedPage({ ...good, epochs: [close(3, over)] })).toThrow("malformed figure for epoch");
    expect(() => checkedPage({ ...good, next: -2 })).toThrow("cursor that is not an epoch");
  });
});

describe("foldEpochs", () => {
  it("adds the epochs that closed since above, replaces those held again, and keeps the older pages' cursor", () => {
    const held = { epochs: [close(5), close(4), close(3)], next: 3 };
    const folded = foldEpochs(held, { ...page([7, 6, 5], 4), epochs: [close(7), close(6), close(5, { stakers: 9 })] }, false);
    expect(folded.epochs.map((c) => c.epoch)).toEqual([7, 6, 5, 4, 3]);
    expect(folded.epochs[2]?.stakers).toBe(9);
    expect(folded.next).toBe(3);
  });

  it("adds an older page below and moves the cursor on", () => {
    expect(foldEpochs({ epochs: [close(5), close(4)], next: 4 }, page([3, 2], 2), true)).toEqual({ epochs: [close(5), close(4), close(3), close(2)], next: 2 });
  });

  it("starts again from a newest page that does not reach what is held, past a gap of more than a page", () => {
    expect(foldEpochs({ epochs: [close(5), close(4)], next: null }, page([30, 29], 29), false)).toEqual({ epochs: [close(30), close(29)], next: 29 });
  });

  it("keeps at most the bound, and reads no further past it", () => {
    const held = { epochs: Array.from({ length: MAX_HELD_EPOCHS }, (_, i) => close(MAX_HELD_EPOCHS + 1 - i)), next: 2 };
    const folded = foldEpochs(held, page([1], null), true);
    expect(folded.epochs).toHaveLength(MAX_HELD_EPOCHS);
    expect(folded.next).toBeNull();
  });
});

describe("EpochReads", () => {
  it("reads the newest page on open, and older pages on Load more until none is left", async () => {
    const { epochs, stop, served } = await started(EPOCH_PAGE + 5);
    expect(epochs.getSnapshot()).toMatchObject({ status: "ready", next: 6 });
    expect(epochs.getSnapshot().epochs.map((c) => c.epoch).slice(0, 2)).toEqual([25, 24]);
    await epochs.loadMore();
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE + 5);
    expect(epochs.getSnapshot().next).toBeNull();
    expect(served.reads).toEqual([{ limit: EPOCH_PAGE }, { before: 6, limit: EPOCH_PAGE }]);
    stop();
  });

  it("reads the newest page again on the node read's pace, and at once after the stream carries an allocation, so a new close shows by itself", async () => {
    const { epochs, node, stop, served } = await started(3);
    served.more();
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(served.reads).toHaveLength(1);
    node.client.state.emit({ type: "tick" }, [{ type: "distribution_allocated", account: "0x00000000000000000000000000000000000000a1", epoch: 4, amount: "1" }]);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(served.reads).toHaveLength(2);
    expect(epochs.getSnapshot().epochs.map((c) => c.epoch)).toEqual([4, 3, 2, 1]);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(served.reads).toHaveLength(3);
    stop();
  });

  it("reads nothing again in a hidden tab", async () => {
    const { stop, served } = await started(3, () => true);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 4);
    expect(served.reads).toHaveLength(1);
    stop();
  });

  it("says a node without the route is unavailable and asks it no more, and makes a failed read again by itself", async () => {
    const kit = await setup();
    const calls = { count: 0 };
    kit.node.client.stats.distributionEpochs = () => { calls.count += 1; return Promise.reject(new EngineError(404, "not found")); };
    const missing = new EpochReads(kit.store);
    const stopMissing = missing.start(() => false);
    await flush();
    expect(missing.getSnapshot().status).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 2);
    expect(calls.count).toBe(1);
    stopMissing();
    let fail = true;
    const served = serve(2);
    kit.node.client.stats.distributionEpochs = (params) => (fail ? Promise.reject(new Error("The node did not answer.")) : served.answer(params));
    const failing = new EpochReads(kit.store);
    const stop = failing.start(() => false);
    await flush();
    expect(failing.getSnapshot()).toMatchObject({ status: "failed", error: "The node did not answer." });
    fail = false;
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(failing.getSnapshot()).toMatchObject({ status: "ready", error: null });
    stop();
  });

  it("drops an answer that lands after the card closed, keeping the loaded pages for a tab switch back", async () => {
    const { epochs, node, stop, served } = await started(EPOCH_PAGE + 5);
    await epochs.loadMore();
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE + 5);
    let release: (value: DistributionEpochsPage) => void = () => {};
    node.client.stats.distributionEpochs = () => new Promise((resolve) => { release = resolve; });
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    stop();
    release(page([99], null));
    await flush();
    // The late answer wrote nothing; what was read stays, so the tab switch back shows it while a read refreshes it.
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE + 5);
    node.client.stats.distributionEpochs = (params) => served.answer(params);
    const restart = epochs.start(() => false);
    await flush();
    expect(epochs.getSnapshot().status).toBe("ready");
    restart();
  });

  it("keeps the loaded pages across a stop and restart, and folds what closed meanwhile into the restart's read of the newest page", async () => {
    const { epochs, stop, served } = await started(EPOCH_PAGE + 5);
    await epochs.loadMore();
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE + 5);
    stop();
    expect(epochs.getSnapshot()).toMatchObject({ status: "ready" });
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE + 5);
    served.more();
    const reads = served.reads.length;
    const restart = epochs.start(() => false);
    await flush();
    expect(served.reads).toHaveLength(reads + 1);
    expect(epochs.getSnapshot().epochs.map((close) => close.epoch)).toEqual(Array.from({ length: EPOCH_PAGE + 6 }, (_, i) => EPOCH_PAGE + 6 - i));
    restart();
  });

  it("keeps the epochs it holds and says why when a later read of the newest page fails, then clears the line once one lands", async () => {
    const { epochs, node, stop, served } = await started(3);
    node.client.stats.distributionEpochs = () => Promise.reject(new Error("The node did not answer."));
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(epochs.getSnapshot()).toMatchObject({ status: "ready", error: "The node did not answer." });
    expect(epochs.getSnapshot().epochs).toHaveLength(3);
    node.client.stats.distributionEpochs = (params) => served.answer(params);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 2);
    expect(epochs.getSnapshot().error).toBeNull();
    stop();
  });

  it("shows no page with a malformed figure, newest or older, and says why", async () => {
    const { epochs, node, stop, served } = await started(EPOCH_PAGE + 5);
    node.client.stats.distributionEpochs = async (params) => {
      const answer = await served.answer(params);
      return { ...answer, epochs: answer.epochs.map((c) => ({ ...c, stakers_usdc_units: "0x10" })) };
    };
    await epochs.loadMore();
    expect(epochs.getSnapshot().moreError).toContain("malformed figure");
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(epochs.getSnapshot().error).toContain("malformed figure");
    expect(epochs.getSnapshot().epochs.every((c) => c.stakers_usdc_units !== "0x10")).toBe(true);
    stop();
  });

  it("says a failed Load more under the button and keeps what it holds", async () => {
    const { epochs, node, stop } = await started(EPOCH_PAGE + 5);
    node.client.stats.distributionEpochs = () => Promise.reject(new Error("The node did not answer."));
    await epochs.loadMore();
    expect(epochs.getSnapshot()).toMatchObject({ status: "ready", more: false, moreError: "The node did not answer.", next: 6 });
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE);
    stop();
  });

  it("drops an older page that lands after a newest read started the list again past a gap", async () => {
    const { epochs, node, stop } = await started(EPOCH_PAGE + 5);
    let release: (value: DistributionEpochsPage) => void = () => {};
    node.client.stats.distributionEpochs = (params) => (params.before !== undefined ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(page(Array.from({ length: EPOCH_PAGE }, (_, i) => 60 - i), 41)));
    const older = epochs.loadMore();
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(epochs.getSnapshot()).toMatchObject({ next: 41 });
    release(page([5, 4, 3, 2, 1], null));
    await older;
    expect(epochs.getSnapshot().next).toBe(41);
    expect(epochs.getSnapshot().epochs.map((c) => c.epoch)).toEqual(Array.from({ length: EPOCH_PAGE }, (_, i) => 60 - i));
    stop();
  });

  it("drops the failure of an older page for a list a newest read has since replaced", async () => {
    const { epochs, node, stop } = await started(EPOCH_PAGE + 5);
    let refuse: (error: Error) => void = () => {};
    node.client.stats.distributionEpochs = (params) => (params.before !== undefined ? new Promise((_, reject) => { refuse = reject; }) : Promise.resolve(page(Array.from({ length: EPOCH_PAGE }, (_, i) => 60 - i), 41)));
    const older = epochs.loadMore();
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    refuse(new Error("The node did not answer."));
    await older;
    expect(epochs.getSnapshot()).toMatchObject({ more: false, moreError: null, next: 41 });
    stop();
  });
});

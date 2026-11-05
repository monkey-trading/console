/** Tests for the Staking page's reads of the account's distribution history, against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import type { HistoryPage } from "../engine/types";
import { DEMO_ADDRESS } from "../mock/demo";
import { EPOCH_MS } from "../mock/monkey-state";
import { NODE_READ_MS } from "../monkey/panel";
import { flush, setup } from "../monkey/panel-kit";
import { connectWallet, disconnectWallet } from "../store/actions";
import { shownRows } from "./distribution-history";
import { DistributionHistoryReads, HISTORY_PAGE, RETRY_TICK_MS } from "./history-reads";
import { epochsOf, mine, SEEDED, started } from "./history-reads-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DistributionHistoryReads", () => {
  it("reads one page of each kind for the connected account as it opens, and shows the epochs both reach", async () => {
    const { history, pages, node, stop } = await started();
    expect(mine(pages)).toEqual([
      [DEMO_ADDRESS, { kind: "distribution_allocated", limit: HISTORY_PAGE }],
      [DEMO_ADDRESS, { kind: "operator_share_allocated", limit: HISTORY_PAGE }],
    ]);
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready", error: null });
    expect(shownRows(history.getSnapshot().data)).toEqual([{ epoch: node.client.state.monkey.epochs.at(-1)?.epoch, seq: expect.any(Number), ts: expect.any(Number), staker: SEEDED, operator: null }]);
    stop();
  });

  it("adds the share of an epoch the clock closes from the stream, with no read", async () => {
    const { history, pages, node, stop } = await started();
    pages.mockClear();
    const before = epochsOf(history);
    node.client.tick(node.client.state.now + EPOCH_MS);
    await flush();
    expect(epochsOf(history)).toEqual([node.client.state.monkey.epochs.at(-1)?.epoch, ...before]);
    const entitled = node.client.state.monkey.distEntitled.get(DEMO_ADDRESS.toLowerCase()) ?? 0n;
    expect(shownRows(history.getSnapshot().data)[0]?.staker).toBe(entitled - SEEDED);
    expect(mine(pages)).toEqual([]);
    stop();
  });

  it("reads older pages only on Load more, of the kinds with more below them, and nothing once both are read to their start", async () => {
    const { history, pages, stop } = await started({ epochs: HISTORY_PAGE + 5 });
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE }, (_, i) => HISTORY_PAGE + 5 - i));
    pages.mockClear();
    await history.loadMore();
    expect(mine(pages).map(([, params]) => params)).toEqual([{ kind: "distribution_allocated", limit: HISTORY_PAGE, before: "60:0" }]);
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE + 5 }, (_, i) => HISTORY_PAGE + 5 - i));
    pages.mockClear();
    await history.loadMore();
    expect(mine(pages)).toEqual([]);
    stop();
  });

  it("drops the epochs it holds at once when the wallet changes, reads none with no wallet, and reads the new wallet's", async () => {
    const { history, store, pages, stop } = await started();
    disconnectWallet(store);
    history.walletChanged();
    expect(history.getSnapshot()).toMatchObject({ account: null, status: "idle" });
    expect(shownRows(history.getSnapshot().data)).toEqual([]);
    pages.mockClear();
    await connectWallet(store, "browser");
    history.walletChanged();
    await flush();
    expect(mine(pages)).toHaveLength(2);
    expect(epochsOf(history)).toHaveLength(1);
    // The same wallet again reads nothing.
    history.walletChanged();
    await flush();
    expect(mine(pages)).toHaveLength(2);
    stop();
  });

  it("reads a failed first read again by itself once its backoff has passed, not before, and not in a hidden tab", async () => {
    let hidden = false;
    let failing = true;
    const kit = await setup();
    kit.stop();
    const real = kit.node.client.history.bind(kit.node.client);
    const pages = vi.spyOn(kit.node.client, "history").mockImplementation((address, params): Promise<HistoryPage> => (failing ? Promise.reject(new Error("the node is catching up")) : real(address, params)));
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => hidden);
    await flush();
    expect(history.getSnapshot()).toMatchObject({ status: "failed", error: "the node is catching up" });
    const asked = mine(pages).length;
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS - 1);
    expect(mine(pages)).toHaveLength(asked);
    await vi.advanceTimersByTimeAsync(1);
    expect(mine(pages)).toHaveLength(asked + 2);
    // The second failure waits twice as long.
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(asked + 2);
    hidden = true;
    await vi.advanceTimersByTimeAsync(10 * RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(asked + 2);
    hidden = false;
    failing = false;
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(history.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(epochsOf(history)).toHaveLength(1);
    stop();
  });

  it("says why Load more failed under the button, keeps what it holds, and reads again when pressed", async () => {
    const { history, pages, stop } = await started({ epochs: HISTORY_PAGE + 5 });
    pages.mockRejectedValueOnce(new Error("no answer"));
    await history.loadMore();
    expect(history.getSnapshot()).toMatchObject({ status: "ready", more: false, error: "no answer" });
    expect(epochsOf(history)).toHaveLength(HISTORY_PAGE);
    await history.loadMore();
    expect(history.getSnapshot()).toMatchObject({ error: null });
    expect(epochsOf(history)).toHaveLength(HISTORY_PAGE + 5);
    stop();
  });

  it("reads a node that predates the operator's share, which refuses that kind, as one with none of it", async () => {
    const kit = await setup();
    kit.stop();
    const real = kit.node.client.history.bind(kit.node.client);
    vi.spyOn(kit.node.client, "history").mockImplementation((address, params) => (params.kind === "operator_share_allocated" ? Promise.reject(new EngineError(400, "unknown kind")) : real(address, params)));
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    expect(history.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(epochsOf(history)).toHaveLength(1);
    stop();
  });

  it("reads the newest pages again a tick after the first read lands and then on the node read's pace, until an epoch the index lagged on shows", async () => {
    const kit = await setup();
    kit.stop();
    const real = kit.node.client.history.bind(kit.node.client);
    let lagging = true;
    // The index has not taken the account's one allocation when the page first reads it, nor at the first read again.
    const pages = vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params) => (lagging && params.kind === "distribution_allocated" ? { events: [], next: null } : real(address, params)));
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    expect(history.getSnapshot().status).toBe("ready");
    expect(epochsOf(history)).toEqual([]);
    pages.mockClear();
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages).map(([, params]) => params)).toEqual([{ kind: "distribution_allocated", limit: HISTORY_PAGE }, { kind: "operator_share_allocated", limit: HISTORY_PAGE }]);
    expect(epochsOf(history)).toEqual([]);
    lagging = false;
    // Nothing more before the node read's pace has passed, then the epoch the index has now taken.
    await vi.advanceTimersByTimeAsync(NODE_READ_MS - RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(4);
    expect(epochsOf(history)).toHaveLength(1);
    // And on, while the page is open.
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(mine(pages)).toHaveLength(6);
    stop();
  });

  it("reads none of the newest pages while the tab is hidden", async () => {
    let hidden = false;
    const { history, pages, stop } = await started({ hidden: () => hidden });
    expect(history.getSnapshot().status).toBe("ready");
    hidden = true;
    pages.mockClear();
    await vi.advanceTimersByTimeAsync(3 * NODE_READ_MS);
    expect(mine(pages)).toHaveLength(0);
    stop();
  });

  it("makes the second read of the newest pages a full tick after a slow first read lands, not on the timer's next beat", async () => {
    const kit = await setup();
    kit.stop();
    const real = kit.node.client.history.bind(kit.node.client);
    let first = true;
    const pages = vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params) => {
      // The first read of each kind takes 4.9 s.
      if (first && (params.kind === "distribution_allocated" || params.kind === "operator_share_allocated")) await new Promise((resolve) => setTimeout(resolve, 4_900));
      return real(address, params);
    });
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await vi.advanceTimersByTimeAsync(4_900);
    first = false;
    expect(history.getSnapshot().status).toBe("ready");
    pages.mockClear();
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(2);
    stop();
  });

  it("keeps the second read of the newest pages due while it fails, says why, and makes it again once the backoff has passed", async () => {
    const kit = await setup();
    kit.stop();
    const real = kit.node.client.history.bind(kit.node.client);
    let phase: "lagging" | "failing" | "answering" = "lagging";
    const pages = vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params) => {
      if (params.kind !== "distribution_allocated") return real(address, params);
      if (phase === "lagging") return { events: [], next: null };
      if (phase === "failing") throw new Error("the node did not answer");
      return real(address, params);
    });
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    phase = "failing";
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(history.getSnapshot()).toMatchObject({ status: "ready", recheckError: "the node did not answer" });
    expect(epochsOf(history)).toEqual([]);
    phase = "answering";
    pages.mockClear();
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(2);
    expect(history.getSnapshot()).toMatchObject({ status: "ready", recheckError: null });
    expect(epochsOf(history)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5 * RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(2);
    stop();
  });

  it("drops what it holds when the mock's account reset invalidates it while its reads are stopped, and reads afresh when they restart", async () => {
    const { history, node, store, pages, stop } = await started();
    // The section holds this registration for its whole mount, so the reset reaches the retained rows from any tab.
    store.monkeySession.history = history;
    expect(epochsOf(history)).toHaveLength(1);
    stop();
    node.controls.resetAccount(DEMO_ADDRESS);
    pages.mockClear();
    store.monkeySession.history?.invalidate();
    expect(shownRows(history.getSnapshot().data)).toEqual([]);
    expect(mine(pages)).toHaveLength(0);
    const restart = history.start(() => false);
    await flush();
    expect(mine(pages)).toHaveLength(2);
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready" });
    expect(epochsOf(history)).toEqual([]);
    restart();
  });
});

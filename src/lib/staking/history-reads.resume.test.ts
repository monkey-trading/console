/** Tests for the distribution-history reads' stop and restart: what a tab switch keeps, and how the reads resume. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryPage } from "../engine/types";
import { DEMO_ADDRESS } from "../mock/demo";
import { flush, setup } from "../monkey/panel-kit";
import { moreRemain } from "./distribution-history";
import { DistributionHistoryReads, HISTORY_PAGE, RETRY_TICK_MS } from "./history-reads";
import { epochsOf, mine, started } from "./history-reads-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DistributionHistoryReads stop and restart", () => {
  it("keeps the loaded pages across a stop and restart, and reads the newest pages again a tick after the restart", async () => {
    const { history, pages, stop } = await started();
    expect(history.getSnapshot().status).toBe("ready");
    expect(epochsOf(history)).toHaveLength(1);
    stop();
    expect(history.getSnapshot().status).toBe("ready");
    expect(epochsOf(history)).toHaveLength(1);
    pages.mockClear();
    const restart = history.start(() => false);
    // The held pages are not re-read at once; the newest are, a tick after the reads resume.
    expect(mine(pages)).toEqual([]);
    expect(epochsOf(history)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(mine(pages)).toHaveLength(2);
    expect(epochsOf(history)).toHaveLength(1);
    restart();
  });

  it("reads afresh on resume when more than a page landed while the reads were stopped, so no interval is left unreachable", async () => {
    const kit = await setup();
    kit.stop();
    let count = HISTORY_PAGE + 5;
    const events = () => Array.from({ length: count }, (_, i) => ({ type: "distribution_allocated" as const, account: DEMO_ADDRESS, epoch: count - i, amount: "1000", cursor: `${10 * (count - i)}:0`, ts: count - i }));
    const real = kit.node.client.history.bind(kit.node.client);
    const pages = vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params): Promise<HistoryPage> => {
      if (params.kind !== "distribution_allocated") return real(address, params);
      const older = events().filter((event) => params.before === undefined || Number(event.cursor.split(":")[0]) < Number(params.before.split(":")[0]));
      const served = older.slice(0, params.limit ?? 50);
      return { events: served, next: older.length > served.length ? (served[served.length - 1]?.cursor ?? null) : null };
    });
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE }, (_, i) => HISTORY_PAGE + 5 - i));
    stop();
    // 70 more epochs close while the reads are stopped: the newest page cannot reach what is held.
    count = 2 * HISTORY_PAGE + 20;
    const restart = history.start(() => false);
    pages.mockClear();
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    await flush();
    // The recheck found the gap and started over: two reads for the recheck, then the afresh first read.
    expect(mine(pages)).toHaveLength(4);
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready" });
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE }, (_, i) => 2 * HISTORY_PAGE + 20 - i));
    // The coverage was rebuilt: Load more reads below the afresh page and reaches what the gap would have hidden.
    await history.loadMore();
    expect(epochsOf(history)).toEqual(Array.from({ length: 2 * HISTORY_PAGE }, (_, i) => 2 * HISTORY_PAGE + 20 - i));
    restart();
  });

  it("starts a first read cut off by a stop over when the reads restart, and an answer it had in flight writes nothing", async () => {
    const kit = await setup();
    kit.stop();
    const real = kit.node.client.history.bind(kit.node.client);
    const releases: (() => void)[] = [];
    vi.spyOn(kit.node.client, "history").mockImplementation((address, params) => new Promise((resolve) => { releases.push(() => { void real(address, params).then(resolve); }); }));
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "reading" });
    stop();
    for (const release of releases) release();
    await flush();
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "idle" });
    expect(history.getSnapshot().data.rows).toEqual([]);
    const restart = history.start(() => false);
    await flush();
    for (const release of releases.slice(2)) release();
    await flush();
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready" });
    expect(epochsOf(history)).toHaveLength(1);
    restart();
  });

  it("rebuilds on resume when epochs land on a history read to its start that held nothing, so the oldest of them stays reachable", async () => {
    const kit = await setup();
    kit.stop();
    let count = 0;
    const real = kit.node.client.history.bind(kit.node.client);
    vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params): Promise<HistoryPage> => {
      if (params.kind !== "distribution_allocated") return real(address, params);
      const events = () => Array.from({ length: count }, (_, i) => ({ type: "distribution_allocated" as const, account: DEMO_ADDRESS, epoch: count - i, amount: "1000", cursor: `${10 * (count - i)}:0`, ts: count - i }));
      const older = events().filter((event) => params.before === undefined || Number(event.cursor.split(":")[0]) < Number(params.before.split(":")[0]));
      const served = older.slice(0, params.limit ?? 50);
      return { events: served, next: older.length > served.length ? (served[served.length - 1]?.cursor ?? null) : null };
    });
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    // The account has no allocations: both kinds are read to their start and nothing is held.
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready" });
    expect(epochsOf(history)).toEqual([]);
    stop();
    // 51 epochs pay the account while the reads are stopped.
    count = HISTORY_PAGE + 1;
    const restart = history.start(() => false);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    await flush();
    // The recheck could not join the newest page to a history that held nothing: the cover rebuilt.
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready" });
    expect(history.getSnapshot().data.cover.distribution_allocated.done).toBe(false);
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE }, (_, i) => HISTORY_PAGE + 1 - i));
    // The rebuilt cover paginates: Load more reaches the epoch the fold would have stranded.
    await history.loadMore();
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE + 1 }, (_, i) => HISTORY_PAGE + 1 - i));
    restart();
  });

  it("catches the resume gap even when the stream folds a new allocation before the recheck reads the newest pages", async () => {
    const kit = await setup();
    kit.stop();
    let count = HISTORY_PAGE;
    const real = kit.node.client.history.bind(kit.node.client);
    vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params): Promise<HistoryPage> => {
      if (params.kind !== "distribution_allocated") return real(address, params);
      const events = () => Array.from({ length: count }, (_, i) => ({ type: "distribution_allocated" as const, account: DEMO_ADDRESS, epoch: count - i, amount: "1000", cursor: `${count - i}:0`, ts: count - i }));
      const older = events().filter((event) => params.before === undefined || Number(event.cursor.split(":")[0]) < Number(params.before.split(":")[0]));
      const served = older.slice(0, params.limit ?? 50);
      return { events: served, next: older.length > served.length ? (served[served.length - 1]?.cursor ?? null) : null };
    });
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    expect(epochsOf(history)).toEqual(Array.from({ length: HISTORY_PAGE }, (_, i) => HISTORY_PAGE - i));
    stop();
    // 70 more epochs close while the reads are stopped; the newest reaches the stream first.
    count = 2 * HISTORY_PAGE + 20;
    const restart = history.start(() => false);
    for (let i = 0; i < 100; i += 1) kit.node.client.state.emit({ type: "tick" }, []);
    kit.node.client.state.emit({ type: "tick" }, [{ type: "distribution_allocated", account: DEMO_ADDRESS, epoch: count, amount: "1000" }]);
    await flush();
    // The folded row is held above the newest page's oldest event; it must not hide the gap.
    expect(epochsOf(history)[0]).toBe(count);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    await flush();
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "ready" });
    // The coverage rebuilt: paging down reaches every epoch, the ones below the stop-time mark included.
    while (moreRemain(history.getSnapshot().data)) await history.loadMore();
    expect(epochsOf(history)).toEqual(Array.from({ length: count }, (_, i) => count - i));
    restart();
  });

  it("keeps the stop-time mark through a second stop before the recheck, so a stream row folded meanwhile cannot hide the gap", async () => {
    const kit = await setup();
    kit.stop();
    let count = HISTORY_PAGE;
    const real = kit.node.client.history.bind(kit.node.client);
    vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params): Promise<HistoryPage> => {
      if (params.kind !== "distribution_allocated") return real(address, params);
      const events = () => Array.from({ length: count }, (_, i) => ({ type: "distribution_allocated" as const, account: DEMO_ADDRESS, epoch: count - i, amount: "1000", cursor: `${count - i}:0`, ts: count - i }));
      const older = events().filter((event) => params.before === undefined || Number(event.cursor.split(":")[0]) < Number(params.before.split(":")[0]));
      const served = older.slice(0, params.limit ?? 50);
      return { events: served, next: older.length > served.length ? (served[served.length - 1]?.cursor ?? null) : null };
    });
    const history = new DistributionHistoryReads(kit.store);
    const stop = history.start(() => false);
    await flush();
    stop();
    // Epochs 1 to 50 are read; 70 more close while the reads are stopped.
    count = 2 * HISTORY_PAGE + 20;
    const resume = history.start(() => false);
    // The stream folds the newest, and the reads stop again before the recheck's tick.
    for (let i = 0; i < 100; i += 1) kit.node.client.state.emit({ type: "tick" }, []);
    kit.node.client.state.emit({ type: "tick" }, [{ type: "distribution_allocated", account: DEMO_ADDRESS, epoch: count, amount: "1000" }]);
    await flush();
    resume();
    const second = history.start(() => false);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    await flush();
    // The recheck's page does not reach epoch 50: the coverage was rebuilt, and paging down reaches every epoch.
    while (moreRemain(history.getSnapshot().data)) await history.loadMore();
    expect(epochsOf(history)).toEqual(Array.from({ length: count }, (_, i) => count - i));
    second();
  });
});

describe("DistributionHistoryReads across a change of verified enclave", () => {
  const enclave = (address: string) => ({ kind: "verified", release: "r", config: "c", address }) as const;

  it("reads afresh when the reads restart under another verified enclave, and keeps its rows under the same one", async () => {
    const { history, pages, stop, store } = await started({ epochs: 30 });
    stop();
    store.patch({ attestation: enclave("0xA1") });
    const first = history.start(() => false);
    await flush();
    first();
    store.patch({ attestation: { kind: "reverifying" } });
    store.patch({ attestation: enclave("0xa1") });
    pages.mockClear();
    const same = history.start(() => false);
    expect(epochsOf(history)).toHaveLength(30);
    expect(mine(pages)).toEqual([]);
    same();
    store.patch({ attestation: { kind: "reverifying" } });
    store.patch({ attestation: enclave("0xB2") });
    const other = history.start(() => false);
    expect(history.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, status: "reading" });
    expect(epochsOf(history)).toEqual([]);
    await flush();
    expect(mine(pages)).toHaveLength(2);
    expect(epochsOf(history)).toHaveLength(30);
    other();
  });
});

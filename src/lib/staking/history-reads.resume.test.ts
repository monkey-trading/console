/** Tests for the distribution-history reads' stop and restart: what a tab switch keeps, and how the reads resume. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryPage } from "../engine/types";
import { DEMO_ADDRESS } from "../mock/demo";
import { flush, setup } from "../monkey/panel-kit";
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
});

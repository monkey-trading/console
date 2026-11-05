/** Tests for the distribution-history reads' stop and restart: what a tab switch keeps, and how the reads resume. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ADDRESS } from "../mock/demo";
import { flush, setup } from "../monkey/panel-kit";
import { DistributionHistoryReads, RETRY_TICK_MS } from "./history-reads";
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

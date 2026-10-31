/** Tests for reopening the scan-merged candles a corrected close moves. */

import { describe, expect, it } from "vitest";

import { flush, MARKS, storeOver, T } from "./bars-scan-kit";
import { BTC, FakeClient } from "./live-fake";

describe("reopening candles a merge moved", () => {
  it("opens the first live candle at the prefix's close even across a gap, as pushTick carries it", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(T);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    // History ends a bucket early; the live candle still opens at the prefix's close.
    resolveScan?.([{ market: 1, ts: T - 120_000, mid: 100 }]);
    await flush();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ time: (T - 120_000) / 1000, close: 100 });
    expect(bars[1]).toEqual({
      time: liveBar.time,
      open: 100,
      high: Math.max(liveBar.high, 100),
      low: Math.min(liveBar.low, 100),
      close: liveBar.close,
      observedHigh: liveBar.observedHigh,
      observedLow: liveBar.observedLow,
    });
  });

  it("bounds an extreme that came solely from a replaced open when the correction moves down", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const LOW: typeof BTC = { ...BTC, mark: "50" };
    client.marketList = [LOW];
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(T);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    store.patch({ now: T + 30_000 }); // the live tick lands after the scan's newest mark
    await store.refresh(false);
    await flush();
    resolveScan?.([...MARKS, { market: 1, ts: T + 60_000, mid: 102 }]);
    await flush();
    const successor = store.getSnapshot().bars[1]?.["1m"].find((bar) => bar.time === (T + 60_000) / 1000);
    expect(successor).toEqual({ time: (T + 60_000) / 1000, open: 50, high: 102, low: 50, close: 102, observedHigh: 102, observedLow: 102 });
  });

  it("opens the first live candle at the scanned prefix's close when the history ends in the preceding bucket", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(T);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    resolveScan?.([{ market: 1, ts: T - 60_000, mid: 100 }]);
    await flush();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ time: (T - 60_000) / 1000, close: 100 });
    expect(bars[1]).toEqual({
      time: liveBar.time,
      open: 100,
      high: Math.max(liveBar.high, 100),
      low: Math.min(liveBar.low, 100),
      close: liveBar.close,
      observedHigh: liveBar.observedHigh,
      observedLow: liveBar.observedLow,
    });
  });

  it("keeps a live tick's low that coincides with the superseded synthetic open", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const atMark = (mark: string): typeof BTC => ({ ...BTC, mark });
    client.marketList = [atMark("100")];
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(T);
    await flush();
    // The candle under T+60 s opens synthetically at 105 and its ticks print 106 then 107, so
    // the bar's low of 105 is the carried open, not an observation.
    client.marketList = [atMark("105")];
    store.patch({ now: T + 30_000 });
    await store.refresh(false);
    await flush();
    client.marketList = [atMark("106")];
    store.patch({ now: T + 61_000 });
    await store.refresh(false);
    await flush();
    client.marketList = [atMark("107")];
    store.patch({ now: T + 90_000 });
    await store.refresh(false);
    await flush();
    // The scan reads bucket T to its last live tick and closes it at 110; the reopened successor
    // must keep the observed tick low 106, which the bar's low hid as the synthetic open.
    resolveScan?.([{ market: 1, ts: T, mid: 100 }, { market: 1, ts: T + 30_000, mid: 110 }]);
    await flush();
    const successor = store.getSnapshot().bars[1]?.["1m"].find((bar) => bar.time === (T + 60_000) / 1000);
    expect(successor).toEqual({
      time: (T + 60_000) / 1000,
      open: 110,
      high: 110,
      low: 106,
      close: 107,
      observedHigh: 107,
      observedLow: 106,
    });
  });

});

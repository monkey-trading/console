/** Tests for merging the scan's history into the bars the stream built while the scan ran. */

import { describe, expect, it } from "vitest";

import { flush, MARKS, storeOver, T } from "./bars-scan-kit";
import { BTC, FakeClient } from "./live-fake";

describe("merging scanned history with live bars", () => {
  it("merges the scan's history into the bars the stream built while it ran, bucket by bucket", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let scanStarted = false;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => {
      scanStarted = true;
      return new Promise((resolve) => { resolveScan = resolve; });
    };
    const store = storeOver(client);
    store.start(0);
    await flush();
    expect(scanStarted).toBe(true);
    // While the scan runs, a refresh places the live candle from the market's mark.
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    resolveScan?.(MARKS);
    await flush();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ time: (T - 60_000) / 1000, close: 100 });
    // The bucket the live candle sits in merges: the scanned bar's open (a bucket opens at the
    // previous close), the extrema of both, and the close of the later observation. The scan's
    // newest mark is stamped at the live bar's last tick, so the replay's close stands.
    const merged = bars[1];
    if (!merged) throw new Error("no merged bar");
    expect(merged).toEqual({
      time: liveBar.time,
      open: 100,
      high: Math.max(101, liveBar.high),
      low: Math.min(100, liveBar.low),
      close: 101,
    });
  });

  it("keeps the live close when the live candle's last tick is the later observation", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    // The candle is ticked again after the scan's newest mark: the live close is later.
    store.patch({ now: T + 30_000 });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    resolveScan?.(MARKS);
    await flush();
    const merged = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!merged) throw new Error("no merged bar");
    expect(merged.close).toBe(liveBar.close);
  });

  it("keeps the scanned close when the store clock advances without ticking the live candle, as at a close", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    // The market closes: ticks stop, and a closed-market tick advances the clock without touching
    // the candle. The scan's final observation is still the later one.
    store.patch({ now: T + 120_000 });
    resolveScan?.(MARKS);
    await flush();
    const merged = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!merged) throw new Error("no merged bar");
    expect(merged.close).toBe(101);
  });

  it("opens the first live candle at the prefix's close even across a gap, as pushTick carries it", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
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
    });
  });

  it("takes the scanned close when its last observation is the latest, as at a session's final price", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    // The scan's newest mark is stamped at the merge instant: it is the later observation, and
    // the forming bucket takes its close — the final price a session closed on is not rewritten.
    resolveScan?.(MARKS);
    await flush();
    const merged = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!merged) throw new Error("no merged bar");
    expect(merged.close).toBe(101);
  });

  it("keeps the live close when thinning dropped the bucket's later scanned observation", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
    await flush();
    // The live candle captures the bucket's price at T+30 s.
    store.patch({ now: T + 30_000 });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    // The scan retained the bucket's T price and read into the next bucket, but thinning dropped
    // the bucket's T+30 s price: the live close is the later observation and stands.
    resolveScan?.([{ market: 1, ts: T, mid: 100 }, { market: 1, ts: T + 60_000, mid: 102 }]);
    await flush();
    const merged = store.getSnapshot().bars[1]?.["1m"].find((bar) => bar.time === T / 1000);
    if (!merged) throw new Error("no merged bucket");
    expect(merged.close).toBe(liveBar.close);
    // The next candle opens at the merged close, whoever holds it; a wick that came solely from
    // the obsolete carried open is a price no observation in the bucket touched, so it is
    // bounded by the corrected open and the close.
    const successor = store.getSnapshot().bars[1]?.["1m"].find((bar) => bar.time === (T + 60_000) / 1000);
    expect(successor).toEqual({ time: (T + 60_000) / 1000, open: liveBar.close, high: liveBar.close, low: 102, close: 102 });
  });

  it("bounds an extreme that came solely from a replaced open when the correction moves down", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    const LOW: typeof BTC = { ...BTC, mark: "50" };
    client.marketList = [LOW];
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
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
    expect(successor).toEqual({ time: (T + 60_000) / 1000, open: 50, high: 102, low: 50, close: 102 });
  });

  it("compares each bucket against its own last live tick, not the market's latest", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
    await flush();
    // The live candle of the bucket ticks at T+55 s; the next bucket ticks at T+61 s.
    store.patch({ now: T + 55_000 });
    await store.refresh(false);
    await flush();
    store.patch({ now: T + 61_000 });
    await store.refresh(false);
    await flush();
    // The interrupted scan's newest observation lands in the earlier bucket, later than that
    // bucket's last live tick: its scanned close stands.
    resolveScan?.([{ market: 1, ts: T + 59_000, mid: 101 }]);
    await flush();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    const earlier = bars.find((bar) => bar.time === T / 1000);
    if (!earlier) throw new Error("no earlier bucket");
    expect(earlier.close).toBe(101);
  });

  it("takes the scanned close for a bucket the scan demonstrably read past, even after the live candle moved on", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
    await flush();
    store.patch({ now: T });
    await store.refresh(false);
    await flush();
    const liveBar = store.getSnapshot().bars[1]?.["1m"].at(-1);
    if (!liveBar) throw new Error("no live bar");
    // The bucket completes while the scan is pending, and the scan's next bucket proves it read
    // past this one: the scanned close is the later, complete observation.
    store.patch({ now: T + 120_000 });
    resolveScan?.([...MARKS, { market: 1, ts: T + 60_000, mid: 102 }]);
    await flush();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    const merged = bars.at(-2);
    if (!merged) throw new Error("no merged bar");
    expect(merged).toEqual({
      time: liveBar.time,
      open: 100,
      high: Math.max(101, liveBar.high),
      low: Math.min(100, liveBar.low),
      close: 101,
    });
    expect(bars.at(-1)).toMatchObject({ time: (T + 60_000) / 1000, close: 102 });
  });

  it("opens the first live candle at the scanned prefix's close when the history ends in the preceding bucket", async () => {
    const client = new FakeClient();
    client.headSeq = 500_000;
    let resolveScan: ((marks: typeof MARKS) => void) | undefined;
    client.scanMarks = () => new Promise((resolve) => { resolveScan = resolve; });
    const store = storeOver(client);
    store.start(0);
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
    });
  });

});

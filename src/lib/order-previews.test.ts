/** Tests for the order previews' scheduling: one read at a time, only the latest answers, the settle wait, retries and hidden surfaces. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderPreviewRequest, OrderPreviewWire } from "./engine/portfolio-types";
import { NO_ANSWERS, OrderPreviews, SETTLE_MS } from "./order-previews";
import { previewKey, type PreviewAnswer } from "./ticket-portfolio";

const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const request = (qty: string): OrderPreviewRequest => ({ account: ACCOUNT, market: 1, side: "buy", qty, reduceOnly: false });
const key = (qty: string) => previewKey(request(qty));
const answer = (qty: string): OrderPreviewWire => ({ seq: 1, account: ACCOUNT, market: 1, side: "buy", qty, reduce_only: false, fill: null, equity: "1", initial_margin: "1", maintenance_margin: "1", refused: null });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Previews whose reads wait for the test to answer them, and whose surface the test shows and hides. */
function rig(shown = true) {
  const reads: { request: OrderPreviewRequest; resolve: (wire: OrderPreviewWire) => void; reject: () => void }[] = [];
  const published: ReadonlyMap<string, PreviewAnswer>[] = [];
  const state = { shown, changes: [] as (() => void)[], unwatched: 0 };
  const previews = new OrderPreviews({
    read: (req) => new Promise((resolve, reject) => { reads.push({ request: req, resolve, reject: () => reject(new Error("refused")) }); }),
    publish: (answers) => { published.push(answers); },
    shown: () => state.shown,
    watch: (changed) => { state.changes.push(changed); return () => { state.unwatched += 1; }; },
  });
  const show = (now: boolean) => { state.shown = now; state.changes.forEach((changed) => changed()); };
  const settled = () => vi.advanceTimersByTimeAsync(SETTLE_MS);
  return { previews, reads, published, state, show, settled };
}

describe("the settle wait", () => {
  it("asks once for orders that change within it, after the last change", async () => {
    const { previews, reads } = rig();
    previews.setOrders(key("1"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    previews.setOrders(key("12"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(reads).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads.map((r) => r.request.qty)).toEqual(["12"]);
  });

  it("forgets the answers held when no orders are asked about", async () => {
    const { previews, published, reads, settled } = rig();
    previews.setOrders(key("1"));
    await settled();
    reads[0]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    previews.setOrders("");
    await settled();
    expect(published.at(-1)).toBe(NO_ANSWERS);
  });
});

describe("reads and their answers", () => {
  it("makes one read at a time for the same orders, however often it is asked to refresh", async () => {
    const { previews, reads, settled } = rig();
    previews.setOrders(key("1"));
    await settled();
    previews.refresh();
    previews.refresh();
    expect(reads).toHaveLength(1);
  });

  it("asks again at the next refresh once the read has been answered", async () => {
    const { previews, reads, published, settled } = rig();
    previews.setOrders(key("1"));
    await settled();
    reads[0]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published.at(-1)?.get(key("1"))).toEqual(answer("1"));
    previews.refresh();
    expect(reads).toHaveLength(2);
  });

  it("drops the answer of a superseded read, so one size never shows another's verdict", async () => {
    const { previews, reads, published, settled } = rig();
    previews.setOrders(key("1"));
    await settled();
    previews.setOrders(key("2"));
    await settled();
    expect(reads.map((r) => r.request.qty)).toEqual(["1", "2"]);
    reads[0]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toHaveLength(0);
    reads[1]?.resolve(answer("2"));
    await vi.advanceTimersByTimeAsync(0);
    expect([...published.at(-1)?.keys() ?? []]).toEqual([key("2")]);
  });

  it("drops a superseded read's answer even when its orders are asked about again, which a newer read answers", async () => {
    const { previews, reads, published, settled } = rig();
    for (const qty of ["1", "2", "1"]) {
      previews.setOrders(key(qty));
      await settled();
    }
    expect(reads.map((r) => r.request.qty)).toEqual(["1", "2", "1"]);
    // The first read is for the orders now asked about, but a later read of them is on its way.
    reads[0]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toHaveLength(0);
    reads[2]?.resolve({ ...answer("1"), seq: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(published.at(-1)?.get(key("1"))).toMatchObject({ seq: 3 });
  });

  it("drops an answer for orders that changed while its read was on its way, and one landing after stop", async () => {
    const { previews, reads, published, settled } = rig();
    previews.setOrders(key("1"));
    await settled();
    previews.setOrders(key("2"));
    reads[0]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toHaveLength(0);
    await settled();
    previews.stop();
    reads[1]?.resolve(answer("2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toHaveLength(0);
  });

  it("publishes a failed read as failed and asks again at the next refresh, replacing it with the answer", async () => {
    const { previews, reads, published, settled } = rig();
    previews.setOrders(key("1"));
    await settled();
    reads[0]?.reject();
    await vi.advanceTimersByTimeAsync(0);
    expect(published.at(-1)?.get(key("1"))).toBe("failed");
    previews.refresh();
    expect(reads).toHaveLength(2);
    reads[1]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published.at(-1)?.get(key("1"))).toEqual(answer("1"));
  });

  it("stops its timer and its watching when stopped", async () => {
    const { previews, reads, state, settled } = rig();
    previews.setOrders(key("1"));
    previews.stop();
    await settled();
    expect([reads.length, state.unwatched]).toEqual([0, 1]);
  });
});

describe("a surface that is hidden", () => {
  it("is not asked about, and is asked about as soon as it is shown with the orders, account and clock unchanged", async () => {
    const { previews, reads, show, settled } = rig(false);
    previews.setOrders(key("1"));
    await settled();
    previews.refresh();
    expect(reads).toHaveLength(0);
    show(true);
    expect(reads.map((r) => r.request.qty)).toEqual(["1"]);
  });

  it("asks nothing when a change leaves it hidden or shown, and asks again each time it is shown anew", async () => {
    const { previews, reads, show, settled } = rig(false);
    previews.setOrders(key("1"));
    await settled();
    show(false);
    expect(reads).toHaveLength(0);
    show(true);
    reads[0]?.resolve(answer("1"));
    await vi.advanceTimersByTimeAsync(0);
    show(true);
    expect(reads).toHaveLength(1);
    show(false);
    show(true);
    expect(reads).toHaveLength(2);
  });
});

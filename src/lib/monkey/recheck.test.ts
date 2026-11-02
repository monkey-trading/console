/** Tests for reading a disagreeing vault checkpoint and proof again by themselves. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RECHECK_MS, CHECK_GRACE_MS } from "./verdict";
import { PairCheck, pairDisagrees } from "./recheck";
import { flush, setup } from "./panel-kit";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const proofAt = (seq: number) => ({ seq, entitled: "100", root: "0x", account: "0x", siblings: [] as string[], period: 1, newest_seq: seq, newest_entitled: "100" });

describe("a pair that disagrees", () => {
  it("is told apart from one that meets, for the emissions panel", async () => {
    const { store, panel, stop } = await setup();
    await flush();
    store.patch({ entitlement: proofAt(10) as never, emissionsVault: { claimed: 0n, latestSeq: 9 } });
    expect(pairDisagrees(store, panel.getSnapshot())).toBe(true);
    store.patch({ emissionsVault: { claimed: 0n, latestSeq: 10 } });
    expect(pairDisagrees(store, panel.getSnapshot())).toBe(false);
    store.patch({ emissionsVault: { claimed: 0n, latestSeq: 11 } });
    expect(pairDisagrees(store, panel.getSnapshot())).toBe(true);
    stop();
  });

  it("is read again every two seconds for the grace period and then left to the page's slower timer, and stops once it meets", async () => {
    const { store, panel, stop } = await setup();
    await flush();
    store.patch({ entitlement: proofAt(10) as never, emissionsVault: { claimed: 0n, latestSeq: 9 } });
    const check = new PairCheck();
    const reread = vi.fn(async () => { check.after(store, panel.getSnapshot(), () => true, reread); });
    check.after(store, panel.getSnapshot(), () => true, reread);
    await vi.advanceTimersByTimeAsync(RECHECK_MS - 1);
    expect(reread).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reread).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_GRACE_MS * 2);
    expect(reread).toHaveBeenCalledTimes(CHECK_GRACE_MS / RECHECK_MS);
    // Meeting resets it.
    store.patch({ emissionsVault: { claimed: 0n, latestSeq: 10 } });
    check.after(store, panel.getSnapshot(), () => true, reread);
    store.patch({ emissionsVault: { claimed: 0n, latestSeq: 9 } });
    check.after(store, panel.getSnapshot(), () => true, reread);
    await vi.advanceTimersByTimeAsync(RECHECK_MS);
    expect(reread).toHaveBeenCalledTimes(CHECK_GRACE_MS / RECHECK_MS + 1);
    check.stop();
    stop();
  });

  it("reads nothing once the page has closed", async () => {
    const { store, panel, stop } = await setup();
    await flush();
    store.patch({ entitlement: proofAt(10) as never, emissionsVault: { claimed: 0n, latestSeq: 9 } });
    const check = new PairCheck();
    const reread = vi.fn(async () => undefined);
    check.after(store, panel.getSnapshot(), () => false, reread);
    await vi.advanceTimersByTimeAsync(RECHECK_MS * 3);
    expect(reread).not.toHaveBeenCalled();
    stop();
  });
});

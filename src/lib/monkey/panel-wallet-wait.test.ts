/** Tests for the MONKEY page's wallet reads that wait behind a call the wallet has not answered. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flush, setup } from "./panel-kit";

describe("MonkeyPanel wallet reads behind an unanswered call", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says why a read still queued behind work the wallet has not finished shows nothing, and reads the node's proof meanwhile", async () => {
    const { panel, stop } = await setup();
    let finish: () => void = () => {};
    void panel.exclusive(() => new Promise<void>((resolve) => { finish = resolve; }));
    await flush();
    const queued = panel.refreshWallet(true);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(panel.getSnapshot().wallet.proof.status).toBe("ready");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(panel.getSnapshot().wallet.position).toMatchObject({ status: "failed", message: "Your wallet has not answered an earlier request." });
    finish();
    await queued;
    expect(panel.getSnapshot().wallet.position.status).toBe("ready");
    stop();
  });

  it("reports the vault's record not answering in time, and still holds the queue until the provider answers", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const record = wallet?.emissionsClaimed;
    if (wallet === null || record === undefined) throw new Error("the mock wallet reads the vault");
    wallet.emissionsClaimed = () => new Promise((resolve) => setTimeout(() => resolve(record()), 40_000));
    store.patch({ emissionsVault: null });
    const first = panel.refreshWallet(true);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(store.getSnapshot().toasts.filter((toast) => toast.text.startsWith("The vault's MONKEY record could not be read"))).toHaveLength(1);
    let second = false;
    const next = panel.refreshWallet(true).then(() => { second = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(store.getSnapshot().toasts.filter((toast) => toast.text.startsWith("The vault's MONKEY record could not be read"))).toHaveLength(1);
    // The next read's own record read times out in its turn, and is reported for that read.
    await vi.advanceTimersByTimeAsync(60_000);
    await next;
    expect(store.getSnapshot().toasts.filter((toast) => toast.text.startsWith("The vault's MONKEY record could not be read"))).toHaveLength(2);
    stop();
  });
});

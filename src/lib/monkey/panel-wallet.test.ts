/** Tests for the MONKEY page store's wallet reads: one at a time, queued behind transactions, bounded and never stale. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import { MONKEY_UNIT } from "../format";
import { stakeMonkey } from "./actions";
import { MonkeyPanel } from "./panel";
import { flush, holdReads, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MonkeyPanel wallet reads", () => {
  it("asks the wallet one thing at a time: a refresh joins the one running, and a fresh one waits behind it", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    let inFlight = 0;
    let peak = 0;
    let started = 0;
    const releases: (() => void)[] = [];
    wallet.staking = { ...staking, position: async () => {
      started += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return staking.position();
    } };
    const first = panel.refreshWallet();
    await flush();
    expect(started).toBe(1);
    const joined = panel.refreshWallet();
    const again = panel.refreshWallet();
    const fresh = panel.refreshWallet(true);
    await flush();
    expect(started).toBe(1);
    releases[0]?.();
    await flush();
    expect(started).toBe(2);
    releases[1]?.();
    await Promise.all([first, joined, again, fresh]);
    expect(peak).toBe(1);
    expect(started).toBe(2);
    stop();
  });

  it("holds a transaction behind a wallet read that is running, and the refresh after it behind the transaction", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    const events: string[] = [];
    let release: () => void = () => {};
    wallet.staking = {
      ...staking,
      position: async () => {
        events.push("read start");
        await new Promise<void>((resolve) => { release = resolve; });
        events.push("read end");
        return staking.position();
      },
      stake: async (amount, progress) => {
        events.push("stake");
        return staking.stake(amount, progress);
      },
    };
    const reading = panel.refreshWallet();
    await vi.advanceTimersByTimeAsync(0);
    const staked = stakeMonkey(panel, MONKEY_UNIT);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(["read start"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    // The transaction ran after the read; the refresh that follows it is a read of its own.
    expect(events.slice(0, 3)).toEqual(["read start", "read end", "stake"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await Promise.all([reading, staked]);
    expect(events.filter((event) => event === "read start")).toHaveLength(2);
    expect(panel.getSnapshot().wallet.position.value?.staked).toBe(12_001n * MONKEY_UNIT);
    stop();
  });

  it("does not let a refresh stand in for a transaction it queued behind, and starts a new read after it", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    let reads = 0;
    wallet.staking = { ...staking, position: async () => { reads += 1; return staking.position(); } };
    let finish: () => void = () => {};
    const transaction = panel.exclusive(() => new Promise<void>((resolve) => { finish = resolve; }));
    const refresh = panel.refreshWallet();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(0);
    finish();
    await Promise.all([transaction, refresh]);
    expect(reads).toBe(1);
    stop();
  });

  it("queues one fresh read behind a running one, however many are asked for", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    let reads = 0;
    const releases: (() => void)[] = [];
    wallet.staking = { ...staking, position: async () => { reads += 1; await new Promise<void>((resolve) => releases.push(resolve)); return staking.position(); } };
    const first = panel.refreshWallet(true);
    await vi.advanceTimersByTimeAsync(0);
    const queued = [panel.refreshWallet(true), panel.refreshWallet(true), panel.refreshWallet(true)];
    await vi.advanceTimersByTimeAsync(0);
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    releases[1]?.();
    await Promise.all([first, ...queued]);
    expect(reads).toBe(2);
    stop();
  });

  it("fails a read the wallet is slow to answer into its figures at once, and starts the next only when the provider has answered", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    let calls = 0;
    wallet.staking = { ...staking, position: () => {
      calls += 1;
      return calls === 1 ? new Promise((resolve) => setTimeout(() => resolve(staking.position()), 40_000)) : staking.position();
    } };
    const slow = panel.refreshWallet(true);
    await flush();
    const next = panel.refreshWallet(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(panel.getSnapshot().wallet.position).toMatchObject({ status: "failed", message: "Your wallet did not answer in time." });
    // What it held before stays on screen, and the provider is still busy: the next read has not started.
    expect(panel.getSnapshot().wallet.position.value?.staked).toBe(12_000n * MONKEY_UNIT);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([slow, next]);
    expect(calls).toBe(2);
    expect(panel.getSnapshot().wallet.position.status).toBe("ready");
    stop();
  });

  it("holds a wallet read that has not answered across a page closing and reopening, so the restarted page does not ask beside it and never shows what it answered", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    let inFlight = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    let reads = 0;
    wallet.staking = { ...staking, position: async () => {
      reads += 1;
      const mine = reads;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      // The first read, from before the page closed, answers with a figure the page must never show.
      return { ...(await staking.position()), ...(mine === 1 ? { staked: 999n } : {}) };
    } };
    const old = panel.refreshWallet(true);
    await flush();
    stop();
    const restart = panel.start(() => false);
    const again = panel.refreshWallet();
    await flush();
    expect(releases).toHaveLength(1);
    releases[0]?.();
    await flush();
    releases[1]?.();
    await Promise.all([old, again]);
    expect(peak).toBe(1);
    expect(panel.getSnapshot().wallet.position.value?.staked).toBe(12_000n * MONKEY_UNIT);
    restart();
  });

  it("gives a page that opens again its own read, rather than joining the one the previous page left running", async () => {
    const { store, panel, stop } = await setup();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    stop();
    const later = new MonkeyPanel(store);
    const restart = later.start(() => false);
    const reading = later.refreshWallet();
    held.release();
    await reading;
    expect(later.getSnapshot().wallet.position.status).toBe("ready");
    expect(later.getSnapshot().wallet.proof.status).toBe("ready");
    restart();
  });

  it("does not ask for the vault's record while a call the wallet has not answered is still outstanding", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    const record = wallet?.emissionsClaimed;
    if (wallet === null || staking === undefined || record === undefined) throw new Error("the mock wallet reads the vault");
    let recordAsked = false;
    wallet.emissionsClaimed = () => { recordAsked = true; return record(); };
    wallet.staking = { ...staking, position: () => new Promise((resolve) => setTimeout(() => resolve(staking.position()), 40_000)) };
    store.patch({ emissionsVault: null });
    const reading = panel.refreshWallet(true);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(panel.getSnapshot().wallet.position.status).toBe("failed");
    expect(recordAsked).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await reading;
    expect(recordAsked).toBe(true);
    stop();
  });

  it("keeps the figures it held when the node's proof read fails, and says so on the proof", async () => {
    const { node, panel, stop } = await setup();
    expect(panel.getSnapshot().wallet.proof.value).not.toBeNull();
    node.client.stats.distributions = async () => { throw new EngineError(503, "busy"); };
    await panel.refreshWallet(true);
    expect(panel.getSnapshot().wallet.proof).toMatchObject({ status: "failed", message: "busy" });
    expect(panel.getSnapshot().wallet.proof.value).not.toBeNull();
    expect(panel.getSnapshot().wallet.position.status).toBe("ready");
    stop();
  });

  it("drops a wallet read whose wallet has since changed", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    const staking = wallet?.staking;
    if (wallet === null || staking === undefined) throw new Error("the mock wallet stakes");
    let release: () => void = () => {};
    wallet.staking = { ...staking, position: async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { ...(await staking.position()), staked: 999n };
    } };
    const reading = panel.refreshWallet(true);
    await vi.advanceTimersByTimeAsync(0);
    store.liveWallet = null;
    release();
    await reading;
    expect(panel.getSnapshot().wallet.position.value?.staked).not.toBe(999n);
    stop();
  });

  it("reads the vault's record of the MONKEY claims with the wallet's other reads, so the emissions card needs no timer of its own", async () => {
    const { store, panel, stop } = await setup();
    store.patch({ emissionsVault: null });
    await panel.refreshWallet(true);
    expect(store.getSnapshot().emissionsVault).not.toBeNull();
    stop();
  });

  it("reads nothing of the wallet without one", async () => {
    const { store, panel, stop } = await setup();
    store.liveWallet = null;
    await panel.refreshWallet();
    expect(panel.getSnapshot().wallet.address).toBeNull();
    stop();
  });
});

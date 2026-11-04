/** Tests for the Staking page's chain-only read of the account's stake and delegations, against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { DEMO_ADDRESS } from "../mock/demo";
import { stakeMonkey } from "../monkey/actions";
import { WALLET_READ_EVERY_MS } from "../monkey/live-reads";
import { flush, setup } from "../monkey/panel-kit";
import { connectWallet, disconnectWallet } from "../store/actions";
import { DelegationReads } from "./delegation-reads";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function started(hidden = () => false) {
  const kit = await setup();
  const staking = kit.store.liveWallet?.staking;
  if (staking === undefined) throw new Error("the mock wallet stakes");
  const counts = { reads: 0 };
  const real = staking.delegations.bind(staking);
  staking.delegations = () => { counts.reads += 1; return real(); };
  const reads = new DelegationReads(kit.store);
  const stop = reads.start(hidden);
  await flush();
  return { ...kit, reads, stop, counts, staking };
}

describe("DelegationReads", () => {
  it("reads the account's stake and delegations from the chain on open, whatever the node's state", async () => {
    const { reads, stop, store, node, counts } = await started();
    expect(reads.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, read: { status: "ready" } });
    store.patch({ attestation: { kind: "unverified", reason: "gone" }, stream: "stale" });
    const alpha = node.client.state.operators.candidates[0]?.address ?? "";
    node.controls.moveDelegation(DEMO_ADDRESS, null, alpha, MONKEY_UNIT);
    await reads.refresh();
    expect(reads.getSnapshot().read.value?.delegations).toContainEqual({ candidate: alpha, amount: MONKEY_UNIT });
    expect(counts.reads).toBe(2);
    stop();
  });

  it("reads again every 15 seconds while the tab is visible, and not in a hidden tab", async () => {
    const visible = await started();
    await vi.advanceTimersByTimeAsync(WALLET_READ_EVERY_MS * 2);
    expect(visible.counts.reads).toBe(3);
    visible.stop();
    const hidden = await started(() => true);
    await vi.advanceTimersByTimeAsync(WALLET_READ_EVERY_MS * 2);
    expect(hidden.counts.reads).toBe(1);
    hidden.stop();
  });

  it("keeps the last answer and says why when a read fails, and drops another account's figures at once", async () => {
    const { reads, stop, staking, store } = await started();
    const held = reads.getSnapshot().read.value;
    staking.delegations = () => Promise.reject(new Error("your wallet is on chain 1, not chain 31337"));
    await reads.refresh();
    expect(reads.getSnapshot().read).toEqual({ status: "failed", value: held, message: "your wallet is on chain 1, not chain 31337" });
    disconnectWallet(store);
    await flush();
    expect(reads.getSnapshot()).toEqual({ account: null, read: { status: "unavailable", value: null, message: null } });
    await connectWallet(store, "browser");
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, read: { status: "ready" } });
    stop();
  });

  it("reads nothing for a read-only account, and forgets what it read once closed", async () => {
    const { reads, stop, store } = await started();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the mock wallet connected");
    store.liveWallet = { ...wallet, readOnly: true };
    await reads.refresh();
    expect(reads.getSnapshot().read.status).toBe("unavailable");
    stop();
    expect(reads.getSnapshot()).toEqual({ account: null, read: { status: "loading", value: null, message: null } });
  });

  it("reads again after a stake or an unstake lands, which moves the undelegated stake", async () => {
    const { reads, stop, panel, counts } = await started();
    const before = reads.getSnapshot().read.value?.staked ?? 0n;
    expect(await stakeMonkey(panel, MONKEY_UNIT)).toBe(true);
    await flush();
    expect(counts.reads).toBe(2);
    expect(reads.getSnapshot().read.value?.staked).toBe(before + MONKEY_UNIT);
    stop();
  });
});

/** Tests for what is typed in the stake and unstake fields: kept through a gap in the feed, cleared as a transaction lands, and not by its re-read. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { connectWallet, disconnectWallet } from "../store/actions";
import { stakeMonkey } from "./actions";
import { flush, holdReads, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the amounts typed on the MONKEY page", () => {
  it("survive the stop a stale feed causes, which clears the wallet's figures", async () => {
    const { panel, stop } = await setup();
    panel.setDraft("stake", "12.5");
    panel.setDraft("unstake", "3");
    stop();
    expect(panel.getSnapshot().wallet.address).toBeNull();
    const restart = panel.start(() => false);
    await panel.refreshWallet();
    expect(panel.getSnapshot().drafts).toMatchObject({ stake: "12.5", unstake: "3" });
    restart();
  });

  it("belong to the account they were typed for, and another account starts empty", async () => {
    const { store, panel, stop } = await setup();
    panel.setDraft("stake", "12.5");
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the wallet connected");
    store.liveWallet = { ...wallet, address: "0x00000000000000000000000000000000000000b2" };
    panel.setDraft("unstake", "1");
    expect(panel.getSnapshot().drafts).toMatchObject({ account: "0x00000000000000000000000000000000000000b2", stake: "", unstake: "1" });
    stop();
  });

  it("are cleared the moment the transaction lands, before the wallet is read again, and what is typed after that stays", async () => {
    const { store, panel, stop } = await setup();
    panel.setDraft("stake", "1000");
    const held = holdReads(store);
    const staked = stakeMonkey(panel, 1_000n * MONKEY_UNIT, () => panel.clearDraft("stake", "1000"));
    await flush();
    // The stake has landed and its re-read is still waiting for the wallet.
    expect(held.stakes).toBe(1);
    expect(panel.getSnapshot()).toMatchObject({ settling: true, drafts: { stake: "" } });
    expect(store.getSnapshot().notices.stake).toBeUndefined();
    panel.setDraft("stake", "7");
    held.release();
    expect(await staked).toBe(true);
    expect(panel.getSnapshot()).toMatchObject({ settling: false, drafts: { stake: "7" } });
    stop();
  });

  it("are left alone by a transaction that was refused, and by one whose field was edited while it ran", async () => {
    const { panel, stop } = await setup();
    panel.setDraft("stake", "29000");
    expect(await stakeMonkey(panel, 29_000n * MONKEY_UNIT, () => panel.clearDraft("stake", "29000"))).toBe(false);
    expect(panel.getSnapshot().drafts.stake).toBe("29000");
    panel.clearDraft("stake", "28000");
    expect(panel.getSnapshot().drafts.stake).toBe("29000");
    stop();
  });

  it("stay shut until every landed transaction's re-read has finished", async () => {
    const { panel, stop } = await setup();
    let first: () => void = () => {};
    let second: () => void = () => {};
    const one = panel.settle(new Promise<void>((resolve) => { first = resolve; }));
    const two = panel.settle(new Promise<void>((resolve) => { second = resolve; }));
    expect(panel.getSnapshot().settling).toBe(true);
    first();
    await one;
    expect(panel.getSnapshot().settling).toBe(true);
    second();
    await two;
    expect(panel.getSnapshot().settling).toBe(false);
    stop();
  });

  it("let another account's forms open while the last account's re-read still runs (monkey-trading/console#298)", async () => {
    const { panel, store, stop } = await setup();
    let release: () => void = () => {};
    const held = panel.settle(new Promise<void>((resolve) => { release = resolve; }));
    expect(panel.getSnapshot().settling).toBe(true);
    disconnectWallet(store);
    await panel.refreshWallet();
    expect(panel.getSnapshot().settling).toBe(false);
    await connectWallet(store, "browser");
    await panel.refreshWallet();
    let releaseOwn: () => void = () => {};
    const own = panel.settle(new Promise<void>((resolve) => { releaseOwn = resolve; }));
    // The earlier account's re-read ending does not open this account's forms while its own still runs.
    release();
    await held;
    expect(panel.getSnapshot().settling).toBe(true);
    releaseOwn();
    await own;
    expect(panel.getSnapshot().settling).toBe(false);
    stop();
  });
});

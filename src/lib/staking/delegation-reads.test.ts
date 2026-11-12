/** Tests for the Staking page's chain-only read of the account's stake and delegations, against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { DEMO_ADDRESS } from "../mock/demo";
import { stakeMonkey } from "../monkey/actions";
import { WALLET_READ_EVERY_MS } from "../monkey/live-reads";
import { flush, setup } from "../monkey/panel-kit";
import { connectWallet, disconnectWallet } from "../store/actions";
import { accountReadsSettled, DelegationReads, type DelegationsState } from "./delegation-reads";

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
    expect(reads.getSnapshot()).toEqual({ account: null, read: { status: "unavailable", value: null, message: null }, settling: false });
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
    expect(reads.getSnapshot()).toEqual({ account: null, read: { status: "loading", value: null, message: null }, settling: false });
  });

  it("keeps the forms shut when a landed change's read again fails, until a later read succeeds, and not for another account", async () => {
    const { reads, stop, staking, store } = await started();
    const real = staking.delegations.bind(staking);
    staking.delegations = () => Promise.reject(new Error("the wallet did not answer"));
    await reads.settleAfter();
    expect(reads.getSnapshot()).toMatchObject({ settling: true, read: { status: "failed" } });
    staking.delegations = real;
    await reads.refresh();
    expect(reads.getSnapshot()).toMatchObject({ settling: false, read: { status: "ready" } });
    // A read for one account still settling never holds another's forms shut.
    staking.delegations = () => Promise.reject(new Error("the wallet did not answer"));
    await reads.settleAfter();
    expect(reads.getSnapshot().settling).toBe(true);
    disconnectWallet(store);
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ account: null, settling: false });
    await connectWallet(store, "browser");
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, settling: false, read: { status: "ready" } });
    stop();
  });

  it("says delegation is unavailable when the build names no staking contract", async () => {
    const { reads, stop, staking } = await started();
    staking.delegations = () => Promise.resolve(null);
    await reads.refresh();
    expect(reads.getSnapshot().read).toEqual({ status: "unavailable", value: null, message: null });
    stop();
  });

  it("holds the forms shut from a landed change until its read again lands, and until every such read has", async () => {
    const { reads, stop, staking } = await started();
    const real = staking.delegations.bind(staking);
    const answers: (() => void)[] = [];
    staking.delegations = () => new Promise((resolve) => { answers.push(() => { void real().then(resolve); }); });
    const first = reads.settleAfter();
    await flush();
    expect(reads.getSnapshot().settling).toBe(true);
    const second = reads.settleAfter();
    answers.shift()?.();
    await first;
    // The second read waits behind the first, so the figures may still predate the second change.
    expect(reads.getSnapshot().settling).toBe(true);
    await flush();
    answers.shift()?.();
    await second;
    expect(reads.getSnapshot().settling).toBe(false);
    // Closing the page while one is on its way writes nothing after; what was read stays, still settling, for the next opening.
    const closing = reads.settleAfter();
    await flush();
    stop();
    let writes = 0;
    reads.subscribe(() => { writes += 1; });
    answers.shift()?.();
    await closing;
    expect(reads.getSnapshot().settling).toBe(true);
    expect(writes).toBe(0);
  });

  it("keeps the figures it read across a stop and a restart, shut as settling until a read begun after the restart succeeds (monkey-trading/console#329)", async () => {
    const { reads, stop, staking, store } = await started();
    const held = reads.getSnapshot().read.value;
    expect(held).not.toBeNull();
    expect(reads.getSnapshot().settling).toBe(false);
    stop();
    // The tab is returned to: the rows and editors the figures lay out are still there, the forms not yet open.
    expect(reads.getSnapshot()).toMatchObject({ account: DEMO_ADDRESS, read: { status: "ready", value: held }, settling: true });
    const real = staking.delegations.bind(staking);
    let answer = () => {};
    staking.delegations = () => new Promise((resolve) => { answer = () => { void real().then(resolve); }; });
    const restart = reads.start(() => false);
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ read: { status: "ready", value: held }, settling: true });
    answer();
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ read: { status: "ready" }, settling: false });
    restart();
    // A failed read after a return leaves the forms shut, with the figures held.
    staking.delegations = () => Promise.reject(new Error("the wallet did not answer"));
    const again = reads.start(() => false);
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ read: { status: "failed", value: held }, settling: true });
    again();
    // Another account's figures are never this account's: the first read after the wallet changed drops them.
    staking.delegations = real;
    disconnectWallet(store);
    await flush();
    const third = reads.start(() => false);
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ account: null, settling: false });
    third();
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

  it("joins a read still waiting behind the wallet's earlier work, but not one already asking, so reads never pile up", async () => {
    const { reads, stop, store, counts } = await started();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the mock wallet connected");
    let release = () => {};
    const busy = store.monkeySession.walletWork.work(wallet, () => new Promise<void>((resolve) => { release = resolve; }));
    await flush();
    const first = reads.refresh();
    const second = reads.refresh();
    expect(second).toBe(first);
    release();
    await busy;
    await first;
    expect(counts.reads).toBe(2);
    // Once a read is asking the wallet, a new ask queues its own, as it may follow a change the first predates.
    let answer = () => {};
    const real = store.liveWallet?.staking?.delegations;
    if (store.liveWallet?.staking === undefined || real === undefined) throw new Error("the mock wallet stakes");
    store.liveWallet.staking.delegations = () => new Promise((resolve) => { answer = () => { void real().then(resolve); }; });
    const asking = reads.refresh();
    await flush();
    const after = reads.refresh();
    expect(after).not.toBe(asking);
    answer();
    await asking;
    answer();
    await after;
    stop();
  });

  it("reads nothing for queued work once the page has closed, and backs the timer off after a failure", async () => {
    const closing = await started();
    const wallet = closing.store.liveWallet;
    if (wallet === null) throw new Error("the mock wallet connected");
    let release = () => {};
    const busy = closing.store.monkeySession.walletWork.work(wallet, () => new Promise<void>((resolve) => { release = resolve; }));
    await flush();
    const queued = closing.reads.refresh();
    closing.stop();
    release();
    await busy;
    await queued;
    expect(closing.counts.reads).toBe(1);
    const { reads, stop, staking } = await started();
    let failures = 0;
    staking.delegations = () => { failures += 1; return Promise.reject(new Error("the wallet did not answer")); };
    // Failures in a row push the timer's next read out further each time, past the 15-second pace.
    for (let i = 0; i < 4; i += 1) await reads.refresh();
    const after = failures;
    await vi.advanceTimersByTimeAsync(WALLET_READ_EVERY_MS * 2);
    expect(failures).toBe(after);
    stop();
  });
});

describe("accountReadsSettled (monkey-trading/console#328)", () => {
  const WALLET = { address: DEMO_ADDRESS };
  const read = (status: DelegationsState["read"]["status"], account: string | null = DEMO_ADDRESS): DelegationsState => ({ account, read: { status, value: null, message: null }, settling: false });

  it("waits for the account's delegations and its stake position, each answering, failing or unavailable, before the card below them shows", () => {
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("loading"), position: "ready" })).toBe(false);
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("ready"), position: "loading" })).toBe(false);
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("ready"), position: "ready" })).toBe(true);
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("failed"), position: "failed" })).toBe(true);
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("unavailable"), position: "ready" })).toBe(true);
  });

  it("never takes another account's read for this one's", () => {
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("ready", "0x00000000000000000000000000000000000000b2"), position: "ready" })).toBe(false);
    expect(accountReadsSettled({ wallet: WALLET, decided: true, delegations: read("ready", null), position: "ready" })).toBe(false);
  });

  it("waits for the page load's wallet decision, then shows with no wallet or one that reads nothing", () => {
    expect(accountReadsSettled({ wallet: null, decided: false, delegations: read("loading", null), position: "loading" })).toBe(false);
    expect(accountReadsSettled({ wallet: null, decided: true, delegations: read("loading", null), position: "loading" })).toBe(true);
    expect(accountReadsSettled({ wallet: { ...WALLET, readOnly: true }, decided: true, delegations: read("loading"), position: "loading" })).toBe(true);
  });
});

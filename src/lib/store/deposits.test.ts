/** Tests for the deposits the node has yet to credit: shown from the send, found again by the vault's events after a reload, and taken off by the node's own receipt. */

import { describe, expect, it, vi } from "vitest";

import type { HistoryEvent, StreamMessage } from "../engine/types";
import type { VaultDeposit } from "../engine/provider-deposits";
import { settle } from "../engine/test-kit";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { fixedFromInt } from "../fixed";
import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { mockHistory } from "../mock/history";
import { connectWallet, deposit } from "./actions";
import { noteSentDeposit, readPendingDeposits } from "./deposits";
import { connected, tab } from "./live-kit";
import { ConsoleStore } from "./store";

const FUNDED = { balance: 1_000_000_000n, allowance: 1_000_000_000n };
const vaultEvent = (id: bigint, amountUsdc: bigint) => ({ id, account: ACCOUNT, from: ACCOUNT, amount: amountUsdc * 1_000_000n });

/** The node's custody receipt for vault deposit `id`, as the log and the stream carry it. */
const receipt = (id: number, amount = "100") => ({ type: "custody_deposit_changed", receipt: { deposit_id: id, amount, beneficiary: { kind: "trader", account: ACCOUNT } } }) as unknown as HistoryEvent;
const credited = (...events: HistoryEvent[]): StreamMessage => ({ offset: "9:0", type: "command", seq: 9, ts: 1, cmd: { type: "tick" } as StreamMessage["cmd"], events });
const pending = (store: ConsoleStore) => store.getSnapshot().pendingDeposits;

describe("deposits on their way", () => {
  it("shows a sent deposit at once, and names the vault's id for it once the chain is read", async () => {
    const { store } = await connected({ ...FUNDED, deposits: [vaultEvent(5n, 100n)] });
    expect(pending(store)).toEqual([]);
    noteSentDeposit(store, fixedFromInt(100));
    expect(pending(store)).toEqual([{ id: null, amount: fixedFromInt(100) }]);
    await settle();
    expect(pending(store)).toEqual([{ id: "5", amount: fixedFromInt(100) }]);
  });

  it("starts from the deposit action's send", async () => {
    const { store } = await connected({ ...FUNDED, deposits: [vaultEvent(5n, 100n)] });
    await deposit(store, fixedFromInt(100));
    await settle();
    expect(pending(store)).toEqual([{ id: "5", amount: fixedFromInt(100) }]);
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("finds one still waiting after a reload, from the vault's events the node has no receipt for", async () => {
    const reloaded = await connected({ deposits: [vaultEvent(4n, 50n), vaultEvent(5n, 100n)] });
    reloaded.client.historyPage = { events: [{ ...receipt(4), cursor: "3:0", ts: 1 }], next: null };
    await readPendingDeposits(reloaded.store);
    expect(pending(reloaded.store)).toEqual([{ id: "5", amount: fixedFromInt(100) }]);
    expect(reloaded.client.historyReads.at(-1)).toEqual({ kind: "custody_deposit_changed" });
  });

  it("takes a deposit off on the node's custody receipt for its id, and a stale read does not bring it back", async () => {
    const { client, store } = await connected({ deposits: [vaultEvent(5n, 100n)] });
    await readPendingDeposits(store);
    expect(pending(store)).toHaveLength(1);
    client.deliver(credited(receipt(5)));
    expect(pending(store)).toEqual([]);
    // The history this read gets does not hold the receipt yet.
    await readPendingDeposits(store);
    expect(pending(store)).toEqual([]);
  });

  it("takes a deposit not yet named off on a credit of its amount, for a node that sends no custody receipt", async () => {
    const { client, store } = await connected(FUNDED);
    noteSentDeposit(store, fixedFromInt(100));
    await settle();
    expect(pending(store)).toEqual([{ id: null, amount: fixedFromInt(100) }]);
    client.deliver(credited({ type: "deposited", account: ACCOUNT, amount: "100" } as unknown as HistoryEvent));
    expect(pending(store)).toEqual([]);
  });

  it("keeps a deposit just sent that the vault's events do not show yet, and drops one the node already has", async () => {
    const lagging = await connected({ ...FUNDED });
    noteSentDeposit(lagging.store, fixedFromInt(100));
    await settle();
    expect(pending(lagging.store)).toEqual([{ id: null, amount: fixedFromInt(100) }]);
    // The node's credit reached the stream before the wallet's send resolved.
    const raced = await connected({ ...FUNDED, deposits: [vaultEvent(5n, 100n)] });
    raced.client.deliver(credited(receipt(5)));
    noteSentDeposit(raced.store, fixedFromInt(100));
    await settle();
    expect(pending(raced.store)).toEqual([]);
  });

  it("leaves the line as it was, and says nothing, when the chain cannot be read", async () => {
    const { store } = await connected({ ...FUNDED, fail: { eth_getLogs: { code: -32005, message: "range too large" } } });
    noteSentDeposit(store, fixedFromInt(100));
    await settle();
    expect(pending(store)).toEqual([{ id: null, amount: fixedFromInt(100) }]);
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("is dropped when another wallet connects or the wallet disconnects, and kept when the same one reconnects", async () => {
    const { store } = await connected({ deposits: [vaultEvent(5n, 100n)] });
    await readPendingDeposits(store);
    expect(pending(store)).toHaveLength(1);
    store.setWallet({ address: ACCOUNT, label: "Test wallet" });
    expect(pending(store)).toHaveLength(1);
    store.setWallet({ address: "0x00000000000000000000000000000000000000aa", label: "Other" });
    expect(pending(store)).toEqual([]);
    await readPendingDeposits(store);
    store.setWallet(null);
    expect(pending(store)).toEqual([]);
  });

  it("is read when a wallet connects, so a reload finds the deposit still waiting", async () => {
    const { store } = await tab(memoryStorage(), { deposits: [vaultEvent(5n, 100n)] });
    await connectWallet(store, "injected");
    await settle();
    expect(pending(store)).toEqual([{ id: "5", amount: fixedFromInt(100) }]);
  });

  it("shows a second deposit of the same amount that the provider does not show yet, beside the first", async () => {
    const { store } = await connected({ ...FUNDED, deposits: [vaultEvent(5n, 100n)] });
    await readPendingDeposits(store);
    noteSentDeposit(store, fixedFromInt(100));
    await settle();
    expect(pending(store)).toEqual([{ id: "5", amount: fixedFromInt(100) }, { id: null, amount: fixedFromInt(100) }]);
  });

  it("asks the vault once more when a sent deposit is not shown yet, and names it then", async () => {
    vi.useFakeTimers();
    const kit = await connected({ ...FUNDED });
    noteSentDeposit(kit.store, fixedFromInt(100));
    await vi.advanceTimersByTimeAsync(10);
    expect(pending(kit.store)).toEqual([{ id: null, amount: fixedFromInt(100) }]);
    kit.provider.options.deposits = [vaultEvent(5n, 100n)];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pending(kit.store)).toEqual([{ id: "5", amount: fixedFromInt(100) }]);
    vi.useRealTimers();
  });

  it("drops a read that a later one overtook, and one for a wallet that has gone", async () => {
    const { store, wallet } = await connected({ deposits: [vaultEvent(5n, 100n), vaultEvent(6n, 50n)] });
    if (wallet.vaultDeposits === undefined) throw new Error("the wallet reads the vault");
    let release: (logs: VaultDeposit[] | null) => void = () => undefined;
    vi.spyOn(wallet, "vaultDeposits").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const older = readPendingDeposits(store);
    await readPendingDeposits(store);
    expect(pending(store).map((d) => d.id)).toEqual(["5", "6"]);
    release([{ id: "5", amount: fixedFromInt(100) }]);
    await older;
    expect(pending(store).map((d) => d.id)).toEqual(["5", "6"]);
    const gone = readPendingDeposits(store);
    store.liveWallet = null;
    store.setWallet(null);
    await gone;
    expect(pending(store)).toEqual([]);
  });

  it("leaves the list alone for a receipt of the house or of another account, and for a later receipt of an id already credited", async () => {
    const { client, store } = await connected(FUNDED);
    noteSentDeposit(store, fixedFromInt(100));
    await settle();
    const other = { type: "custody_deposit_changed", receipt: { deposit_id: 3, amount: "100", beneficiary: { kind: "trader", account: "0x00000000000000000000000000000000000000aa" } } } as unknown as HistoryEvent;
    const house = { type: "custody_deposit_changed", receipt: { deposit_id: 4, amount: "100", beneficiary: { kind: "house" } } } as unknown as HistoryEvent;
    client.deliver(credited(other, house));
    expect(pending(store)).toHaveLength(1);
    client.deliver(credited(receipt(5)));
    expect(pending(store)).toEqual([]);
    // The same deposit's finality arrives later, and a second deposit of that amount sent since is not the one it names.
    noteSentDeposit(store, fixedFromInt(100));
    client.deliver(credited(receipt(5)));
    expect(pending(store)).toHaveLength(1);
  });

  it("shows none for a wallet that reads no chain, whose node credits at once", async () => {
    const node = createMockNode(SIM_EPOCH_MS);
    const store = new ConsoleStore({ client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory, initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS } });
    store.start(SIM_EPOCH_MS);
    await connectWallet(store, "browser");
    noteSentDeposit(store, fixedFromInt(100));
    expect(pending(store)).toEqual([]);
  });
});

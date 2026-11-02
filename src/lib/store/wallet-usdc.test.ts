/** Tests for the connected wallet's USDC in the store: its states, a read that is asked for again, a connection that ends mid-read, and the poll. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { fixedFromInt } from "../fixed";
import { connected } from "./live-kit";
import { disconnectWallet } from "./actions";
import { followWalletUsdc, readWalletUsdc, USDC_POLL_MS, type PageWatch } from "./wallet-usdc";

afterEach(() => vi.useRealTimers());

describe("readWalletUsdc", () => {
  it("holds the wallet's balance on the custody chain", async () => {
    const { store } = await connected({ balance: 7_000_000n });
    expect(store.getSnapshot().walletUsdc).toEqual({ read: { status: "unread" }, phase: "idle" });
    await readWalletUsdc(store);
    expect(store.getSnapshot().walletUsdc).toEqual({ read: { status: "held", amount: fixedFromInt(7) }, phase: "idle" });
  });

  it("names the chain a wallet on another one sits on, and does not ask it to move", async () => {
    const { provider, store } = await connected({ chainId: 1 });
    await readWalletUsdc(store);
    expect(store.getSnapshot().walletUsdc.read).toEqual({ status: "wrong_chain", chainId: 1 });
    expect(provider.calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });

  it("says the read failed, never zero, and replaces an earlier balance with it", async () => {
    const { store, wallet } = await connected({ balance: 7_000_000n });
    await readWalletUsdc(store);
    wallet.usdcBalance = async () => { throw new Error("rpc down"); };
    await readWalletUsdc(store);
    expect(store.getSnapshot().walletUsdc.read).toEqual({ status: "failed" });
  });

  it("reads nothing for a watched account, or a wallet that reads no chain", async () => {
    const { store } = await connected();
    const plain: Wallet = { address: "0x0000000000000000000000000000000000000bbb", label: "Other", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
    store.liveWallet = plain;
    await readWalletUsdc(store);
    store.liveWallet = { ...plain, readOnly: true, usdcBalance: async () => { throw new Error("must not be asked"); } };
    await readWalletUsdc(store);
    expect(store.getSnapshot().walletUsdc.read).toEqual({ status: "unread" });
  });

  it("runs one read at a time, and a poll that finds one running adds nothing", async () => {
    const { store, wallet } = await connected();
    let reads = 0;
    let answer!: () => void;
    wallet.usdcBalance = () => new Promise((resolve) => { reads += 1; answer = () => resolve({ kind: "held", amount: 1n }); });
    const first = readWalletUsdc(store);
    await readWalletUsdc(store);
    await readWalletUsdc(store);
    expect(reads).toBe(1);
    answer();
    await first;
    expect(reads).toBe(1);
  });

  it("reads again after a read already running when a mint or a deposit changed the balance, so a figure from before it never stays", async () => {
    const { store, wallet } = await connected();
    const answers: ((amount: bigint) => void)[] = [];
    wallet.usdcBalance = () => new Promise((resolve) => { answers.push((amount) => resolve({ kind: "held", amount })); });
    const first = readWalletUsdc(store);
    void readWalletUsdc(store, true);
    answers[0]?.(10n); // the read that began before the change
    await settle();
    expect(answers).toHaveLength(2);
    expect(store.getSnapshot().walletUsdc.phase).toBe("reading");
    answers[1]?.(20n);
    await first;
    expect(store.getSnapshot().walletUsdc).toEqual({ read: { status: "held", amount: 20n }, phase: "idle" });
  });

  it("drops the answer of a connection that ended, and lets the next connection read for itself", async () => {
    const { store, wallet } = await connected();
    let answer!: () => void;
    wallet.usdcBalance = () => new Promise((resolve) => { answer = () => resolve({ kind: "held", amount: 99n }); });
    const reading = readWalletUsdc(store);
    disconnectWallet(store);
    expect(store.getSnapshot().walletUsdc).toEqual({ read: { status: "unread" }, phase: "idle" });
    answer();
    await reading;
    expect(store.getSnapshot().walletUsdc.read).toEqual({ status: "unread" });
  });
});

describe("followWalletUsdc", () => {
  const page = (visible: () => boolean) => {
    const listeners = new Set<() => void>();
    const watch: PageWatch = { visible, returned: (listener) => { listeners.add(listener); return () => void listeners.delete(listener); } };
    return { watch, returnToTab: () => listeners.forEach((l) => l()), listening: () => listeners.size };
  };

  it("reads when the form appears, then slowly, not in a hidden tab, and on return to the tab", async () => {
    vi.useFakeTimers();
    const { store, wallet } = await connected();
    let reads = 0;
    wallet.usdcBalance = async () => { reads += 1; return { kind: "held", amount: 1n }; };
    let visible = true;
    const watching = page(() => visible);
    const stop = followWalletUsdc(store, watching.watch);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(USDC_POLL_MS - 1);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toBe(2);
    visible = false;
    await vi.advanceTimersByTimeAsync(USDC_POLL_MS * 3);
    expect(reads).toBe(2);
    watching.returnToTab(); // still hidden: nothing
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2);
    visible = true;
    watching.returnToTab();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(3);
    stop();
    expect(watching.listening()).toBe(0);
    await vi.advanceTimersByTimeAsync(USDC_POLL_MS * 2);
    expect(reads).toBe(3);
  });

  it("polls no faster than every 30 seconds", () => {
    expect(USDC_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });
});

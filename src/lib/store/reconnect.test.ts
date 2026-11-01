/** Tests for the stored wallet connection choice's reconnect: dispatch, fallback to pairing, and forgetting exactly the failed choice. */

import { describe, expect, it } from "vitest";

import { ACCOUNT } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { loadChoice, saveChoice, type ChoiceStorage } from "../engine/wallet-persist";
import type { WalletConnector } from "../engine/wallet";
import { reconnectWallet } from "./reconnect";
import { setup } from "./live-fake";

const WALLET: Wallet = { address: ACCOUNT, label: "Test wallet", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };

/** A storage and the connector's record of what it was asked to connect, for one reconnect test. */
function rig(choice: Parameters<typeof saveChoice>[1] | null, connect: WalletConnector["connect"] = async () => WALLET) {
  const held = new Map<string, string>();
  const persistence: ChoiceStorage = {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
  if (choice !== null) saveChoice(persistence, choice);
  const asked: string[] = [];
  const { store } = setup({ wallets: { options: [], connect: (id: string) => { asked.push(id); return connect(id); } }, persistence });
  return { asked, persistence, store };
}

const NO_WC = null;

describe("the stored connection choice's reconnect", () => {
  it("reconnects an injected choice through the provider flow and keeps it", async () => {
    const { asked, persistence, store } = rig({ kind: "injected" });
    await reconnectWallet(store, NO_WC, () => true);
    expect(asked).toEqual(["injected"]);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(loadChoice(persistence)).toEqual({ kind: "injected" });
  });

  it("keeps the choice and connects nothing when no provider is present yet", async () => {
    const { asked, persistence, store } = rig({ kind: "injected" });
    await reconnectWallet(store, NO_WC, () => false);
    expect(asked).toEqual([]);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(persistence)).toEqual({ kind: "injected" });
  });

  it("does nothing when a wallet is already connected", async () => {
    const { asked, persistence, store } = rig({ kind: "injected" });
    store.liveWallet = WALLET;
    await reconnectWallet(store, NO_WC, () => true);
    expect(asked).toEqual([]);
    expect(loadChoice(persistence)).toEqual({ kind: "injected" });
  });

  it("adopts a WalletConnect session the SDK could re-attach, without pairing", async () => {
    const { asked, persistence, store } = rig({ kind: "walletconnect", topic: "topic-1" });
    await reconnectWallet(store, { resume: async () => WALLET }, () => false);
    expect(asked).toEqual([]); // no pairing opened
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(loadChoice(persistence)).toEqual({ kind: "walletconnect", topic: "topic-1" });
  });

  it("falls back to the pairing dialog when the session did not survive the reload", async () => {
    const { asked, store } = rig({ kind: "walletconnect", topic: "topic-1" });
    await reconnectWallet(store, { resume: async () => null }, () => false);
    expect(asked).toEqual(["walletconnect"]);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
  });

  it("forgets the choice when the reconnect fails, so it does not repeat on the next load", async () => {
    const { persistence, store } = rig({ kind: "injected" }, async () => { throw new Error("declined"); });
    await reconnectWallet(store, NO_WC, () => true);
    expect(loadChoice(persistence)).toBeNull();
  });

  it("never forgets a newer choice another connect saved while the reconnect ran", async () => {
    const { persistence, store } = rig({ kind: "injected" }, async () => {
      saveChoice(persistence, { kind: "walletconnect", topic: "newer" }); // a WalletConnect pair landed meanwhile
      throw new Error("declined");
    });
    await reconnectWallet(store, NO_WC, () => true);
    expect(loadChoice(persistence)).toEqual({ kind: "walletconnect", topic: "newer" });
  });

  it("yields to a wallet the visitor connected while the SDK was loading", async () => {
    let release!: (wallet: Wallet | null) => void;
    const { asked, persistence, store } = rig({ kind: "walletconnect", topic: "topic-1" });
    const pending = new Promise<Wallet | null>((resolve) => { release = resolve; });
    const reconnecting = reconnectWallet(store, { resume: () => pending }, () => false);
    store.liveWallet = WALLET; // the visitor connected something while the SDK loaded
    release(null);
    await reconnecting;
    expect(asked).toEqual([]); // no pairing dialog over the new wallet
    expect(loadChoice(persistence)).toEqual({ kind: "walletconnect", topic: "topic-1" });
  });

  it("does nothing without storage or without a stored choice", async () => {
    const { asked, store } = rig(null);
    await reconnectWallet(store, NO_WC, () => true);
    expect(asked).toEqual([]);
  });
});

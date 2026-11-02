/** Tests for what a switch of node does to work around the connection: a connect still running on the store it leaves, and the setup popup's state. */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { memoryStorage } from "../engine/wallet-kit";
import { loadChoice, saveChoice } from "../engine/wallet-persist";
import { connectWallet, disconnectWallet } from "./actions";
import { authorizedTab, nextStore, tab } from "./live-kit";
import { moveToNode } from "./node-move";
import { reconnectWallet } from "./reconnect";
import { dismissSetup, openSetup, settleFund } from "./setup";

describe("a connect still running on the store a move leaves", () => {
  /** A wallet arriving on the old store, which counts its release and whether USDC was offered to it. */
  function arriving() {
    const seen = { released: 0, offered: 0 };
    const wallet: Wallet = {
      address: "0x00000000000000000000000000000000000000bb", label: "Late", topic: "late-topic", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x",
      disconnect: async () => { seen.released += 1; }, suggestUsdc: async () => { seen.offered += 1; return false; },
    };
    return { wallet, seen };
  }

  it("adopts and saves nothing of a wallet that answers the visitor's connect after the move, and ends it", async () => {
    const storage = memoryStorage();
    const old = await tab(storage);
    let answer = (_wallet: Wallet) => { void _wallet; };
    old.store.deps.wallets.connect = () => new Promise<Wallet>((resolve) => { answer = resolve; });
    const connecting = connectWallet(old.store, "walletconnect");
    await settle();
    const next = nextStore(storage);
    await moveToNode(old.store, next.store);
    const late = arriving();
    answer(late.wallet);
    await expect(connecting).resolves.toBe(false);
    expect(late.seen).toEqual({ released: 1, offered: 0 });
    expect(old.store.liveWallet).toBeNull();
    expect(old.store.getSnapshot().wallet).toBeNull();
    expect(old.client.chainsRead).toEqual([]);
    expect(loadChoice(storage)).toBeNull();
    expect(next.store.liveWallet).toBeNull();
  });

  it("asks no wallet, and ends one it was handed, when the move came during the wait for the last disconnect's cleanup", async () => {
    const old = await tab(memoryStorage());
    let asked = 0;
    old.store.deps.wallets.connect = async () => { asked += 1; return old.wallet; };
    let finish = () => {};
    old.store.walletCleanup = new Promise<void>((resolve) => { finish = resolve; });
    const late = arriving();
    const connecting = [connectWallet(old.store, "walletconnect"), connectWallet(old.store, "walletconnect", true, late.wallet)];
    await settle();
    await moveToNode(old.store, nextStore().store);
    finish();
    await expect(Promise.all(connecting)).resolves.toEqual([false, false]);
    expect(asked).toBe(0);
    expect(late.seen).toEqual({ released: 1, offered: 0 });
    expect(old.store.liveWallet).toBeNull();
  });

  /** A page load's reconnect of a stored WalletConnect session, held in the SDK's load, while the visitor connects the injected wallet and the session moves. */
  async function movedDuringResume() {
    const storage = memoryStorage();
    saveChoice(storage, { kind: "walletconnect", topic: "stored" });
    const old = await tab(storage);
    let land = (_wallet: Wallet | null) => { void _wallet; };
    const asked: string[] = [];
    const connector = old.store.deps.wallets.connect;
    old.store.deps.wallets.connect = (id) => { asked.push(id); return connector(id); };
    const reconnecting = reconnectWallet(old.store, { resume: () => new Promise((resolve) => { land = resolve; }), pairing: () => ({ status: "idle" }) }, () => true);
    await connectWallet(old.store, "injected");
    const next = nextStore(storage);
    await moveToNode(old.store, next.store);
    return { old, next, storage, asked, reconnecting, land: (wallet: Wallet | null) => land(wallet) };
  }

  it("opens no pairing and overwrites no choice when the SDK then finds no session, though the old store's wallet is gone", async () => {
    const { old, next, storage, asked, reconnecting, land } = await movedDuringResume();
    land(null);
    await reconnecting;
    expect(asked).toEqual(["injected"]); // the visitor's connect, and no pairing
    expect(loadChoice(storage)).toEqual({ kind: "injected" });
    expect(old.store.liveWallet).toBeNull();
    expect(next.store.liveWallet).toBe(old.wallet);
  });

  it("ends a session the SDK then finds, adopting and saving nothing of it", async () => {
    const { old, next, storage, reconnecting, land } = await movedDuringResume();
    const late = arriving();
    land(late.wallet);
    await reconnecting;
    expect(late.seen).toEqual({ released: 1, offered: 0 });
    expect(loadChoice(storage)).toEqual({ kind: "injected" });
    expect(old.store.liveWallet).toBeNull();
    expect(next.store.liveWallet).toBe(old.wallet);
  });

  it("does not end the wallet the move carried, whose connect on the new store runs on", async () => {
    const old = await authorizedTab();
    let disconnects = 0;
    old.wallet.disconnect = async () => { disconnects += 1; };
    const next = nextStore(old.storage);
    let answer = () => {};
    next.client.readChainThrough = async () => { await new Promise<void>((resolve) => { answer = resolve; }); };
    const moving = moveToNode(old.store, next.store);
    await settle();
    answer();
    await moving;
    await settle();
    expect(disconnects).toBe(0);
    expect(next.store.liveWallet).toBe(old.wallet);
  });
});

describe("the setup popup across a move", () => {
  /** A connected tab whose account has no declaration, so setup has opened for it. */
  async function needingSetup() {
    const kit = await tab(memoryStorage());
    kit.client.credited = true;
    kit.client.declared = null;
    await connectWallet(kit.store, "injected");
    expect(kit.store.getSnapshot().setup).toMatchObject({ open: true, decided: true });
    return kit;
  }

  it("stays dismissed on the new store, whose first account read would otherwise open it", async () => {
    const old = await needingSetup();
    dismissSetup(old.store);
    const next = nextStore();
    await moveToNode(old.store, next.store);
    expect(next.store.getSnapshot().accountRead).toBe(true);
    expect(next.store.getSnapshot().setup).toMatchObject({ open: false, decided: true });
  });

  it("stays open where it was left open, and keeps the faucet step settled", async () => {
    const old = await needingSetup();
    settleFund(old.store, "skipped");
    const next = nextStore();
    await moveToNode(old.store, next.store);
    expect(next.store.getSnapshot().setup).toEqual({ open: true, decided: true, fund: "skipped", deposit: null });
  });

  it("still reopens after the move for whatever a missing step blocks", async () => {
    const old = await needingSetup();
    dismissSetup(old.store);
    const next = nextStore();
    await moveToNode(old.store, next.store);
    openSetup(next.store);
    expect(next.store.getSnapshot().setup.open).toBe(true);
  });

  it("is decided by the new store's first read where the old store had not decided, and a new connection starts over", async () => {
    const old = await tab(memoryStorage());
    old.store.liveWallet = old.wallet;
    old.store.setWallet({ address: old.wallet.address, label: old.wallet.label });
    const next = nextStore();
    next.client.declared = null;
    await moveToNode(old.store, next.store);
    expect(next.store.getSnapshot().setup).toMatchObject({ open: true, decided: true });
    disconnectWallet(next.store);
    expect(next.store.getSnapshot().setup).toEqual({ open: false, decided: false, fund: null, deposit: null });
  });
});

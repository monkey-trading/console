/** Tests for which stored connection choice a Disconnect and a wallet-ended session forget. */

import { describe, expect, it } from "vitest";

import { ACCOUNT } from "../engine/wallet-kit";
import { loadChoice, saveChoice, type ChoiceStorage, type WalletChoice } from "../engine/wallet-persist";
import { disconnectWallet, walletSessionEnded } from "./actions";
import { connected } from "./live-kit";

/** A store connected as `label` (a watch account when `readOnly`) over a storage that holds `choice`, as a page load left it. */
async function stored(label: string, choice: WalletChoice | null, readOnly = false) {
  const { store, wallet } = await connected();
  const held = new Map<string, string>();
  const persistence: ChoiceStorage = {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
  if (choice !== null) saveChoice(persistence, choice);
  store.deps.persistence = persistence;
  store.liveWallet = { ...wallet, label };
  store.setWallet({ address: ACCOUNT, label, ...(readOnly ? { readOnly: true } : {}) });
  return { store, persistence };
}

const T1: WalletChoice = { kind: "walletconnect", topic: "topic-1" };
const T2: WalletChoice = { kind: "walletconnect", topic: "topic-2" };
const INJECTED: WalletChoice = { kind: "injected" };
const ENDED_TOAST = "Your wallet ended the WalletConnect session, so the console disconnected it.";

describe("Disconnect", () => {
  it("drops the wallet and forgets the stored choice, so a reload does not reconnect it", async () => {
    const { store, persistence } = await stored("WalletConnect", T1);
    disconnectWallet(store);
    expect(store.liveWallet).toBeNull();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(persistence)).toBeNull();
  });

  it("drops a read-only watch account but keeps the stored choice, which it never wrote", async () => {
    const { store, persistence } = await stored("Watching", INJECTED, true);
    disconnectWallet(store);
    expect(store.liveWallet).toBeNull();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(persistence)).toEqual(INJECTED);
  });

  it("drops the wallet when the session has no storage", async () => {
    const { store } = await stored("WalletConnect", null);
    delete store.deps.persistence;
    disconnectWallet(store);
    expect(store.liveWallet).toBeNull();
  });
});

describe("a wallet-ended session", () => {
  it("forgets the stored choice when it names the ended session, and tells the user", async () => {
    const { store, persistence } = await stored("WalletConnect", T1);
    walletSessionEnded(store, "topic-1");
    expect(store.liveWallet).toBeNull();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(persistence)).toBeNull();
    expect(store.getSnapshot().toasts).toContainEqual({ id: expect.any(Number), tone: "info", text: ENDED_TOAST });
  });

  it("keeps a newer choice another tab saved under the same key, and still disconnects this tab", async () => {
    const { store, persistence } = await stored("WalletConnect", T1);
    saveChoice(persistence, T2); // tab B connected and saved its session after tab A's
    walletSessionEnded(store, "topic-1");
    expect(store.liveWallet).toBeNull();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(persistence)).toEqual(T2);
    expect(store.getSnapshot().toasts).toContainEqual({ id: expect.any(Number), tone: "info", text: ENDED_TOAST });
  });

  it("keeps an injected choice, which names no session, and still disconnects", async () => {
    const { store, persistence } = await stored("WalletConnect", INJECTED);
    walletSessionEnded(store, "topic-1");
    expect(store.liveWallet).toBeNull();
    expect(loadChoice(persistence)).toEqual(INJECTED);
  });

  it("disconnects with nothing stored and with no storage at all", async () => {
    const empty = await stored("WalletConnect", null);
    walletSessionEnded(empty.store, "topic-1");
    expect(empty.store.liveWallet).toBeNull();
    expect(loadChoice(empty.persistence)).toBeNull();
    const bare = await stored("WalletConnect", T1);
    delete bare.store.deps.persistence;
    walletSessionEnded(bare.store, "topic-1");
    expect(bare.store.liveWallet).toBeNull();
  });

  it("leaves a wallet that is not WalletConnect, and the stored choice, alone", async () => {
    const { store, persistence } = await stored("Browser wallet", T1);
    walletSessionEnded(store, "topic-1");
    expect(store.liveWallet).not.toBeNull();
    expect(store.getSnapshot().wallet?.label).toBe("Browser wallet");
    expect(loadChoice(persistence)).toEqual(T1);
    expect(store.getSnapshot().toasts).toEqual([]);
  });
});

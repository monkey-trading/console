/** Tests for the stored wallet connection choice's reconnect: dispatch, fallback to pairing, and forgetting exactly the failed choice. */

import { describe, expect, it } from "vitest";

import { ACCOUNT } from "../engine/wallet-kit";
import { session, setup as walletConnect, URI } from "../engine/walletconnect-kit";
import type { PairingState } from "../engine/walletconnect";
import type { Wallet } from "../engine/wallet";
import { loadChoice, saveChoice, type ChoiceStorage } from "../engine/wallet-persist";
import type { WalletConnector } from "../engine/wallet";
import { reconnectWallet } from "./reconnect";
import { setup } from "./live-fake";

const WALLET: Wallet = { address: ACCOUNT, label: "Test wallet", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };

/** A storage and the connector's record of what it was asked to connect, for one reconnect test. */
function rig(choice: Parameters<typeof saveChoice>[1] | null, connect: WalletConnector["connect"] = async () => WALLET, storage = true) {
  const held = new Map<string, string>();
  const persistence: ChoiceStorage = {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
  if (choice !== null && storage) saveChoice(persistence, choice);
  const asked: string[] = [];
  const { store } = setup({ wallets: { options: [], connect: (id: string) => { asked.push(id); return connect(id); } }, ...(storage ? { persistence } : {}) });
  return { asked, persistence, store };
}

const NO_WC = null;
const OTHER: Wallet = { ...WALLET, address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", label: "Other wallet" };
const IDLE: PairingState = { status: "idle" };
const WC_CHOICE = { kind: "walletconnect", topic: "topic-1" } as const;
/** A WalletConnect connector whose pairing state is `pairing`, and which resumes to `resumed`. */
const connectorOf = (resumed: Wallet | null, pairing: PairingState = IDLE) => ({ resume: async () => resumed, pairing: () => pairing });
const errorToasts = (store: ReturnType<typeof rig>["store"]) => store.getSnapshot().toasts.filter((toast) => toast.tone === "error");

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
    await reconnectWallet(store, connectorOf(WALLET), () => false);
    expect(asked).toEqual([]); // no pairing opened
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(loadChoice(persistence)).toEqual({ kind: "walletconnect", topic: "topic-1" });
  });

  it("falls back to the pairing dialog when the session did not survive the reload", async () => {
    const { asked, store } = rig({ kind: "walletconnect", topic: "topic-1" });
    await reconnectWallet(store, connectorOf(null), () => false);
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
    const reconnecting = reconnectWallet(store, { resume: () => pending, pairing: () => IDLE }, () => false);
    store.liveWallet = WALLET; // the visitor connected something while the SDK loaded
    release(null);
    await reconnecting;
    expect(asked).toEqual([]); // no pairing dialog over the new wallet
    expect(loadChoice(persistence)).toEqual({ kind: "walletconnect", topic: "topic-1" });
  });

  it("does nothing without a stored choice", async () => {
    const { asked, store } = rig(null);
    await reconnectWallet(store, NO_WC, () => true);
    expect(asked).toEqual([]);
    expect(store.getSnapshot().wallet).toBeNull();
  });

  it("does nothing without storage", async () => {
    const { asked, store } = rig({ kind: "injected" }, undefined, false);
    expect(store.deps.persistence).toBeUndefined();
    await reconnectWallet(store, connectorOf(WALLET), () => true);
    expect(asked).toEqual([]);
    expect(store.getSnapshot().wallet).toBeNull();
  });

  it("never forgets an identical choice a wallet connected meanwhile saved", async () => {
    const r = rig({ kind: "injected" }, async () => {
      r.store.liveWallet = OTHER; // the visitor connected the browser wallet, which saved the same choice, while this request was pending
      return WALLET;
    });
    await reconnectWallet(r.store, NO_WC, () => true);
    expect(r.store.liveWallet).toBe(OTHER); // the stale request was refused, the working connection stays
    expect(r.asked).toEqual(["injected"]);
    expect(loadChoice(r.persistence)).toEqual({ kind: "injected" });
  });

  it("keeps a WalletConnect choice when no WalletConnect connector exists", async () => {
    const { asked, persistence, store } = rig(WC_CHOICE);
    await reconnectWallet(store, NO_WC, () => true);
    expect(asked).toEqual([]);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(loadChoice(persistence)).toEqual(WC_CHOICE);
  });

  it("forgets a WalletConnect choice when the pairing the fallback opens fails or is closed", async () => {
    const { asked, persistence, store } = rig(WC_CHOICE, async () => { throw new Error("You closed the WalletConnect pairing, so no wallet was connected."); });
    await reconnectWallet(store, connectorOf(null), () => false);
    expect(asked).toEqual(["walletconnect"]);
    expect(loadChoice(persistence)).toBeNull();
  });

  it("still falls back to pairing when the SDK cannot resume", async () => {
    const { asked, persistence, store } = rig(WC_CHOICE);
    await reconnectWallet(store, { resume: async () => { throw new Error("WalletConnect did not start."); }, pairing: () => IDLE }, () => false);
    expect(asked).toEqual(["walletconnect"]);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(loadChoice(persistence)).toEqual(WC_CHOICE);
  });

  it("stands down, silently, for a pairing the visitor has open", async () => {
    for (const pairing of [{ status: "preparing" }, { status: "ready", uri: URI }] as const) {
      for (const resumed of [null, WALLET]) {
        const { asked, persistence, store } = rig(WC_CHOICE);
        await reconnectWallet(store, connectorOf(resumed, pairing), () => false);
        expect(asked).toEqual([]);
        expect(store.getSnapshot().wallet).toBeNull();
        expect(errorToasts(store)).toEqual([]);
        expect(loadChoice(persistence)).toEqual(WC_CHOICE);
      }
    }
  });

  it("does not collide with the connector's own pairing, and leaves the relay socket to it", async () => {
    const env = walletConnect();
    const r = rig(WC_CHOICE, () => env.connector.connect());
    const visitor = env.connector.connect(); // the visitor picked WalletConnect; their dialog opens while the SDK loads
    await reconnectWallet(r.store, env.connector, () => false);
    expect(errorToasts(r.store)).toEqual([]); // not "A WalletConnect pairing is already open."
    expect(r.asked).toEqual([]);
    expect(loadChoice(r.persistence)).toEqual(WC_CHOICE);
    env.fake.emit("display_uri", URI);
    env.fake.pending.resolve(session("topic-1"));
    await expect(visitor).resolves.toMatchObject({ label: "WalletConnect" });
    expect(env.fake.closes).toBe(0); // the yield closed nothing under the visitor's pairing
    expect(env.fake.cleanups).toEqual([]);
  });

  it("opens no relay contact when it yields to another wallet", async () => {
    const env = walletConnect();
    const r = rig(WC_CHOICE);
    const reconnecting = reconnectWallet(r.store, env.connector, () => false);
    r.store.liveWallet = OTHER; // the visitor connected a browser wallet while the SDK loaded
    await reconnecting;
    expect(env.loads.count).toBe(1);
    expect(env.fake.connects).toEqual([]); // no pairing, so the SDK never opened a relay socket (walletconnect-idle.test.ts)
    expect(r.asked).toEqual([]);
    expect(loadChoice(r.persistence)).toEqual(WC_CHOICE);
  });
});

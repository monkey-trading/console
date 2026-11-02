/** Tests for the setup popup's state: when it opens, what closes it, where finishing it leads, and what it does as the wallet changes around it. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { SessionKeySigner } from "../engine/session-key";
import { saveSessionKey } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import vectors from "../engine/eip712-vectors.json";
import { currentStep, setupSteps } from "../setup-steps";
import { fixedFromInt } from "../fixed";
import { attestEligibility, authorizeBrowser, connectWallet, disconnectWallet } from "./actions";
import { NODE_TIME, tab, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";
import { dismissSetup, noteDeposit, openSetup, settleFund, setupFacts, setupVisible } from "./setup";
import type { ConsoleStore } from "./store";

const SCOPE = { account: ACCOUNT, chainId: vectors.chain_id, vault: VAULT };
const WATCH: Wallet = { address: ACCOUNT, label: "Watching", readOnly: true, sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };

/** A tab whose account has no declaration yet, as a fresh wallet's. */
async function fresh(credited = false) {
  const kit = await tab(memoryStorage());
  kit.client.declared = null;
  kit.client.credited = credited;
  // The node records what it is sent, and its next read says so.
  const recording = kit.client.answer;
  kit.client.answer = (posted) => {
    if (posted.route === "eligibility") kit.client.declared = "professional";
    return recording(posted);
  };
  return kit;
}

const listed = (store: ConsoleStore, faucet = false) => setupSteps(setupFacts(store.getSnapshot(), faucet));
/** The steps still to do, in order. */
const steps = (store: ConsoleStore, faucet = false) => listed(store, faucet).filter((s) => !s.done).map((s) => s.step);

describe("when the popup opens", () => {
  it("opens after a wallet connects, once the account has been read, with what remains", async () => {
    const { store } = await fresh();
    expect(store.getSnapshot().setup.open).toBe(false);
    await connectWallet(store, "injected");
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(steps(store)).toEqual(["declare", "authorize", "deposit"]);
    expect(steps(store, true)).toEqual(["fund", "declare", "authorize", "deposit"]);
    expect(listed(store, true).map((s) => s.step)).toEqual(["fund", "declare", "authorize", "deposit"]);
  });

  it("never opens for a declared wallet, whatever else it lacks: not on a reconnect, and not on a connect the user pressed", async () => {
    const reconnect = await tab(memoryStorage());
    reconnect.client.credited = true;
    await connectWallet(reconnect.store, "injected", true);
    expect(reconnect.store.getSnapshot().setup).toMatchObject({ open: false, decided: true });
    expect(setupVisible(reconnect.store.getSnapshot())).toBe(false);
    const pressed = await tab(memoryStorage());
    pressed.client.credited = false; // declared, never funded or credited
    await connectWallet(pressed.store, "injected");
    expect(pressed.store.getSnapshot().setup.open).toBe(false);
  });

  it("waits for a read that fails, and decides on the next one that succeeds", async () => {
    const { client, store } = await fresh();
    const read = client.eligibility.bind(client);
    client.eligibility = async () => { throw new EngineError(500, "not now"); };
    await connectWallet(store, "injected");
    expect(store.getSnapshot().setup).toMatchObject({ open: false, decided: false });
    client.eligibility = read;
    await store.refresh(true);
    expect(store.getSnapshot().setup).toMatchObject({ open: true, decided: true });
  });

  it("never opens for a read-only watch address", async () => {
    const { store } = await fresh();
    await connectWallet(store, "watch", true, WATCH);
    expect(store.getSnapshot().setup.open).toBe(false);
    openSetup(store);
    expect(setupVisible(store.getSnapshot())).toBe(false);
  });

  it("does not open on the faucet step alone: a declared and keyed account that never deposited reloads to nothing", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), NODE_TIME + 1000);
    const { client, provider, store } = await tab(storage);
    client.credited = false;
    await connectWallet(store, "injected", true);
    expect(store.getSnapshot()).toMatchObject({ account: null, eligibility: "professional", setup: { open: false, decided: true } });
    expect(liveSessionKey(store)).not.toBeNull();
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toEqual([]);
  });

  it("does not show for a visitor before the node has answered the access check, nor after it refuses them", async () => {
    const { client, store } = await fresh();
    let refuse!: (error: unknown) => void;
    client.accessProbe = () => new Promise<void>((_, reject) => { refuse = reject; });
    void store.checkNode();
    await settle();
    store.patch({ accessChecked: false });
    await connectWallet(store, "injected");
    expect(store.getSnapshot().setup.open).toBe(true);
    expect(setupVisible(store.getSnapshot())).toBe(false);
    refuse(new EngineError(403, "not available", { kind: "access", reason: "united_states" }));
    await settle();
    expect(store.getSnapshot().blocked).toBe("united_states");
    expect(setupVisible(store.getSnapshot())).toBe(false);
  });
});

describe("what closes it", () => {
  it("stays closed for the connection once dismissed, through later reads, until something reopens it", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    dismissSetup(store);
    await store.refresh(true);
    expect(store.getSnapshot().setup.open).toBe(false);
    openSetup(store);
    expect(setupVisible(store.getSnapshot())).toBe(true);
  });

  it("opens again on the next connection after a dismissal", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    dismissSetup(store);
    disconnectWallet(store);
    await settle();
    await connectWallet(store, "injected");
    expect(store.getSnapshot().setup.open).toBe(true);
  });

  it("hands a declaration refused for access to the gate, and shows no popup over it", async () => {
    const { client, store } = await fresh();
    await connectWallet(store, "injected");
    client.answer = () => { throw new EngineError(403, "not available", { kind: "access", reason: "united_states" }); };
    await attestEligibility(store, "professional");
    expect(store.getSnapshot().blocked).toBe("united_states");
    expect(setupVisible(store.getSnapshot())).toBe(false);
  });

  it("hands a declaration the node refuses in the log, for a region it does not serve, to the gate too", async () => {
    const { client, store } = await fresh();
    await connectWallet(store, "injected");
    client.answer = () => ({ seq: 1, events: [{ type: "eligibility_rejected", account: ACCOUNT, reason: { kind: "access", reason: "sanctioned_jurisdiction" } }] });
    await attestEligibility(store, "professional");
    expect(store.getSnapshot().blocked).toBe("sanctioned_jurisdiction");
    expect(setupVisible(store.getSnapshot())).toBe(false);
    expect(store.getSnapshot().notices.setup).toBeUndefined();
  });

  it("stays on the step, and says why, for any other refusal in the log", async () => {
    const { client, store } = await fresh();
    await connectWallet(store, "injected");
    client.answer = () => ({ seq: 1, events: [{ type: "eligibility_rejected", account: ACCOUNT, reason: { kind: "invalid_signature" } }] });
    await attestEligibility(store, "professional");
    expect(store.getSnapshot().blocked).toBeNull();
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot().notices.setup?.text).toBe("The signature was not accepted.");
  });

  it("stays on the step and tells the trader to try again later when the node limits new wallets", async () => {
    const { client, store } = await fresh();
    await connectWallet(store, "injected");
    client.answer = () => { throw new EngineError(429, "too many new wallets are being set up; try again later"); };
    expect(await attestEligibility(store, "professional")).toBe(false);
    expect(store.getSnapshot().blocked).toBeNull();
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot().notices.setup).toMatchObject({ tone: "error", text: "The node is limiting requests right now. Try again later." });
    // The same answer to the browser's authorization is told the same way.
    client.answer = () => { throw new EngineError(429, "rate limited"); };
    expect(await authorizeBrowser(store, "setup")).toBe(false);
    expect(store.getSnapshot().notices.setup?.text).toBe("The node is limiting requests right now. Try again later.");
  });

  it("stays on the step when a signature is declined, and says why", async () => {
    const kit = await tab(memoryStorage(), { fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    kit.client.declared = null;
    await connectWallet(kit.store, "injected");
    await attestEligibility(kit.store, "professional");
    expect(kit.store.getSnapshot().setup.open).toBe(true);
    expect(steps(kit.store)).toEqual(["declare", "authorize", "deposit"]);
    expect(kit.store.getSnapshot().notices.setup?.text).toBe("You declined to sign in your wallet.");
    kit.client.declared = "professional";
    await kit.store.refresh(true);
    expect(await authorizeBrowser(kit.store, "setup")).toBe(false);
    expect(kit.store.getSnapshot()).toMatchObject({ busy: false, setup: { open: true } });
    expect(steps(kit.store)).toEqual(["authorize", "deposit"]);
  });

  it("stays on the key's step when the node refuses, and lets the wallet sign from then on", async () => {
    const { client, store } = await fresh();
    await connectWallet(store, "injected");
    await attestEligibility(store, "professional");
    client.answer = () => ({ seq: 1, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: "0x0", reason: { kind: "too_many_session_keys", max: 10 } }] });
    expect(await authorizeBrowser(store, "setup")).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ sessionRefusal: { kind: "too_many_session_keys", max: 10 }, setup: { open: true } });
    expect(steps(store)).toEqual(["authorize", "deposit"]);
  });
});

describe("what finishing it does", () => {
  it("keeps every step listed and the popup open as each finishes, until the user closes it", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    await attestEligibility(store, "professional");
    expect(listed(store).map((s) => s.done)).toEqual([true, false, false]);
    await authorizeBrowser(store, "setup");
    expect(listed(store).map((s) => s.done)).toEqual([true, true, false]);
    expect(currentStep(listed(store))).toBe("deposit");
    expect(setupVisible(store.getSnapshot())).toBe(true);
  });

  it("counts the deposit credited once the account's balance rises past what it was when the wallet sent it, and not before", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    noteDeposit(store, fixedFromInt(500));
    expect(listed(store).at(-1)).toMatchObject({ step: "deposit", done: false });
    const account = { balance: fixedFromInt(500), unfinalised: 0n, equity: fixedFromInt(500), margin: 0n, positions: [], orders: [] };
    store.patch({ account });
    expect(listed(store).at(-1)).toMatchObject({ done: true, summary: "500 USDC deposited" });
    expect(setupVisible(store.getSnapshot())).toBe(true); // closing is the user's
  });

  it("measures a later deposit against the balance already there", async () => {
    const { store } = await fresh(true);
    await connectWallet(store, "injected");
    const account = { balance: fixedFromInt(900), unfinalised: 0n, equity: fixedFromInt(900), margin: 0n, positions: [], orders: [] };
    store.patch({ account });
    noteDeposit(store, fixedFromInt(100));
    expect(listed(store).at(-1)?.done).toBe(false);
    store.patch({ account: { ...account, balance: fixedFromInt(1000) } });
    expect(listed(store).at(-1)?.done).toBe(true);
  });

  it("offers the faucet until it is used or skipped, and keeps it listed done after", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    expect(steps(store, true)[0]).toBe("fund");
    settleFund(store, "skipped");
    expect(steps(store, true)).toEqual(["declare", "authorize", "deposit"]);
    expect(listed(store, true)[0]).toMatchObject({ step: "fund", done: true, summary: "Skipped" });
  });

  it("clears what the connection did when the wallet is replaced", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    settleFund(store, "minted");
    noteDeposit(store, fixedFromInt(500));
    disconnectWallet(store);
    expect(store.getSnapshot().setup).toMatchObject({ fund: null, deposit: null });
  });
});

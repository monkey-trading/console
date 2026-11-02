/** Tests for the setup popup's state: when it opens, what closes it, where finishing it leads, and what it does as the wallet changes around it. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { SessionKeySigner } from "../engine/session-key";
import { saveSessionKey } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import vectors from "../engine/eip712-vectors.json";
import { setupSteps } from "../setup-steps";
import { attestEligibility, authorizeBrowser, connectWallet, disconnectWallet } from "./actions";
import { NODE_TIME, tab, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";
import { dismissSetup, openSetup, settleFund, setupFacts, setupStepDone, setupVisible } from "./setup";
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

const steps = (store: ConsoleStore, faucet = false) => setupSteps(setupFacts(store.getSnapshot(), faucet));

describe("when the popup opens", () => {
  it("opens after a wallet connects, once the account has been read, with what remains", async () => {
    const { store } = await fresh();
    expect(store.getSnapshot().setup.open).toBe(false);
    await connectWallet(store, "injected");
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(steps(store)).toEqual(["declare", "authorize"]);
    expect(steps(store, true)).toEqual(["fund", "declare", "authorize"]);
  });

  it("opens on a stored connection's reconnect too, at the key's step for a declared account", async () => {
    const kit = await tab(memoryStorage());
    kit.client.credited = true;
    await connectWallet(kit.store, "injected", true);
    expect(setupVisible(kit.store.getSnapshot())).toBe(true);
    expect(steps(kit.store)).toEqual(["authorize"]);
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
    expect(setupStepDone(store, true)).toBeNull(); // nothing is open, so nothing can send it anywhere
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
    expect(store.getSnapshot().toasts.filter((t) => t.tone === "error")).toEqual([]);
  });

  it("stays on the step, and says why, for any other refusal in the log", async () => {
    const { client, store } = await fresh();
    await connectWallet(store, "injected");
    client.answer = () => ({ seq: 1, events: [{ type: "eligibility_rejected", account: ACCOUNT, reason: { kind: "invalid_signature" } }] });
    await attestEligibility(store, "professional");
    expect(store.getSnapshot().blocked).toBeNull();
    expect(setupVisible(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The signature was not accepted.");
  });

  it("stays on the step when a signature is declined, and says why", async () => {
    const kit = await tab(memoryStorage(), { fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    kit.client.declared = null;
    await connectWallet(kit.store, "injected");
    await attestEligibility(kit.store, "professional");
    expect(kit.store.getSnapshot().setup.open).toBe(true);
    expect(steps(kit.store)).toEqual(["declare", "authorize"]);
    expect(kit.store.getSnapshot().toasts.at(-1)?.text).toBe("You declined to sign in your wallet.");
    kit.client.declared = "professional";
    await kit.store.refresh(true);
    expect(await authorizeBrowser(kit.store)).toBe(false);
    expect(kit.store.getSnapshot()).toMatchObject({ busy: false, setup: { open: true } });
    expect(steps(kit.store)).toEqual(["authorize"]);
  });

  it("stays on the key's step when the node refuses, and lets the wallet sign from then on", async () => {
    const { client, store } = await fresh();
    client.declared = "professional";
    await connectWallet(store, "injected");
    client.answer = () => ({ seq: 1, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: "0x0", reason: { kind: "too_many_session_keys", max: 10 } }] });
    expect(await authorizeBrowser(store)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ sessionRefusal: { kind: "too_many_session_keys", max: 10 }, setup: { open: true } });
    expect(steps(store)).toEqual(["authorize"]);
  });
});

describe("what finishing it does", () => {
  it("sends a never-credited account to Funding, and closes", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    await attestEligibility(store, "professional");
    expect(setupStepDone(store, false)).toBeNull(); // the key's step remains
    await authorizeBrowser(store);
    expect(setupStepDone(store, false)).toBe("funding");
    expect(store.getSnapshot().setup.open).toBe(false);
  });

  it("just closes for a credited account", async () => {
    const { store } = await fresh(true);
    await connectWallet(store, "injected");
    await attestEligibility(store, "professional");
    await authorizeBrowser(store);
    expect(setupStepDone(store, false)).toBe("stay");
    expect(store.getSnapshot().setup.open).toBe(false);
  });

  it("goes nowhere when the popup was dismissed while the wallet asked", async () => {
    const { store, wallet } = await fresh();
    await connectWallet(store, "injected");
    await attestEligibility(store, "professional");
    const sign = wallet.sign.bind(wallet);
    let proceed!: () => void;
    wallet.sign = (request) => new Promise((resolve, reject) => { proceed = () => void sign(request).then(resolve, reject); });
    const authorizing = authorizeBrowser(store);
    await settle();
    dismissSetup(store);
    proceed();
    expect(await authorizing).toBe(true);
    expect(setupStepDone(store, false)).toBeNull();
  });

  it("offers the faucet until it is used or skipped, and counts it as a step to finish", async () => {
    const { store } = await fresh();
    await connectWallet(store, "injected");
    expect(steps(store, true)[0]).toBe("fund");
    settleFund(store);
    expect(steps(store, true)).toEqual(["declare", "authorize"]);
    await attestEligibility(store, "professional");
    await authorizeBrowser(store);
    expect(setupStepDone(store, true)).toBe("funding");
  });
});

/** Tests for setup as the wallet changes around it: another wallet connected, one that disconnects mid-signature, and reads and requests that outlast their connection. */

import { describe, expect, it } from "vitest";

import vectors from "../engine/eip712-vectors.json";
import { walletError } from "../engine/provider-errors";
import { SessionKeySigner } from "../engine/session-key";
import { saveSessionKey, sessionKeyName } from "../engine/session-key-store";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { fixedFromInt } from "../fixed";
import { setupSteps } from "../setup-steps";
import { attestEligibility, authorizeBrowser, connectWallet, deposit, disconnectWallet, storedKeyChanged } from "./actions";
import { connected, NODE_TIME, tab, VAULT } from "./live-kit";
import { liveSessionKey, loginSession } from "./session";
import { setupFacts, setupVisible } from "./setup";
import type { ConsoleStore } from "./store";

const SCOPE = { account: ACCOUNT, chainId: vectors.chain_id, vault: VAULT };
const OTHER: Wallet = { address: "0x0000000000000000000000000000000000000bbb", label: "Other", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
const steps = (store: ConsoleStore) => setupSteps(setupFacts(store.getSnapshot(), false));

/** A tab whose account has no declaration yet, as a fresh wallet's. */
async function fresh() {
  const kit = await tab(memoryStorage());
  kit.client.declared = null;
  return kit;
}

describe("as the wallet changes around it", () => {
  it("starts over for a different wallet connected while it is open, and the first wallet's login installs nothing", async () => {
    const { client, store, wallet } = await fresh();
    client.declared = "professional";
    await connectWallet(store, "injected");
    let proceed!: (signature: string) => void;
    wallet.sign = () => new Promise<string>((resolve) => { proceed = resolve; });
    const authorizing = authorizeBrowser(store);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ busy: true, prompt: expect.stringContaining("authorize this browser") });
    client.declared = null;
    await connectWallet(store, "other", false, OTHER);
    // The first wallet may never answer: its request holds nothing up for the wallet that replaced it.
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null, setup: { open: true, decided: true }, wallet: { address: OTHER.address } });
    expect(steps(store)).toEqual(["declare", "authorize"]);
    proceed(`0x${"11".repeat(65)}`);
    expect(await authorizing).toBe(false);
    expect(liveSessionKey(store)).toBeNull();
    expect(client.posted.some((p) => p.route === "session_key")).toBe(false);
  });

  it("closes when the wallet disconnects mid-signature, posts nothing for it, and reports nothing", async () => {
    const { client, store, wallet } = await fresh();
    await connectWallet(store, "injected");
    let proceed!: (signature: string) => void;
    wallet.sign = () => new Promise<string>((resolve) => { proceed = resolve; });
    const declaring = attestEligibility(store, "professional");
    await settle();
    const toasts = store.getSnapshot().toasts.length;
    disconnectWallet(store);
    expect(setupVisible(store.getSnapshot())).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
    proceed(`0x${"11".repeat(65)}`);
    await declaring;
    expect(client.posted.some((p) => p.route === "eligibility")).toBe(false);
    expect(store.getSnapshot().toasts).toHaveLength(toasts);
  });

  it("never asks the old wallet when its connection ends during the nonce read, and leaves the next connection's prompt alone", async () => {
    const { client, store, wallet } = await fresh();
    await connectWallet(store, "injected");
    let asked = 0;
    wallet.sign = async () => { asked += 1; return `0x${"11".repeat(65)}`; };
    const read = client.nonce.bind(client);
    let answer!: () => void;
    client.nonce = () => new Promise((resolve) => { answer = () => void read().then(resolve); });
    const authorizing = authorizeBrowser(store);
    await settle();
    await connectWallet(store, "other", false, OTHER);
    store.patch({ busy: true, prompt: "the next wallet's request" });
    answer();
    expect(await authorizing).toBe(false);
    expect(asked).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ busy: true, prompt: "the next wallet's request" });
  });

  it("never asks the old wallet for a declaration when its connection ends during the nonce read", async () => {
    const { client, store, wallet } = await fresh();
    await connectWallet(store, "injected");
    let asked = 0;
    wallet.sign = async () => { asked += 1; return `0x${"11".repeat(65)}`; };
    const read = client.nonce.bind(client);
    let answer!: () => void;
    client.nonce = () => new Promise((resolve) => { answer = () => void read().then(resolve); });
    const declaring = attestEligibility(store, "professional");
    await settle();
    await connectWallet(store, "other", false, OTHER);
    answer();
    expect(await declaring).toBe(false);
    expect(asked).toBe(0);
    expect(client.posted.some((p) => p.route === "eligibility")).toBe(false);
  });

  it("reports nothing for a deposit the old wallet declines after its connection ended, and still tells one that failed", async () => {
    const { store, wallet } = await fresh();
    await connectWallet(store, "injected");
    let finish!: (error: Error) => void;
    wallet.deposit = () => new Promise<string>((_, reject) => { finish = reject; });
    const declining = deposit(store, fixedFromInt(10));
    await settle();
    await connectWallet(store, "other", false, OTHER);
    const toasts = store.getSnapshot().toasts.length;
    finish(walletError({ code: 4001 }, "deposit"));
    await declining;
    expect(store.getSnapshot().toasts).toHaveLength(toasts);
    await connectWallet(store, "injected", false, wallet);
    const failing = deposit(store, fixedFromInt(10));
    await settle();
    await connectWallet(store, "other", false, OTHER);
    finish(walletError({ code: -32000, message: "the transaction reverted" }, "deposit"));
    await failing;
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("Your wallet could not deposit: the transaction reverted");
  });

  it("reports nothing when the old wallet declines after its connection ended, and leaves the next wallet's request alone", async () => {
    const { client, store, wallet } = await fresh();
    await connectWallet(store, "injected");
    let decline!: (error: Error) => void;
    wallet.sign = () => new Promise<string>((_, reject) => { decline = reject; });
    const declaring = attestEligibility(store, "professional");
    await settle();
    await connectWallet(store, "other", false, OTHER);
    store.patch({ busy: true, prompt: "the next wallet's request" });
    const toasts = store.getSnapshot().toasts.length;
    decline(new Error("You declined to sign in your wallet."));
    await declaring;
    expect(store.getSnapshot().toasts).toHaveLength(toasts);
    expect(store.getSnapshot()).toMatchObject({ busy: true, prompt: "the next wallet's request" });
    expect(client.posted.some((p) => p.route === "eligibility")).toBe(false);
  });

  it("waits while the node's attestation or feed is not ready: no prompt, no nonce read, then runs once it is", async () => {
    const { client, provider, store } = await connected();
    store.patch({ stream: "connecting" });
    client.nonceReads = 0;
    expect(await loginSession(store)).toBe(false);
    store.patch({ stream: "live", attestation: { kind: "unverified", reason: "no" } });
    expect(await loginSession(store)).toBe(false);
    expect(client.nonceReads).toBe(0);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toEqual([]);
    store.patch({ attestation: { kind: "mock" } });
    expect(await loginSession(store)).toBe(true);
  });

  it("forgets a stored key a node that holds neither the account nor its declaration cannot have, as after a restarted chain", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SessionKeySigner.generate(), NODE_TIME + 1000);
    const { client, store } = await tab(storage);
    client.declared = null;
    await connectWallet(store, "injected", true);
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(liveSessionKey(store)).toBeNull();
    expect(storage.held.has(sessionKeyName(SCOPE))).toBe(false);
    expect(store.getSnapshot().setup.open).toBe(true);
    expect(steps(store)).toEqual(["declare", "authorize"]);
  });

  it("keeps a key another tab installed while a read was on its way: the read predates it", async () => {
    const storage = memoryStorage();
    const { client, store } = await tab(storage);
    client.declared = null;
    await connectWallet(store, "injected");
    let answer!: (view: { class: null; statement: null }) => void;
    client.eligibility = () => new Promise((resolve) => { answer = resolve; });
    const reading = store.refresh(true);
    await settle();
    const key = SessionKeySigner.generate();
    saveSessionKey(storage, SCOPE, key, NODE_TIME + 1000);
    storedKeyChanged(store, sessionKeyName(SCOPE));
    answer({ class: null, statement: null });
    await reading;
    expect(liveSessionKey(store)?.address).toBe(key.address);
    expect(storage.held.has(sessionKeyName(SCOPE))).toBe(true);
  });

  it("leaves the next wallet's busy state and prompt alone when the old wallet's request finishes late", async () => {
    const { store, wallet } = await fresh();
    await connectWallet(store, "injected");
    let proceed!: (signature: string) => void;
    wallet.sign = () => new Promise<string>((resolve) => { proceed = resolve; });
    const declaring = attestEligibility(store, "professional");
    await settle();
    let progress!: (waitingFor: string) => void;
    let land!: () => void;
    const next: Wallet = { ...OTHER, deposit: (_amount, report) => new Promise<string>((resolve) => { progress = report ?? (() => {}); land = () => resolve("0x1"); }) };
    await connectWallet(store, "other", false, next);
    const depositing = deposit(store, fixedFromInt(10));
    await settle();
    progress("Confirm the deposit in your wallet.");
    expect(store.getSnapshot()).toMatchObject({ busy: true, prompt: "Confirm the deposit in your wallet." });
    proceed(`0x${"11".repeat(65)}`); // the old wallet answers at last
    await declaring;
    expect(store.getSnapshot()).toMatchObject({ busy: true, prompt: "Confirm the deposit in your wallet." });
    land();
    await depositing;
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { exitFileText, writeStoredExit } from "../engine/exit-file";
import { ACCOUNT, emptyProof, exitStorage, factsAt, FakeExitWallet, fullProof, NO_CLAIMS, recordAt, VAULT } from "../engine/exit-kit";
import { parseExitProof } from "../engine/exit-proof";
import { NO_TERMS } from "../engine/exit-steps";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { claimVaultExit, importExitFile, refundExitDeposit, registerExitClaims, startVaultExit } from "./exit-actions";
import { FakeClient } from "./live-fake";
import { ConsoleStore } from "./store";

const FILE = (seq: number) => exitFileText({ ...recordAt(seq) });
/** What the panel says of the last action. */
const said = (store: ConsoleStore) => store.getSnapshot().notices.exit?.text ?? null;

describe("the exit's actions, with no node", () => {
  let client: FakeClient;
  let exit: FakeExitWallet;
  let storage: ReturnType<typeof exitStorage>;
  let store: ConsoleStore;

  beforeEach(async () => {
    client = new FakeClient();
    client.deployment = { chainId: 31337, vault: VAULT };
    // A node that does not answer: nothing below may need it.
    client.exitError = new Error("the node is gone");
    exit = new FakeExitWallet();
    exit.vault = factsAt(100);
    storage = exitStorage();
    const wallet: Wallet = { address: ACCOUNT, label: "Test", exit, sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
    store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, exitStorage: () => storage, history: () => [], initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
    store.exit.follow({ scheduler: { setTimeout: () => null, clearTimeout: () => undefined }, hidden: () => false, nowMs: () => 0 });
    store.patch({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale" });
    store.liveWallet = wallet;
    store.patch({ wallet: { address: ACCOUNT, label: "Test" } });
    await settle();
  });

  const holding = (seq: number) => writeStoredExit(() => storage, recordAt(seq));

  describe("startVaultExit", () => {
    const DUE = 1_000 + 2_592_000;
    it("sends the root's terms once the exit is due", async () => {
      holding(100);
      exit.vault = factsAt(100, { chainNow: DUE });
      await store.exit.refresh();
      exit.onSend = () => { exit.vault = factsAt(100, { chainNow: DUE, exitStartedAt: DUE }); };
      await startVaultExit(store);
      expect(exit.sent.map((step) => step.kind)).toEqual(["start"]);
      expect(store.getSnapshot().exit.vault?.exitStartedAt).toBe(DUE);
      expect(said(store)).toBeNull();
    });
    it("takes no proof for a vault that has never had a checkpoint, which ignores the terms", async () => {
      exit.vault = factsAt(0, { hasCheckpoint: false, latestRoot: `0x${"0".repeat(64)}`, chainNow: DUE });
      await store.exit.refresh();
      await startVaultExit(store);
      expect(exit.sent).toEqual([{ kind: "start", terms: NO_TERMS }]);
    });
    it("reads the vault afresh first, and sends nothing when a checkpoint has landed since", async () => {
      holding(100);
      exit.vault = factsAt(100, { chainNow: DUE });
      await store.exit.refresh();
      exit.vault = factsAt(100, { chainNow: DUE, lastCheckpointAt: DUE });
      await startVaultExit(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBe("The vault's exit is not due, so nothing was sent.");
    });
    it("sends nothing when the vault cannot be read", async () => {
      holding(100);
      exit.vault = factsAt(100, { chainNow: DUE });
      await store.exit.refresh();
      exit.factsError = new Error("wrong chain");
      await startVaultExit(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBe("The vault could not be read, so nothing was sent.");
    });
    it("starts from exit terms the verifier accepted, though the proof gave the account nothing", async () => {
      exit.vault = factsAt(100, { chainNow: DUE });
      await store.exit.refresh();
      await importExitFile(store, JSON.stringify({ seq: 100, root: emptyProof(100).root, account: emptyProof(100), house_pending_deposits: [], calls: [] }));
      await startVaultExit(store);
      expect(exit.sent.map((step) => step.kind)).toEqual(["start"]);
    });
    it("sends nothing from a proof the vault's verifier has not accepted in this connection", async () => {
      holding(100);
      exit.vault = factsAt(100, { chainNow: DUE });
      exit.checkError = new Error("no answer");
      await store.exit.refresh();
      await startVaultExit(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toMatch(/needs a proof the vault accepts/);
    });
    it("sends nothing before it is due", async () => {
      holding(100);
      await store.exit.refresh();
      await startVaultExit(store);
      expect(exit.sent).toEqual([]);
    });
    it("sends nothing from a proof at another root", async () => {
      holding(50);
      exit.vault = factsAt(100, { chainNow: DUE });
      await store.exit.refresh();
      await startVaultExit(store);
      expect(exit.sent).toEqual([]);
    });
  });

  describe("registerExitClaims", () => {
    beforeEach(async () => {
      holding(100);
      exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
      await store.exit.refresh();
    });

    it("sends each step in the vault's order, and then reads the vault's record", async () => {
      await registerExitClaims(store);
      expect(exit.sent.map((step) => step.kind)).toEqual(["account", "approval", "queued", "distribution"]);
      expect(said(store)).toBeNull();
    });
    it("asks the vault's record first, since anyone may register for any account", async () => {
      exit.claimsHeld = { ...NO_CLAIMS, accountRegistered: true };
      await registerExitClaims(store);
      expect(exit.sent.map((step) => step.kind)).toEqual(["approval", "queued", "distribution"]);
    });
    it("sends nothing when all of it is registered", async () => {
      exit.claimsHeld = { ...NO_CLAIMS, accountRegistered: true, approvalsUsed: [1], queuedRegistered: [95], distributionRegistered: true };
      await registerExitClaims(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBeNull();
    });
    it("holds the buttons from the press, before the read that comes first", async () => {
      const pending = registerExitClaims(store);
      expect(store.getSnapshot().busy).toBe(true);
      await pending;
      expect(store.getSnapshot().busy).toBe(false);
    });
    it("sends nothing on what the vault held before, when its record cannot be read now", async () => {
      exit.claimsError = new Error("the wallet's RPC failed");
      await registerExitClaims(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBe("The vault's record could not be read, so nothing was sent.");
    });
    it("stops at a step that fails, saying why", async () => {
      exit.sendError = new Error("You declined to register your balance and positions in your wallet.");
      await registerExitClaims(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toMatch(/You declined/);
      expect(store.getSnapshot().busy).toBe(false);
    });
    it("sends nothing from a proof at another root", async () => {
      exit.vault = factsAt(200, { exitStartedAt: 5_000, chainNow: 6_000 });
      await store.exit.refresh();
      await registerExitClaims(store);
      expect(exit.sent).toEqual([]);
    });
    it("sends nothing once the window has closed", async () => {
      exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 });
      await store.exit.refresh();
      await registerExitClaims(store);
      expect(exit.sent).toEqual([]);
    });
  });

  it("claims and says what the vault paid", async () => {
    exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 });
    exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 5_000_000_000n };
    await store.exit.refresh();
    await claimVaultExit(store);
    expect(exit.sent).toEqual([{ kind: "claim" }]);
    expect(store.getSnapshot().exit.paid).toBe(4_800_000_000n);
    expect(said(store)).toBeNull();
  });

  describe("refundExitDeposit", () => {
    const pending = () => ({ kind: "refund" as const, proof: parseExitProof(fullProof(100)).pending_deposits[0] ?? (() => { throw new Error("the fixture holds a deposit"); })(), amount: 25_000_000n });
    beforeEach(async () => {
      holding(100);
      exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
      await store.exit.refresh();
    });
    it("refunds a pending deposit", async () => {
      await refundExitDeposit(store, pending());
      expect(exit.sent).toEqual([pending()]);
      expect(said(store)).toBeNull();
    });
    it("refunds a deposit the root does not hold, with no proof", async () => {
      exit.claimsHeld = { ...NO_CLAIMS, unheld: [{ id: 7, amount: 9n }] };
      const step = { kind: "refund-unheld" as const, id: 7, amount: 9n };
      await refundExitDeposit(store, step);
      expect(exit.sent).toEqual([step]);
    });
    it("sends nothing for one the vault has refunded since the page read it", async () => {
      exit.claimsHeld = { ...NO_CLAIMS, refunded: [2] };
      await refundExitDeposit(store, pending());
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBeNull();
    });
    it("sends nothing when the vault's record cannot be read", async () => {
      exit.claimsError = new Error("the wallet's RPC failed");
      await refundExitDeposit(store, pending());
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBe("The vault's record could not be read, so nothing was sent.");
    });
  });

  describe("a press, which alone may ask the wallet onto the chain", () => {
    const DUE = 1_000 + 2_592_000;
    let asked = 0;
    beforeEach(async () => {
      asked = 0;
      holding(100);
      exit.vault = factsAt(100, { chainNow: DUE });
      await store.exit.refresh();
      const wallet = store.liveWallet;
      if (wallet === null) throw new Error("the kit connects a wallet");
      wallet.ensureChain = async () => { asked += 1; };
    });
    it("asks before it reads the vault, so a wallet on another chain can still act", async () => {
      exit.factsError = new Error("your wallet is on chain 1, not chain 31337");
      const wallet = store.liveWallet;
      if (wallet === null) throw new Error("the kit connects a wallet");
      wallet.ensureChain = async () => { asked += 1; exit.factsError = null; };
      await startVaultExit(store);
      expect(asked).toBe(1);
      expect(exit.sent.map((step) => step.kind)).toEqual(["start"]);
    });
    it("sends nothing and says why when the wallet will not go", async () => {
      const wallet = store.liveWallet;
      if (wallet === null) throw new Error("the kit connects a wallet");
      wallet.ensureChain = async () => { throw new Error("You declined to switch chain."); };
      await startVaultExit(store);
      expect(exit.sent).toEqual([]);
      expect(said(store)).toBe("You declined to switch chain.");
      expect(store.getSnapshot().busy).toBe(false);
    });
    it("asks for an import too, once the file has passed what needs no wallet", async () => {
      await importExitFile(store, "{nope");
      expect(asked).toBe(0);
      await importExitFile(store, FILE(100));
      expect(asked).toBe(1);
    });
  });

  it("reaches none of it without a wallet", async () => {
    store.liveWallet = null;
    await importExitFile(store, FILE(100));
    await claimVaultExit(store);
    expect(exit.sent).toEqual([]);
  });

  it("never asks the node, in any of it", async () => {
    const DUE = 1_000 + 2_592_000;
    await importExitFile(store, FILE(100));
    exit.vault = factsAt(100, { chainNow: DUE });
    await store.exit.refresh();
    exit.onSend = (step) => { if (step.kind === "start") exit.vault = factsAt(100, { exitStartedAt: DUE, chainNow: DUE }); };
    await startVaultExit(store);
    await registerExitClaims(store);
    await refundExitDeposit(store, { kind: "refund-unheld", id: 7, amount: 9n });
    exit.vault = factsAt(100, { exitStartedAt: DUE, chainNow: DUE + 2_592_000 });
    exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 5n };
    await store.exit.refresh();
    await claimVaultExit(store);
    expect(exit.sent.map((step) => step.kind)).toEqual(["start", "account", "approval", "queued", "distribution", "claim"]);
    expect(client.exitReads).toBe(0);
    expect(client.distributionReads).toBe(0);
  });

  it("keeps a failure in the panel until the next action replaces it", async () => {
    holding(100);
    exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    await store.exit.refresh();
    exit.sendError = new Error("You declined to register your balance and positions in your wallet.");
    await registerExitClaims(store);
    await store.exit.refresh();
    expect(said(store)).toMatch(/You declined/);
    exit.sendError = null;
    await registerExitClaims(store);
    expect(said(store)).toBeNull();
  });
});

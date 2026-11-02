import { beforeEach, describe, expect, it } from "vitest";

import { exitFileText, exitStorageKey, writeStoredExit } from "../engine/exit-file";
import { ACCOUNT, emptyProof, exitStorage, factsAt, FakeExitWallet, fullProof, OTHER, recordAt, SCOPE, VAULT } from "../engine/exit-kit";
import { parseExitProof } from "../engine/exit-proof";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { importExitFile } from "./exit-actions";
import { FakeClient } from "./live-fake";
import { ConsoleStore } from "./store";

const FILE = (seq: number) => exitFileText({ ...recordAt(seq) });

describe("importing a file, with no node", () => {
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
  const refused = () => store.getSnapshot().notices.exit ?? null;

  describe("importExitFile", () => {
    it("takes a file at the vault's latest root once the verifier accepts it", async () => {
      await importExitFile(store, FILE(100));
      expect(exit.checks).toEqual([fullProof(100).root]);
      expect(store.getSnapshot().exit.record?.proof).toEqual(parseExitProof(fullProof(100)));
      expect(storage.held.has(exitStorageKey(SCOPE))).toBe(true);
      expect(refused()).toBeNull(); // the panel's saved line says it
      expect(client.exitReads).toBe(0);
    });

    it("keeps an import's refusal when a proof is saved in the background, and the next import replaces it", async () => {
      await importExitFile(store, "{nope");
      expect(refused()?.tone).toBe("error");
      await store.exit.keeper.adopter.adopt(store.liveWallet as Wallet, SCOPE, parseExitProof(fullProof(100)));
      expect(refused()?.tone).toBe("error");
      await importExitFile(store, FILE(100));
      expect(refused()).toBeNull();
    });

    it("clears a failed read of the vault once an import's own read answers", async () => {
      exit.factsError = new Error("your wallet is on chain 1, not chain 31337");
      await store.exit.refresh();
      expect(store.getSnapshot().exit.vaultFailures).toBe(1);
      exit.factsError = null;
      await importExitFile(store, FILE(100));
      expect(store.getSnapshot().exit.vaultProblem).toBeNull();
      expect(store.getSnapshot().exit.vaultFailures).toBe(0);
    });

    it("takes what the engine's offline builder prints", async () => {
      await importExitFile(store, JSON.stringify({ seq: 100, root: fullProof(100).root, account: fullProof(100), house_pending_deposits: [], calls: [] }));
      expect(store.getSnapshot().exit.record?.proof.seq).toBe(100);
    });

    const keeps = async (text: string, message: RegExp, before: () => void = () => undefined) => {
      holding(100);
      await store.exit.refresh();
      before();
      const held = storage.held.get(exitStorageKey(SCOPE));
      await importExitFile(store, text);
      expect(refused()?.tone).toBe("error");
      expect(refused()?.text).toMatch(message);
      expect(store.getSnapshot().exit.record?.proof.seq).toBe(100);
      expect(storage.held.get(exitStorageKey(SCOPE))).toBe(held);
    };

    it("refuses a malformed file, keeping what is saved", () => keeps("{nope", /not imported: it is not JSON/));
    it("refuses a file that is not a proof", () => keeps(JSON.stringify({ hello: "world" }), /not imported: it is not an exit proof/));
    it("refuses another account's proof, and says whose", () => keeps(exitFileText({ ...recordAt(100), account: OTHER, proof: fullProof(100, OTHER) }), /it is for account 0x3c44cd…93bc. Connect that wallet to import it/));
    it("refuses another deployment's, by its chain", () => keeps(exitFileText({ ...recordAt(100), chainId: 1 }), /it is for another deployment \(chain 1/));
    it("refuses another deployment's, by its vault", () => keeps(exitFileText({ ...recordAt(100), vault: OTHER }), /it is for another deployment/));
    it("refuses a proof at an older root, which the vault would never take", () => keeps(FILE(50), /it is for checkpoint 50, and the vault's latest is checkpoint 100, so the vault would refuse a claim from it/));

    it("refuses one the verifier refuses, keeping what is saved", () => keeps(FILE(100), /the vault's verifier refused it: the vault's root does not prove its exit terms/, () => {
      exit.verdict = () => ({ ok: false, reason: "the vault's root does not prove its exit terms" });
    }));

    it("refuses a file that holds less than the proof saved at its root, which proves too", () => {
      return keeps(JSON.stringify({ kind: "monkeytrading.exit-proof", version: 1, chain_id: 31337, vault: VAULT, account: ACCOUNT, proof: { ...fullProof(100), account: null, approvals: [], pending_deposits: [], distribution: null } }), /it holds less than the proof already saved for that checkpoint/);
    });

    it("refuses a file whose seq is not the vault's for that root", async () => {
      const renamed = JSON.stringify(JSON.parse(FILE(100))).replaceAll(`"seq":100`, `"seq":9000`);
      await importExitFile(store, renamed);
      expect(refused()?.text).toMatch(/the vault's verifier refused it: it names checkpoint 9000 for the root of checkpoint 100/);
      expect(store.getSnapshot().exit.record).toBeNull();
    });

    it("takes exit terms alone once the exit is due, so a depositor the root holds nothing for can start it", async () => {
      exit.vault = factsAt(100, { chainNow: 1_000 + 2_592_000 });
      await store.exit.refresh();
      await importExitFile(store, JSON.stringify({ seq: 100, root: emptyProof(100).root, account: emptyProof(100), house_pending_deposits: [], calls: [] }));
      expect(refused()).toMatchObject({ tone: "info", text: "It holds nothing for this account, but the vault accepts its exit terms, so it can start the exit." });
      expect(store.getSnapshot().exit.terms?.root).toBe(emptyProof(100).root);
      expect(store.getSnapshot().exit.record).toBeNull();
    });

    it("refuses a proof that gives the account nothing, and an empty file cannot wipe a saved proof", async () => {
      await importExitFile(store, JSON.stringify({ kind: "monkeytrading.exit-proof", version: 1, chain_id: 31337, vault: VAULT, account: ACCOUNT, proof: emptyProof(100) }));
      expect(refused()?.text).toMatch(/it gives this account nothing/);
      await keeps(JSON.stringify({ kind: "monkeytrading.exit-proof", version: 1, chain_id: 31337, vault: VAULT, account: ACCOUNT, proof: emptyProof(100) }), /it holds less than the proof already saved/);
    });

    it("says when the wallet could not check it", async () => {
      exit.factsError = new Error("wrong chain");
      await importExitFile(store, FILE(100));
      expect(refused()?.text).toMatch(/your wallet could not check it: wrong chain/);
    });

    it("says when the browser would not keep what it took, which then holds in the page", async () => {
      storage.refuseWrites = true;
      await importExitFile(store, FILE(100));
      expect(refused()).toBeNull();
      expect(store.getSnapshot().exit.storageProblem).toMatch(/the quota is exceeded/);
      expect(store.getSnapshot().exit.record?.proof.seq).toBe(100);
    });
  });
});

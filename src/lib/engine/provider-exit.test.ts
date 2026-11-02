import { toFunctionSelector, type Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { EXIT_VERIFIER } from "./exit-abi";
import { ACCOUNT, fullProof, OTHER, rootAt, VAULT } from "./exit-kit";
import { parseExitProof } from "./exit-proof";
import type { ExitProof } from "./exit-types";
import { ProviderExit } from "./provider-exit";
import { Chain, STAKING, word } from "./provider-exit-kit";

describe("ProviderExit", () => {
  let chain: Chain;
  let exit: ProviderExit;
  const proof: ExitProof = parseExitProof(fullProof(100));
  /** The vault's record of the fixture's pending deposit, in USDC base units. */
  const HELD = { payer: ACCOUNT as Hex, amount: 25_000_000n };

  beforeEach(() => {
    chain = new Chain();
    exit = new ProviderExit(ACCOUNT, { chainId: 31337, vault: VAULT, usdc: null, add: null, staking: STAKING }, chain, async (data, _action, progress) => {
      chain.sentData.push({ to: VAULT, data });
      progress("Waiting.");
      return "0xhash";
    });
  });

  describe("facts", () => {
    it("reads the vault, and the chain's own clock", async () => {
      expect(await exit.facts()).toEqual({ hasCheckpoint: true, latestSeq: 100, latestRoot: rootAt(100), lastCheckpointAt: 1_000, exitStartedAt: 0, chainNow: 2_000, exitPeriod: 2_592_000, claimWindow: 2_592_000 });
    });
    it("reads the chain's clock with a call where the wallet will not read blocks, as over WalletConnect", async () => {
      chain.readsBlocks = false;
      expect((await exit.facts()).chainNow).toBe(2_000);
    });
    it("reads the two immutables once", async () => {
      await exit.facts();
      await exit.facts();
      expect(chain.asked.filter((name) => name === "exitPeriod")).toEqual(["exitPeriod"]);
      expect(chain.asked.filter((name) => name === "latestRoot")).toEqual(["latestRoot", "latestRoot"]);
    });
    it("refuses a wallet on another chain, not asking it to move", async () => {
      chain.chainId = 1;
      await expect(exit.facts()).rejects.toThrow("your wallet is on chain 1, not chain 31337");
      expect(chain.asked).toEqual([]);
    });
    it("rejects when a read fails", async () => {
      chain.failing = "latestRoot";
      await expect(exit.facts()).rejects.toThrow("the wallet's RPC failed");
    });
  });

  describe("check", () => {
    it("asks the vault's own verifier about every part of the proof, against the given root", async () => {
      expect(await exit.check(proof, rootAt(100))).toEqual({ ok: true, paidApprovals: [], accountClaim: 5_010_000_000n, distributionOwed: 2_000_000n, finalPaidApprovals: [], finalDistributionOwed: 2_000_000n });
      expect(chain.asked.filter((name) => /^proves|accountClaim/.test(name))).toEqual(["provesTerms", "accountClaim", "provesApproval", "provesQueued", "provesDistribution", "provesPending"]);
    });
    it.each([
      ["provesTerms", "the vault's root does not prove its exit terms"],
      ["provesApproval", "the vault's root does not prove its withdrawal 1"],
      ["provesQueued", "the vault's root does not prove its queued withdrawal 95"],
      ["provesDistribution", "the vault's root does not prove its distribution"],
      ["provesPending", "the vault's root does not prove its pending deposit 2"],
    ])("refuses when %s says no", async (name, reason) => {
      chain.proves[name] = false;
      expect(await exit.check(proof, rootAt(100))).toEqual({ ok: false, reason });
    });
    it("refuses when accountClaim reverts", async () => {
      chain.reverts.add("accountClaim");
      expect(await exit.check(proof, rootAt(100))).toEqual({ ok: false, reason: "the vault's root does not prove its balance and positions" });
    });
    it("rejects, and does not call it a refusal, when the wallet is what failed", async () => {
      chain.fails.add("accountClaim");
      await expect(exit.check(proof, rootAt(100))).rejects.toThrow("the provider is rate limiting this wallet");
    });
    it("stops asking about a paid approval once a finalized block shows it", async () => {
      chain.paidNonces.add(1n);
      chain.finalNonces.add(1n);
      await exit.check(proof, rootAt(100));
      await exit.check(proof, rootAt(100));
      expect(chain.asked.filter((name) => name === "usedNonces")).toEqual(["usedNonces", "usedNonces"]); // the head's read and the finalized one, once
    });
    it("keeps asking while only the head shows it paid, as a reorganisation can undo that", async () => {
      chain.paidNonces.add(1n);
      const first = await exit.check(proof, rootAt(100));
      expect(first.ok && first.paidApprovals).toEqual([1]);
      chain.paidNonces.delete(1n);
      const second = await exit.check(proof, rootAt(100));
      expect(second.ok && second.paidApprovals).toEqual([]);
    });
    it("tells what a finalized block shows paid from what only the head does", async () => {
      chain.paidNonces.add(1n);
      chain.vault.distributionsClaimed = word("uint256", 9_000_000n);
      chain.finalVault.distributionsClaimed = word("uint256", 1_000_000n);
      expect(await exit.check(proof, rootAt(100))).toMatchObject({ paidApprovals: [1], finalPaidApprovals: [], distributionOwed: 0n, finalDistributionOwed: 2_000_000n });
      chain.finalNonces.add(1n);
      chain.finalVault.distributionsClaimed = word("uint256", 9_000_000n);
      expect(await exit.check(proof, rootAt(100))).toMatchObject({ paidApprovals: [1], finalPaidApprovals: [1], distributionOwed: 0n, finalDistributionOwed: 0n });
    });
    it.each<[string, (chain: Chain) => void]>([
      ["reads no finalized block", (held) => { held.readsFinalized = false; }],
      ["answers nothing there, as the vault was not deployed by then", (held) => { held.finalVault.distributionsClaimed = "0x"; }],
    ])("counts nothing as finally paid from a wallet that %s", async (_name, set) => {
      chain.paidNonces.add(1n);
      chain.vault.distributionsClaimed = word("uint256", 9_000_000n);
      set(chain);
      expect(await exit.check(proof, rootAt(100))).toMatchObject({ paidApprovals: [1], finalPaidApprovals: [], distributionOwed: 0n, finalDistributionOwed: 3_000_000n });
    });
    it("names an approval the vault has paid, which no claim can use now, without asking the verifier about it", async () => {
      chain.paidNonces.add(1n);
      const verdict = await exit.check(proof, rootAt(100));
      expect(verdict.ok && verdict.paidApprovals).toEqual([1]);
      expect(chain.asked).not.toContain("provesApproval");
    });
    it("owes nothing of a distribution the vault has paid in full", async () => {
      chain.vault.distributionsClaimed = word("uint256", 9_000_000n);
      const verdict = await exit.check(proof, rootAt(100));
      expect(verdict.ok && verdict.distributionOwed).toBe(0n);
    });
    it("asks about no account leaf for an account the root does not hold", async () => {
      const verdict = await exit.check({ ...proof, account: null }, rootAt(100));
      expect(verdict.ok && verdict.accountClaim).toBe(0n);
      expect(chain.asked).not.toContain("accountClaim");
    });
    it("reads the verifier's address once, from the vault", async () => {
      await exit.check(proof, rootAt(100));
      await exit.check(proof, rootAt(100));
      expect(chain.asked.filter((name) => name === "exitVerifier")).toEqual(["exitVerifier"]);
    });
    it("rejects a wallet that moved chain before the answer is taken", async () => {
      chain.chainId = 1;
      await expect(exit.check(proof, rootAt(100))).rejects.toThrow("your wallet is on chain 1");
    });
  });

  describe("claims", () => {
    it("reads each part's standing from the vault", async () => {
      chain.paidNonces.add(1n);
      chain.vault.exitAccountRegistered = word("bool", true);
      chain.deposits.set(2n, HELD);
      expect(await exit.claims(proof)).toEqual({ accountRegistered: true, distributionRegistered: false, queuedRegistered: [95], approvalsUsed: [1], refunded: [], mismatched: [], exitClaim: 7n, exitDistributionClaim: 2n, distributionPaid: 1_000_000n, unheld: [], unheldComplete: true });
    });
    it("reads what is registered with no proof", async () => {
      expect(await exit.claims(null)).toEqual({ accountRegistered: false, distributionRegistered: false, queuedRegistered: [], approvalsUsed: [], refunded: [], mismatched: [], exitClaim: 7n, exitDistributionClaim: 2n, distributionPaid: 1_000_000n, unheld: [], unheldComplete: true });
    });
    it("finds this account's deposits from the exit's cursor on, once, and leaves the refunded out", async () => {
      chain.vault.depositCount = word("uint256", 6n);
      chain.deposits.set(3n, { payer: ACCOUNT as Hex, amount: 25n });
      chain.deposits.set(4n, { payer: OTHER as Hex, amount: 9n });
      chain.deposits.set(5n, { payer: ACCOUNT as Hex, amount: 30n });
      expect((await exit.claims(null)).unheld).toEqual([{ id: 3, amount: 25n }, { id: 5, amount: 30n }]);
      expect(chain.asked.filter((name) => name === "depositRecords").length).toBe(3);
      chain.vault.depositRefunded = word("bool", true);
      expect((await exit.claims(null)).unheld).toEqual([]);
      expect(chain.asked.filter((name) => name === "depositRecords").length).toBe(3); // no deposit comes after the exit starts
    });
    it("looks at the gaps a proof names below the cursor too", async () => {
      chain.deposits.set(1n, { payer: ACCOUNT as Hex, amount: 25n });
      const gapped = { ...proof, terms: { ...proof.terms, terms: { ...proof.terms.terms, gaps: [1] } } };
      expect((await exit.claims(gapped)).unheld).toEqual([{ id: 1, amount: 25n }]);
    });
    it("reads a proof's gaps when the proof arrives after the first read", async () => {
      chain.deposits.set(1n, { payer: ACCOUNT as Hex, amount: 25n });
      expect((await exit.claims(null)).unheld).toEqual([]);
      const gapped = { ...proof, terms: { ...proof.terms, terms: { ...proof.terms.terms, gaps: [1] } } };
      expect((await exit.claims(gapped)).unheld).toEqual([{ id: 1, amount: 25n }]);
    });
    it.each<[string, { payer: Hex; amount: bigint } | undefined]>([
      ["another payer", { ...HELD, payer: OTHER as Hex }],
      ["another amount", { ...HELD, amount: 24_000_000n }],
      ["a fraction of a base unit less", { ...HELD, amount: 24_999_999n }],
      ["no record at all", undefined],
    ])("names a pending deposit the vault's record shows with %s, whose refund would revert", async (_name, record) => {
      if (record !== undefined) chain.deposits.set(2n, record);
      const facts = await exit.claims(proof);
      expect(facts.mismatched).toEqual([2]);
      expect(facts.refunded).toEqual([]);
    });
    it("takes a pending deposit the vault's record agrees with, and does not ask about one refunded", async () => {
      chain.deposits.set(2n, HELD);
      expect((await exit.claims(proof)).mismatched).toEqual([]);
      const asked = chain.asked.filter((name) => name === "depositRecords").length;
      chain.vault.depositRefunded = word("bool", true);
      expect(await exit.claims({ ...proof, pending_deposits: proof.pending_deposits.map((held) => ({ ...held, deposit: { ...held.deposit, deposit_id: 8 } })) })).toMatchObject({ refunded: [8], mismatched: [] });
      expect(chain.asked.filter((name) => name === "depositRecords").length).toBe(asked);
    });
    it("takes no pending deposit whose payer the proof does not name, which the vault would refuse", async () => {
      chain.deposits.set(2n, HELD);
      expect((await exit.claims({ ...proof, pending_deposits: proof.pending_deposits.map((held) => ({ ...held, deposit: { ...held.deposit, payer: null } })) })).mismatched).toEqual([2]);
    });
    it("says when the vault holds more deposits than one read goes through", async () => {
      chain.vault.depositCount = word("uint256", 5_000n);
      const facts = await exit.claims(null);
      expect(facts.unheldComplete).toBe(false);
      expect(chain.asked.filter((name) => name === "depositRecords").length).toBe(1_024);
    });
  });

  describe("stakeHeld", () => {
    it("counts a stake and an unstake waiting out its cooldown", async () => {
      expect(await exit.stakeHeld()).toBe(false);
      chain.unstaking = 1n;
      expect(await exit.stakeHeld()).toBe(true);
      chain.unstaking = 0n;
      chain.staked = 1n;
      expect(await exit.stakeHeld()).toBe(true);
    });
    it("is false for a build that names no staking contract", async () => {
      const bare = new ProviderExit(ACCOUNT, { chainId: 31337, vault: VAULT, usdc: null, add: null }, chain, async () => "0x");
      expect(await bare.stakeHeld()).toBe(false);
    });
  });

  it("names the verifier's calls as the contract does", () => {
    const selectors = { accountClaim: "0xb38679b6", provesTerms: "0xf821f8d0", provesQueued: "0x37c4a76e", provesPending: "0xa98ded3e", provesApproval: "0x6f60b794", provesDistribution: "0x54ba1157" };
    for (const item of EXIT_VERIFIER) if (item.type === "function") expect(toFunctionSelector(item)).toBe(selectors[item.name]);
  });
});

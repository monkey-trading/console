/** The vault's own deposits behind receipts its records do not match: offered back to this account, which paid them, while claims register. */

import { decodeFunctionData, type Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { EXIT_VAULT } from "./exit-abi";
import { ACCOUNT, fullProof, NO_CLAIMS, OTHER, recordAt, VAULT } from "./exit-kit";
import { parseExitProof } from "./exit-proof";
import { refundSteps, registerSteps } from "./exit-steps";
import type { ExitPendingProof, ExitProof } from "./exit-types";
import { ProviderExit } from "./provider-exit";
import { Chain, STAKING, word } from "./provider-exit-kit";

describe("refunds through an unmatched receipt", () => {
  let chain: Chain;
  let exit: ProviderExit;
  const base: ExitProof = parseExitProof(fullProof(100));
  const pending = base.pending_deposits[0] ?? (() => { throw new Error("the fixture holds a pending deposit"); })();
  const credit: ExitPendingProof = { ...pending, chain_ref: "0xfeed:5", deposit: { ...pending.deposit, deposit_id: 5 } };
  const proof: ExitProof = { ...base, unfinalised_credits: [credit] };

  beforeEach(() => {
    chain = new Chain();
    exit = new ProviderExit(ACCOUNT, { chainId: 31337, vault: VAULT, usdc: null, add: null, staking: STAKING }, chain, async (data) => {
      chain.sentData.push({ to: VAULT, data });
      return "0xhash";
    });
  });

  it("offers this account's own deposit at an unmatched pending or credited receipt's id, at the vault's amount", async () => {
    chain.unmatched.add(2n);
    chain.unmatched.add(5n);
    chain.deposits.set(2n, { payer: ACCOUNT as Hex, amount: 24_000_000n });
    chain.deposits.set(5n, { payer: ACCOUNT as Hex, amount: 7_000_000n });
    const facts = await exit.claims(proof);
    expect(facts.mismatched).toEqual([2]);
    expect(facts.receiptRefunds.map(({ id, amount, leafKind }) => [id, amount, leafKind])).toEqual([[2, 24_000_000n, 34], [5, 7_000_000n, 35]]);
  });

  it("offers none where another address paid the vault's deposit, or the receipt matches", async () => {
    chain.unmatched.add(2n);
    chain.deposits.set(2n, { payer: OTHER as Hex, amount: 24_000_000n });
    chain.deposits.set(5n, { payer: ACCOUNT as Hex, amount: 7_000_000n });
    const facts = await exit.claims(proof);
    expect(facts.receiptRefunds).toEqual([]);
    expect(facts.creditsUnmatched).toEqual([]);
  });

  it("still offers it for a credit already counted, since registering counts unmatched credits too, and names the credit unmatched", async () => {
    chain.counted.add(5n);
    chain.unmatched.add(5n);
    chain.deposits.set(5n, { payer: ACCOUNT as Hex, amount: 7_000_000n });
    const facts = await exit.claims(proof);
    expect(facts.creditsCounted).toEqual([5]);
    expect(facts.creditsUnmatched).toEqual([5]);
    expect(facts.receiptRefunds.map(({ id }) => id)).toEqual([5]);
  });

  it("lists them as refunds, and sends each through refundReceipt with its receipt's kind", async () => {
    const receiptRefunds = [{ id: 5, amount: 7_000_000n, proof: credit, leafKind: 35 }];
    const step = refundSteps(recordAt(100), { ...NO_CLAIMS, receiptRefunds }).find((held) => held.kind === "refund-receipt");
    expect(step).toEqual({ kind: "refund-receipt", ...receiptRefunds[0] });
    if (step === undefined) throw new Error("the refund is listed");
    await exit.send(step);
    const { functionName, args } = decodeFunctionData({ abi: EXIT_VAULT, data: chain.sentData[0]?.data ?? "0x" });
    expect(functionName).toBe("refundReceipt");
    expect((args as unknown as [{ depositId: bigint }, number])[0].depositId).toBe(5n);
    expect((args as unknown as [unknown, number])[1]).toBe(35);
  });

  it("asks the vault whether a credit's deposit was refunded before offering it", async () => {
    chain.unmatched.add(5n);
    chain.deposits.set(5n, { payer: ACCOUNT as Hex, amount: 7_000_000n });
    chain.vault.depositRefunded = word("bool", true);
    expect((await exit.claims({ ...proof, pending_deposits: [] })).receiptRefunds).toEqual([]);
  });

  it("lists no credits step for an unmatched credit whose deposit was refunded", async () => {
    chain.unmatched.add(5n);
    chain.deposits.set(5n, { payer: ACCOUNT as Hex, amount: 7_000_000n });
    chain.vault.depositRefunded = word("bool", true);
    const creditsProof = { ...proof, pending_deposits: [] };
    const facts = await exit.claims(creditsProof);
    expect(facts.refunded).toContain(5);
    const steps = registerSteps({ ...recordAt(100), proof: creditsProof }, facts);
    expect(steps.filter((step) => step.kind === "credits")).toEqual([]);
    expect(steps.find((step) => step.kind === "account")).toMatchObject({ withCredits: false });
  });
});

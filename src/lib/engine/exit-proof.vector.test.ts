/**
 * Answers a real node served from `GET /v1/accounts/{address}/exit`, each of which the vault's verifier
 * accepted on the local stack, and, as `credited`, the engine's own proof for an account whose deposit
 * still awaits finality, whose root and credit the vault's tests register (`ExitVector.t.sol`): if the
 * shapes here drift from the engine's, these fail.
 */

import { decodeFunctionData, encodeFunctionData, stringToHex } from "viem";
import { describe, expect, it } from "vitest";

import { approvalArgs, EXIT_VERIFIER, previewArgs, receiptLeaf, termsArgs } from "./exit-abi";
import { exitProofAccount, parseExitProof } from "./exit-proof";
import vector from "./exit-proof-vector.json";

const ROOT = `0x${"00".repeat(32)}` as const;

describe("what a real node serves", () => {
  it("reads an account with a position, an approval and a distribution", () => {
    const proof = parseExitProof(vector.holder);
    expect(exitProofAccount(proof)).toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    expect(proof.account?.positions.length).toBe(proof.account?.leaf.open_positions);
    expect(proof.account?.markets[0]?.leaf.quote_currency).toEqual({ currency: "usd" });
    expect(proof.approvals.map((held) => held.approval.nonce)).toEqual([1]);
    expect(proof.distribution?.entitled).toBe("100000000000");
    expect(proof.pending_deposits).toEqual([]);
  });

  it("reads an account the root holds nothing for but a pending deposit", () => {
    const proof = parseExitProof(vector.pending);
    expect(proof.account).toBeNull();
    expect(exitProofAccount(proof)).toBe("0x90f79bf6eb2c4f870365e785982e1f101e93b906");
    expect(proof.pending_deposits[0]?.deposit.amount).toBe("250");
  });

  it("reads an account's unfinalised credit as the engine serves it, and carries it in the preview", () => {
    const proof = parseExitProof(vector.credited);
    if (proof.account === null) throw new Error("the vector holds an account");
    expect(proof.account.leaf.unfinalised_deposits).toBe("100");
    expect(proof.unfinalised_credits.map((held) => [held.deposit.deposit_id, held.deposit.amount])).toEqual([[0, "100"]]);
    const data = encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "previewClaim", args: previewArgs(proof.root, proof.account, proof.unfinalised_credits) });
    const [root, , , , , credits] = decodeFunctionData({ abi: EXIT_VERIFIER, data }).args as unknown as [string, string, unknown, unknown, unknown, { chainRef: string; amount: bigint; siblings: readonly string[] }[]];
    expect(root).toBe(proof.root);
    expect(credits[0]).toMatchObject({ chainRef: stringToHex(vector.credited.unfinalised_credits[0]?.chain_ref ?? ""), amount: 100_000_000_000n, siblings: proof.unfinalised_credits[0]?.siblings });
  });

  it("encodes each of them for the verifier and reads back what it encoded", () => {
    const proof = parseExitProof(vector.holder);
    if (proof.account === null) throw new Error("the vector holds an account");
    const data = encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "previewClaim", args: previewArgs(ROOT, proof.account, proof.unfinalised_credits) });
    const { args } = decodeFunctionData({ abi: EXIT_VERIFIER, data });
    expect((args as unknown as [string, string, { siblings: readonly string[] }])[2].siblings).toEqual(proof.account.siblings);
    const terms = encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "provesTerms", args: [ROOT, ...termsArgs(proof.terms)] });
    expect((decodeFunctionData({ abi: EXIT_VERIFIER, data: terms }).args as unknown as [string, { depositCursor: bigint }])[1].depositCursor).toBe(BigInt(proof.terms.terms.deposit_cursor));
    const approval = proof.approvals[0];
    if (approval === undefined) throw new Error("the vector holds an approval");
    const [approved] = approvalArgs(approval);
    expect(approved.amount).toBe(100_000_000n); // 100 USDC in base units, as the leaf hashes it
    const pending = parseExitProof(vector.pending).pending_deposits[0];
    if (pending === undefined) throw new Error("the vector holds a pending deposit");
    const deposit = receiptLeaf(pending);
    expect(deposit.amount).toBe(250_000_000_000n); // 250 at the engine's nine places
  });
});

/** The vault call each exit step sends, what it asks the wallet to do, and what a mined claim paid. */

import { decodeEventLog, encodeFunctionData, type Hex } from "viem";

import { accountArgs, approvalArgs, EXIT_VAULT, PENDING_DEPOSIT_LEAF, queuedArgs, receiptLeaf, termsArgs } from "./exit-abi";
import type { ExitStep } from "./exit-types";
import { hexOf, type Eip1193Provider } from "./provider-wallet";
import { WALLET_READ_MS, withinMs } from "./serialized-provider";

/** What a step asks the wallet to do, finishing "Confirm the request in your wallet to …". */
export function stepAction(step: ExitStep): string {
  switch (step.kind) {
    case "start": return "start the vault's exit";
    case "account": return "register your balance and positions";
    case "credits": return "register your unconfirmed deposits";
    case "approval": return `register withdrawal ${step.proof.approval.nonce}`;
    case "queued": return "register your queued withdrawal";
    case "distribution": return "register your distribution";
    case "refund": return `refund deposit ${step.proof.deposit.deposit_id}`;
    case "refund-unheld":
    case "refund-receipt": return `refund deposit ${step.id}`;
    case "claim": return "claim your funds from the vault";
    default: return step satisfies never;
  }
}

/** A step's call on the vault. */
export function stepCalldata(step: ExitStep, account: Hex): Hex {
  switch (step.kind) {
    case "start": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "startExit", args: termsArgs(step.terms) });
    case "account": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "registerExit", args: accountArgs(step.proof) });
    case "credits": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "registerExitCredits", args: [hexOf(step.account), step.proofs.map(receiptLeaf)] });
    case "approval": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "registerExitWithdrawal", args: approvalArgs(step.proof) });
    case "queued": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "registerExitQueued", args: queuedArgs(step.proof) });
    case "distribution": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "registerExitDistribution", args: [hexOf(step.proof.account), BigInt(step.proof.entitled), step.proof.siblings.map(hexOf)] });
    case "refund": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "refundReceipt", args: [receiptLeaf(step.proof), PENDING_DEPOSIT_LEAF] });
    case "refund-unheld": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "refundDeposit", args: [BigInt(step.id)] });
    case "refund-receipt": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "refundReceipt", args: [receiptLeaf(step.proof), step.leafKind] });
    case "claim": return encodeFunctionData({ abi: EXIT_VAULT, functionName: "claimExit", args: [account] });
    default: return step satisfies never;
  }
}

/** The vault's `ExitPaid` amount for `account` in the mined `claimExit` at `hash`; null when the receipt does not show one, which says nothing of the payment. */
export async function exitPaidIn(provider: Eip1193Provider, vault: string, account: string, hash: string): Promise<bigint | null> {
  const receipt = await withinMs(provider, { method: "eth_getTransactionReceipt", params: [hash] }, WALLET_READ_MS).catch(() => null);
  // A receipt's shape is the JSON-RPC spec's; each field read below is checked before use.
  const logs = (typeof receipt === "object" && receipt !== null && "logs" in receipt && Array.isArray(receipt.logs) ? receipt.logs : []) as { address?: string; topics?: [Hex, ...Hex[]]; data?: Hex }[];
  for (const log of logs) {
    if (log.address?.toLowerCase() !== vault.toLowerCase() || log.topics === undefined || log.data === undefined) continue;
    try {
      const event = decodeEventLog({ abi: EXIT_VAULT, topics: log.topics, data: log.data });
      if (event.eventName === "ExitPaid" && event.args.account.toLowerCase() === account) return event.args.amount;
    } catch {
      continue; // another of the vault's events, which this ABI does not list
    }
  }
  return null;
}

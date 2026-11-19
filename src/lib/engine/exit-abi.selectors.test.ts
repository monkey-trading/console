/**
 * Every call the console makes of the vault, its verifier and the staking contract, held to the
 * selectors `forge inspect` gave for the engine's contracts when this list was copied, so a call the
 * console adds or changes fails here until it matches them. Copy the list again with each change to
 * those contracts' functions.
 */

import { toFunctionSelector, type Abi } from "viem";
import { describe, expect, it } from "vitest";

import { EXIT_STAKING, EXIT_VAULT, EXIT_VERIFIER } from "./exit-abi";

/** From `forge inspect <contract> methodIdentifiers` on the engine's contracts. */
const SELECTORS: Record<string, Record<string, string>> = {
  Vault: {
    claimExit: "0x720747c6", claimWindow: "0xc5d37ae1", depositCount: "0x2dfdf0b5", depositRecords: "0x72605228", depositRefunded: "0xfa0161c0", distributionsClaimed: "0x73a1c934",
    exitClaims: "0xe7001524", exitDepositCursor: "0x44b3ac38", exitDistributionClaims: "0x70775fba", exitDistributionRegistered: "0xfadabda6", exitPeriod: "0x753d7445",
    exitQueuedRegistered: "0xaa552623", exitStartedAt: "0xb0e4620d", exitVerifier: "0x52822bfb", hasCheckpoint: "0x1c980fc6", lastCheckpointAt: "0x1667bcec", latestRoot: "0xd7b0fef1",
    latestSeq: "0x1075b671", refundDeposit: "0x6de0de7e", refundReceipt: "0x18b3a38c", registerExit: "0xa7f2f3a3", registerExitCredits: "0x66dbacab", registerExitDistribution: "0xde190295",
    registerExitQueued: "0x497ce3cf", registerExitWithdrawal: "0x0456f49a", startExit: "0x388ad794", usedNonces: "0x33a87bb1",
  },
  ExitVerifier: {
    creditCounted: "0x801291db", exitClaimed: "0x843b6b7e", exitRegistered: "0x61d0c89f", previewClaim: "0x5e49d49a", provesApproval: "0x6f60b794", provesDistribution: "0x54ba1157",
    provesQueued: "0x37c4a76e", provesReceipt: "0x659c6216", provesTerms: "0xf821f8d0",
  },
  Staking: { stakes: "0x16934fc4", unstakes: "0x23337d8c" },
};

describe("the exit's calls", () => {
  it.each([
    ["Vault", EXIT_VAULT],
    ["ExitVerifier", EXIT_VERIFIER],
    ["Staking", EXIT_STAKING],
  ] as const)("name only functions %s has, as it declares them", (contract, abi: Abi) => {
    const functions = abi.flatMap((item) => (item.type === "function" ? [[item.name, toFunctionSelector(item)]] : []));
    expect(Object.fromEntries(functions)).toEqual(SELECTORS[contract]);
  });
});

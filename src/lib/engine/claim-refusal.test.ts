import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import { claimFailure, emissionsFailure, withdrawalFailure } from "./claim-refusal";
import { walletError } from "./provider-errors";

const revert = (message: string, extra: object = {}) => walletError(Object.assign(new Error(message), { code: 3 }, extra), "claim your MONKEY emissions");
const selector = (signature: string) => toFunctionSelector(`function ${signature}`);

describe("claimFailure", () => {
  it.each([
    ["UnknownCheckpoint()", "has not yet recorded the snapshot"],
    ["InvalidSignerEpoch()", "signing key has changed"],
    ["NoSigner()", "has no signing key"],
    ["NothingToClaim(uint256,uint256)", "already paid everything"],
  ])("names %s in plain words, whether the wallet gives its selector or its name", (signature, words) => {
    const bySelector = claimFailure(revert(`execution reverted: custom error ${selector(signature)}`));
    const byName = claimFailure(revert(`execution reverted: ${signature.slice(0, signature.indexOf("("))}`));
    for (const error of [bySelector, byName]) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(words);
      expect((error as Error).message).not.toMatch(/0x|reverted/);
    }
  });

  it("finds a selector a wallet buries under data", () => {
    const error = claimFailure(revert("Internal JSON-RPC error.", { data: { originalError: { data: selector("NoSigner()") } } }));
    expect((error as Error).message).toContain("has no signing key");
  });

  it("says the vault refused, without raw data, for a revert it has no name for", () => {
    const error = claimFailure(revert("execution reverted: custom error 0xdeadbeef"));
    expect((error as Error).message).toBe("Your claim was not sent, because the vault's records do not match the proof provided by the server. Please try again shortly.");
  });

  it("leaves a declined request and a failure that is not a revert as they were", () => {
    const declined = walletError(Object.assign(new Error("no"), { code: 4001 }), "claim");
    const timeout = walletError(new Error("request timed out"), "claim");
    expect(claimFailure(declined)).toBe(declined);
    expect(claimFailure(timeout)).toBe(timeout);
  });
});

describe("emissionsFailure", () => {
  it.each([
    ["UnknownCheckpoint()", "has not yet recorded the snapshot"],
    ["InvalidSignerEpoch()", "signing key has changed"],
    ["NoSigner()", "has no signing key"],
    ["VaultNotSet()", "have not yet been opened"],
    ["NothingToClaim(uint256,uint256)", "already claimed everything"],
    ["InvalidEntitlementProof()", "proof provided by the server was not accepted"],
  ])("names %s in plain words, by selector or by name", (signature, words) => {
    for (const message of [`execution reverted: custom error ${selector(signature)}`, `execution reverted: ${signature.slice(0, signature.indexOf("("))}`]) {
      const error = emissionsFailure(revert(message));
      expect((error as Error).message).toContain(words);
      expect((error as Error).message).not.toMatch(/0x|reverted|vault has already paid/);
    }
  });

  it("says the claim did not match the proof for a revert it has no name for, and leaves a declined request alone", () => {
    expect((emissionsFailure(revert("execution reverted: custom error 0xdeadbeef")) as Error).message).toBe("Your claim was not sent, because it did not match the proof provided by the server. Please try again shortly.");
    const declined = walletError(Object.assign(new Error("no"), { code: 4001 }), "claim");
    expect(emissionsFailure(declined)).toBe(declined);
  });
});

describe("withdrawalFailure", () => {
  const withdrawal = (message: string) => walletError(Object.assign(new Error(message), { code: 3 }), "claim the withdrawal");

  it.each([
    ["InvalidWithdrawalTime()", "24-hour approval for this withdrawal has expired", "select Renew the claim"],
    ["UnknownCheckpoint()", "has not yet recorded the snapshot", "try again shortly"],
    ["InvalidSignerEpoch()", "signing key has changed", "select Renew the claim"],
    ["WithdrawalAlreadyPaid()", "already paid this withdrawal", "was not sent"],
    ["WithdrawalsPaused()", "paused at the vault", "pause has ended"],
    ["ExitActive()", "exit has started", "Funding page"],
  ])("names %s in plain words with what to do next, by selector or by name", (signature, words, next) => {
    const bySelector = withdrawalFailure(withdrawal(`Execution reverted with reason: custom error ${selector(signature)}. Request Arguments: from: 0xabc data: 0x52be0833`));
    const byName = withdrawalFailure(withdrawal(`execution reverted: ${signature.slice(0, signature.indexOf("("))}`));
    for (const error of [bySelector, byName]) {
      expect((error as Error).message).toContain(words);
      expect((error as Error).message).toContain(next);
      expect((error as Error).message).not.toMatch(/0x|reverted|Request Arguments/);
    }
  });

  it("says the vault did not accept the authorization, without raw data, for an error it has no name for", () => {
    const error = withdrawalFailure(withdrawal("Execution reverted with reason: custom error 0xdeadbeef. Request Arguments: data: 0x52be08330000"));
    expect((error as Error).message).toBe("Your claim was not sent, because the vault did not accept this withdrawal's approval. Please try again shortly, or select Renew the claim if it is offered.");
  });

  it("leaves a declined request and a failure that is not a revert as they were", () => {
    const declined = walletError(Object.assign(new Error("no"), { code: 4001 }), "claim the withdrawal");
    const timeout = walletError(new Error("request timed out"), "claim the withdrawal");
    expect(withdrawalFailure(declined)).toBe(declined);
    expect(withdrawalFailure(timeout)).toBe(timeout);
  });
});

import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import { claimFailure, withdrawalFailure } from "./claim-refusal";
import { walletError } from "./provider-errors";

const revert = (message: string, extra: object = {}) => walletError(Object.assign(new Error(message), { code: 3 }, extra), "claim your MONKEY emissions");
const selector = (signature: string) => toFunctionSelector(`function ${signature}`);

describe("claimFailure", () => {
  it.each([
    ["UnknownCheckpoint()", "has not recorded the checkpoint"],
    ["InvalidSignerEpoch()", "signer has changed"],
    ["NoSigner()", "has no signer"],
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
    expect((error as Error).message).toContain("has no signer");
  });

  it("says the vault refused, without raw data, for a revert it has no name for", () => {
    const error = claimFailure(revert("execution reverted: custom error 0xdeadbeef"));
    expect((error as Error).message).toBe("The vault refused the claim and nothing was sent: its record does not match the node's proof. Try again shortly.");
  });

  it("leaves a declined request and a failure that is not a revert as they were", () => {
    const declined = walletError(Object.assign(new Error("no"), { code: 4001 }), "claim");
    const timeout = walletError(new Error("request timed out"), "claim");
    expect(claimFailure(declined)).toBe(declined);
    expect(claimFailure(timeout)).toBe(timeout);
  });
});

describe("withdrawalFailure", () => {
  const withdrawal = (message: string) => walletError(Object.assign(new Error(message), { code: 3 }), "claim the withdrawal");

  it.each([
    ["InvalidWithdrawalTime()", "24-hour authorization has passed", "ask for a new one"],
    ["UnknownCheckpoint()", "has not recorded the checkpoint", "Try again shortly"],
    ["InvalidSignerEpoch()", "signer has changed", "ask for one"],
    ["WithdrawalAlreadyPaid()", "already paid this withdrawal", "nothing was sent"],
    ["WithdrawalsPaused()", "paused at the vault", "pause ends"],
    ["ExitActive()", "in its exit", "nothing was sent"],
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
    expect((error as Error).message).toBe("The vault refused the claim and nothing was sent: it did not accept this authorization. Try again shortly, or ask for a new authorization if the withdrawal offers one.");
  });

  it("leaves a declined request and a failure that is not a revert as they were", () => {
    const declined = walletError(Object.assign(new Error("no"), { code: 4001 }), "claim the withdrawal");
    const timeout = walletError(new Error("request timed out"), "claim the withdrawal");
    expect(withdrawalFailure(declined)).toBe(declined);
    expect(withdrawalFailure(timeout)).toBe(timeout);
  });
});

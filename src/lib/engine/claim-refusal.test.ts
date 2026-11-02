import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import { claimFailure } from "./claim-refusal";
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

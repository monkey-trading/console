/** `verifierRefusal`: the verifier's revert reasons in plain words. */

import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import { verifierRefusal } from "./exit-refusal";

const revert = (data: string) => ({ code: 3, message: "execution reverted", data });

describe("verifierRefusal", () => {
  it.each([
    ["InvalidAccountProof()", "the vault's snapshot does not confirm the proof's balance, positions or unconfirmed deposits"],
  ])("names the verifier's %s from the revert's data", (signature, reason) => {
    expect(verifierRefusal("balance and positions", revert(toFunctionSelector(`function ${signature}`)))).toBe(reason);
  });

  it("finds an error a wallet nests under Internal JSON-RPC error", () => {
    const nested = { code: -32603, message: "Internal JSON-RPC error.", data: { originalError: revert(`${toFunctionSelector("function UnvaluedPosition(uint32)")}${"0".repeat(63)}3`) } };
    expect(verifierRefusal("balance and positions", nested)).toBe("the vault cannot value one of your positions, because the snapshot holds no exchange rate for the market's currency");
  });

  it("names a known error a wallet reports only by name, with no revert data", () => {
    expect(verifierRefusal("balance and positions", { code: 3, message: "execution reverted: InvalidAccountProof()" })).toBe("the vault's snapshot does not confirm the proof's balance, positions or unconfirmed deposits");
  });

  it("names an error it does not know by its selector", () => {
    expect(verifierRefusal("balance and positions", revert("0xdeadbeef"))).toBe("the vault rejected the check of the proof's balance and positions with an error code that this app does not recognise (0xdeadbeef)");
  });

  it("says when the verifier gave no reason, as a function the contract lacks reverts", () => {
    expect(verifierRefusal("balance and positions", revert("0x"))).toBe("the vault rejected the check of the proof's balance and positions without giving a reason, which can mean that this version of the app does not match the vault's contracts");
  });
});

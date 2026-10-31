/** Tests for the wallet's dev-faucet funding: the mock USDC's permissionless mint, sent through the wallet. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "../fixed";
import { CHAIN, decode, USDC, wallet } from "./provider-wallet-fixtures";
import { ACCOUNT } from "./wallet-kit";

describe("funding", () => {
  it("sends the mock USDC's mint for the connected account to the token, through the wallet", async () => {
    const { provider, wallet: w } = wallet();
    const heard: string[] = [];
    await w.fund(fixedFromInt(10_000), (waitingFor) => heard.push(waitingFor));
    const [mint] = provider.sent;
    expect(mint?.to).toBe(USDC);
    expect(mint && decode(mint.data)).toEqual({ functionName: "mint", args: [expect.stringMatching(new RegExp(ACCOUNT, "i")), 10_000_000_000n] });
    expect(heard).toEqual(["Confirm in your wallet: mint USDC.", "Waiting for the transaction to mint USDC to be mined."]);
  });

  it("refuses to mint without a USDC token, or an amount finer than a base unit, before sending anything", async () => {
    const { provider, wallet: w } = wallet({}, { ...CHAIN, usdc: null });
    await expect(w.fund(fixedFromInt(10))).rejects.toThrow("names no USDC token");
    await expect(wallet().wallet.fund(1n)).rejects.toThrow("whole number of USDC base units");
    expect(provider.sent).toEqual([]);
  });

  it("says the user declined when the wallet refuses the mint", async () => {
    const { wallet: w } = wallet({ fail: { eth_sendTransaction: { code: 4001, message: "User rejected" } } });
    await expect(w.fund(fixedFromInt(10))).rejects.toThrow("You declined to mint USDC in your wallet.");
  });
});

import { decodeFunctionData, encodeAbiParameters, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import type { EntitlementProof } from "./emissions";
import { emissionsClaimedRead, suggestMonkeyToken } from "./provider-monkey";
import { CHAIN, wallet } from "./provider-wallet-fixtures";
import { ACCOUNT, MINTER, StubProvider } from "./wallet-kit";

const CLAIM = parseAbi(["function claimEmissions(address account, uint256 entitled, uint64 checkpointSeq, bytes32[] siblings) returns (uint256)"]);
const TOKEN = "0x00000000000000000000000000000000000000bb";
const proof: EntitlementProof = { account: ACCOUNT, entitled: "5000000000000000000", seq: 40, root: `0x${"11".repeat(32)}`, siblings: [] };

describe("the MONKEY claim", () => {
  it("is sent to the minter, not the vault", async () => {
    const { provider, wallet: w } = wallet();
    await w.claimEmissions(proof);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe(MINTER);
    expect(CHAIN.vault).not.toBe(MINTER);
    expect(decodeFunctionData({ abi: CLAIM, data: provider.sent[0]?.data ?? "0x" }).functionName).toBe("claimEmissions");
  });

  it("is refused before the wallet is asked when the build names no minter", async () => {
    const { provider, wallet: w } = wallet({}, { ...CHAIN, minter: null });
    await expect(w.claimEmissions(proof)).rejects.toThrow("MONKEY claims are not currently available.");
    expect(provider.sent).toHaveLength(0);
  });

  it("says in plain words why the minter refused", async () => {
    const { wallet: w } = wallet({ fail: { eth_sendTransaction: { code: 3, message: "execution reverted: NothingToClaim" } } });
    await expect(w.claimEmissions(proof)).rejects.toThrow("already claimed everything your proof covers");
  });
});

describe("the MONKEY record", () => {
  it("reads what was minted from the minter and the checkpoint from the vault", async () => {
    const provider = new StubProvider({ emissionsClaimed: 3n, latestSeq: 42 });
    await expect(emissionsClaimedRead(ACCOUNT, CHAIN, provider)).resolves.toEqual({ claimed: 3n, latestSeq: 42 });
    const to = provider.calls.filter((c) => c.method === "eth_call").map((c) => ((c.params as { to: string }[])[0] as { to: string }).to);
    expect(to).toEqual([MINTER, CHAIN.vault]);
  });

  it("is refused when the build names no minter", async () => {
    await expect(emissionsClaimedRead(ACCOUNT, { ...CHAIN, minter: null }, new StubProvider())).rejects.toThrow("MONKEY claims are not currently available.");
  });
});

describe("offering the MONKEY token", () => {
  const token = (to: string[], asked: unknown[]) => ({ async request({ method, params }: { method: string; params?: unknown }) {
    if (method === "eth_call") { to.push(((params as { to: string }[])[0] as { to: string }).to); return encodeAbiParameters([{ type: "address" }], [TOKEN]); }
    if (method !== "wallet_watchAsset") throw new Error(`unexpected ${method}`);
    asked.push(params);
    return true;
  } });

  it("reads the token from the minter and offers that token to the wallet", async () => {
    const to: string[] = [];
    const asked: unknown[] = [];
    await expect(suggestMonkeyToken(async () => undefined, CHAIN, token(to, asked))).resolves.toBe(true);
    expect(to).toEqual([MINTER]);
    expect(asked).toEqual([{ type: "ERC20", options: { address: TOKEN, symbol: "MONKEY", decimals: 18 } }]);
  });

  it("offers nothing, and asks nothing of the wallet, when the build names no minter", async () => {
    const to: string[] = [];
    const asked: unknown[] = [];
    let switched = false;
    await expect(suggestMonkeyToken(async () => { switched = true; }, { ...CHAIN, minter: null }, token(to, asked))).resolves.toBe(false);
    expect(to).toEqual([]);
    expect(asked).toEqual([]);
    expect(switched).toBe(false);
  });
});

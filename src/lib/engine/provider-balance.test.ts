/** Tests for the wallet's USDC read: it names a wrong chain without asking the wallet to move, reports a failed read, and is bounded in time. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fixedFromInt } from "../fixed";
import { BALANCE_CALL_MS, usdcBalanceRead } from "./provider-balance";
import { CHAIN, wallet as walletOver } from "./provider-wallet-fixtures";
import { serialized } from "./serialized-provider";
import { ACCOUNT, StubProvider } from "./wallet-kit";
import type { Eip1193Provider } from "./provider-wallet";

afterEach(() => vi.useRealTimers());

describe("ProviderWallet.usdcBalance", () => {
  it("reads balanceOf in USDC base units as the console's nine-place amount", async () => {
    const { wallet } = walletOver({ balance: 2_500_000_000n }); // 2,500 USDC
    expect(await wallet.usdcBalance()).toEqual({ kind: "held", amount: fixedFromInt(2_500) });
  });

  it("asks the chain id first and nothing else but the one call, never a switch", async () => {
    const { provider, wallet } = walletOver({ balance: 1_000_000n });
    await wallet.usdcBalance();
    expect(provider.calls.map((c) => c.method)).toEqual(["eth_chainId", "eth_call"]);
  });

  it("names the chain the wallet is on, without asking it to switch or reading a balance", async () => {
    const { provider, wallet } = walletOver({ chainId: 1, balance: 5n });
    expect(await wallet.usdcBalance()).toEqual({ kind: "wrong_chain", chainId: 1 });
    expect(provider.calls.map((c) => c.method)).toEqual(["eth_chainId"]);
    expect(provider.chainId).toBe(1);
  });

  it("rejects, rather than reporting zero, when the wallet fails the call", async () => {
    const { wallet } = walletOver({ fail: { eth_call: { code: -32603, message: "rpc down" } } });
    await expect(wallet.usdcBalance()).rejects.toThrow("rpc down");
  });

  it("rejects for a build that names no USDC token", async () => {
    const { wallet } = walletOver({}, { ...CHAIN, usdc: null });
    await expect(wallet.usdcBalance()).rejects.toThrow("no USDC token");
  });
});

describe("a read that the wallet never answers", () => {
  it("is given up on after the bound, and a signature queued behind it then goes through", async () => {
    vi.useFakeTimers();
    const stub = new StubProvider({ balance: 1_000_000n });
    let hang = true;
    const provider = serialized({ request: (args) => (hang && args.method === "eth_chainId" ? new Promise(() => {}) : stub.request(args)) });
    const read = usdcBalanceRead(ACCOUNT, CHAIN, provider);
    const sign = provider.request({ method: "eth_signTypedData_v4", params: [] }).then(() => "signed", () => "refused");
    const rejected = expect(read).rejects.toThrow("did not answer in time");
    await vi.advanceTimersByTimeAsync(BALANCE_CALL_MS);
    await rejected;
    hang = false;
    // The stub refuses typed data it cannot parse, but only after the queue let the request through.
    expect(await sign).toBe("refused");
    expect(stub.calls.map((c) => c.method)).toContain("eth_signTypedData_v4");
  });

  it("is bounded on a provider that is not queued too", async () => {
    vi.useFakeTimers();
    const provider: Eip1193Provider = { request: () => new Promise(() => {}) };
    const read = usdcBalanceRead(ACCOUNT, CHAIN, provider);
    const rejected = expect(read).rejects.toThrow("did not answer in time");
    await vi.advanceTimersByTimeAsync(BALANCE_CALL_MS);
    await rejected;
  });
});

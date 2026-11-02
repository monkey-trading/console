/** Tests for the vault's deposit events read through the wallet: bounded, filtered by the account, never a chain switch, and silent when it cannot read. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fixedFromInt } from "../fixed";
import { DEPOSIT_BLOCKS } from "./provider-deposits";
import { CHAIN, wallet as walletOver } from "./provider-wallet-fixtures";
import { ACCOUNT } from "./wallet-kit";

afterEach(() => vi.useRealTimers());

const OTHER = "0x00000000000000000000000000000000000000aa";
const PAYER = "0x00000000000000000000000000000000000000bb";

describe("ProviderWallet.vaultDeposits", () => {
  it("reads the deposits made to the account, whoever paid, as the console's nine-place amounts", async () => {
    const { wallet } = walletOver({ deposits: [
      { id: 7n, account: ACCOUNT, from: ACCOUNT, amount: 250_000_000n },
      { id: 8n, account: ACCOUNT, from: PAYER, amount: 10_000_000n },
      { id: 9n, account: OTHER, from: ACCOUNT, amount: 99_000_000n },
    ] });
    expect(await wallet.vaultDeposits()).toEqual([{ id: "7", amount: fixedFromInt(250) }, { id: "8", amount: fixedFromInt(10) }]);
  });

  it("asks the chain id, then the block, then one bounded range, never a switch", async () => {
    const { provider, wallet } = walletOver({ blockNumber: 1_000_000n });
    await wallet.vaultDeposits();
    expect(provider.calls.map((c) => c.method)).toEqual(["eth_chainId", "eth_blockNumber", "eth_getLogs"]);
    const [filter] = provider.calls[2]?.params as [{ fromBlock: string; toBlock: string; address: string }];
    expect(BigInt(filter.toBlock) - BigInt(filter.fromBlock)).toBe(BigInt(DEPOSIT_BLOCKS));
    expect(filter.address).toBe(CHAIN.vault);
  });

  it("starts at the first block on a chain younger than the range", async () => {
    const { provider, wallet } = walletOver({ blockNumber: 12n });
    await wallet.vaultDeposits();
    expect((provider.calls[2]?.params as [{ fromBlock: string }])[0].fromBlock).toBe("0x0");
  });

  it("reads nothing from a wallet on another chain, and does not ask it to move", async () => {
    const { provider, wallet } = walletOver({ chainId: 1 });
    expect(await wallet.vaultDeposits()).toBeNull();
    expect(provider.calls.map((c) => c.method)).toEqual(["eth_chainId"]);
    expect(provider.chainId).toBe(1);
  });

  it("is null, with no error, when the provider refuses the range or answers nothing readable", async () => {
    const { wallet } = walletOver({ fail: { eth_getLogs: { code: -32005, message: "query returned more than 10000 results" } } });
    expect(await wallet.vaultDeposits()).toBeNull();
    const broken = walletOver({ fail: { eth_blockNumber: { code: -32603, message: "internal error" } } });
    expect(await broken.wallet.vaultDeposits()).toBeNull();
  });

  it("gives up on a wallet that does not answer", async () => {
    vi.useFakeTimers();
    const { provider, wallet } = walletOver();
    provider.request = () => new Promise(() => {});
    const read = wallet.vaultDeposits();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(await read).toBeNull();
  });
});

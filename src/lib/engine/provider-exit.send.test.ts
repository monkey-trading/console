import { decodeFunctionData, encodeEventTopics, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXIT_VAULT } from "./exit-abi";
import { ACCOUNT, fullProof, VAULT } from "./exit-kit";
import { parseExitProof } from "./exit-proof";
import type { ExitProof } from "./exit-types";
import { isRevert } from "./provider-errors";
import { ProviderExit } from "./provider-exit";
import { Chain, STAKING, word } from "./provider-exit-kit";
import { ProviderWallet, type Eip1193Provider } from "./provider-wallet";
import { serialized } from "./serialized-provider";

describe("ProviderExit's transactions", () => {
  let chain: Chain;
  let exit: ProviderExit;
  const proof: ExitProof = parseExitProof(fullProof(100));

  beforeEach(() => {
    chain = new Chain();
    exit = new ProviderExit(ACCOUNT, { chainId: 31337, vault: VAULT, usdc: null, add: null, staking: STAKING }, chain, async (data, _action, progress) => {
      chain.sentData.push({ to: VAULT, data });
      progress("Waiting.");
      return "0xhash";
    });
  });

  describe("send", () => {
    const account = proof.account;
    const approval = proof.approvals[0];
    const queued = proof.queued[0];
    const distribution = proof.distribution;
    const pending = proof.pending_deposits[0];
    if (account === null || approval === undefined || queued === undefined || distribution === null || pending === undefined) throw new Error("the fixture holds every part");

    /** The contract's own selectors, from `forge inspect Vault methodIdentifiers`: they fail here if a struct's fields drift from Solidity's. */
    it.each([
      ["0x388ad794", { kind: "start", terms: proof.terms }],
      ["0xa7f2f3a3", { kind: "account", proof: account, amount: 1n }],
      ["0x0456f49a", { kind: "approval", proof: approval, amount: 1n }],
      ["0x497ce3cf", { kind: "queued", proof: queued, amount: 1n }],
      ["0xde190295", { kind: "distribution", proof: distribution, amount: 1n }],
      ["0xdfa0eac4", { kind: "refund", proof: pending, amount: 1n }],
      ["0x6de0de7e", { kind: "refund-unheld", id: 7, amount: 1n }],
      ["0x720747c6", { kind: "claim" }],
    ] as const)("calls %s on the vault", async (selector, step) => {
      const progress: string[] = [];
      await exit.send(step, (line) => progress.push(line));
      expect(chain.sentData[0]?.data.slice(0, 10)).toBe(selector);
      expect(progress).toEqual(["Waiting."]);
    });

    it("carries the account's values in the vault's raw units", async () => {
      await exit.send({ kind: "account", proof: account, amount: 1n });
      const { args } = decodeFunctionData({ abi: EXIT_VAULT, data: chain.sentData[0]?.data ?? "0x" });
      const [to, state, positions, markets] = args as unknown as [string, { balance: bigint; openPositions: number; siblings: readonly string[] }, { qty: bigint; entry: bigint }[], { marked: boolean; mark: bigint; quoteCurrency: number; fxMarked: boolean }[]];
      expect(to.toLowerCase()).toBe(ACCOUNT);
      expect(state.balance).toBe(5_000_000_000_000n); // 5000 at nine places, as the engine's `Fixed::raw`
      expect(state.openPositions).toBe(1);
      expect(state.siblings.length).toBe(2);
      expect(positions[0]?.qty).toBe(10_000_000n);
      expect(positions[0]?.entry).toBe(100_000_000_000_000n);
      expect(markets[0]).toMatchObject({ marked: true, mark: 101_000_000_000_000n, quoteCurrency: 0, fxMarked: false });
    });

    it("carries an approval in USDC base units, as its leaf hashes it", async () => {
      await exit.send({ kind: "approval", proof: approval, amount: 1n });
      const { args } = decodeFunctionData({ abi: EXIT_VAULT, data: chain.sentData[0]?.data ?? "0x" });
      expect((args as unknown as [{ amount: bigint; nonce: bigint }])[0]).toMatchObject({ amount: 50_000_000n, nonce: 1n });
    });

    it("carries a pending deposit's reference as its UTF-8 bytes", async () => {
      await exit.send({ kind: "refund", proof: pending, amount: 1n });
      const { args } = decodeFunctionData({ abi: EXIT_VAULT, data: chain.sentData[0]?.data ?? "0x" });
      expect((args as unknown as [Hex])[0]).toBe("0x3078666565643a31"); // "0xfeed:1"
    });

    it("carries a queued request's ticket and a market's quote currency", async () => {
      await exit.send({ kind: "queued", proof: queued, amount: 1n });
      expect((decodeFunctionData({ abi: EXIT_VAULT, data: chain.sentData[0]?.data ?? "0x" }).args as unknown as [{ ticket: bigint }])[0].ticket).toBe(7n);
      const jpy = { ...account, markets: account.markets.map((market) => ({ ...market, leaf: { ...market.leaf, quote_currency: { currency: "jpy" as const, fx_market: 9 }, fx_mark: "150" } })) };
      await exit.send({ kind: "account", proof: jpy, amount: 1n });
      const [, , , markets] = decodeFunctionData({ abi: EXIT_VAULT, data: chain.sentData[1]?.data ?? "0x" }).args as unknown as [unknown, unknown, unknown, { quoteCurrency: number; fxMarket: number; fxMarked: boolean; fxMark: bigint }[]];
      expect(markets[0]).toMatchObject({ quoteCurrency: 3, fxMarket: 9, fxMarked: true, fxMark: 150_000_000_000n });
    });

    it("says what a claim paid, from the vault's own event", async () => {
      const topics = encodeEventTopics({ abi: EXIT_VAULT, eventName: "ExitPaid", args: { account: ACCOUNT as Hex } });
      chain.receipt = { logs: [{ address: VAULT, topics, data: word("uint256", 4_800_000_000n) }] };
      expect(await exit.send({ kind: "claim" })).toEqual({ hash: "0xhash", paid: 4_800_000_000n });
    });

    it("says nothing of a payment a receipt does not show", async () => {
      chain.receipt = { logs: [{ address: "0x00000000000000000000000000000000000000aa", topics: [`0x${"00".repeat(32)}`], data: "0x" }, { address: VAULT, topics: [`0x${"00".repeat(32)}`], data: "0x" }] };
      expect(await exit.send({ kind: "claim" })).toEqual({ hash: "0xhash", paid: null });
    });
  });
});

describe("ProviderExit with a wallet that does not answer", () => {
  const CHAIN = { chainId: 31337, vault: VAULT, usdc: null, add: null, staking: STAKING };
  const never = new Promise<unknown>(() => undefined);
  afterEach(() => { vi.useRealTimers(); });

  it("gives a read up and frees the queue behind it, so a retry or a signature still reaches the wallet", async () => {
    vi.useFakeTimers();
    const chain = new Chain();
    let asked = 0;
    const provider: Eip1193Provider = { request: (args) => (asked++ === 0 ? never : chain.request(args)) };
    const queued = serialized(provider);
    const exit = new ProviderExit(ACCOUNT, CHAIN, queued, async () => "0xhash");
    const refused = expect(exit.facts()).rejects.toThrow("did not answer in time");
    const behind = queued.request({ method: "eth_chainId" });
    await vi.advanceTimersByTimeAsync(30_000);
    await refused;
    expect(Number(await behind)).toBe(31337);
  });

  it("reads a reverted call as the verifier's refusal when the wallet wraps it", () => {
    expect(isRevert({ code: -32603, message: "Internal JSON-RPC error.", data: { code: 3, message: "execution reverted" } })).toBe(true);
    expect(isRevert({ code: -32603, message: "Internal JSON-RPC error.", data: { originalError: { code: 3, message: "reverted" } } })).toBe(true);
    expect(isRevert({ code: -32603, message: "Internal JSON-RPC error.", data: { code: -32000, message: "header not found" } })).toBe(false);
    expect(isRevert(new Error("Your wallet did not answer in time."))).toBe(false);
  });

  it("gives up the wallet's receipt check before a send, so the action ends and the queue goes on", async () => {
    vi.useFakeTimers();
    const chain = new Chain();
    const provider: Eip1193Provider = { request: (args) => (args.method === "eth_getTransactionReceipt" ? never : chain.request(args)) };
    const wallet = new ProviderWallet(ACCOUNT, "Test", provider, CHAIN, { wait: async () => undefined });
    const sending = expect(wallet.exit.send({ kind: "claim" })).rejects.toThrow("did not answer in time");
    await vi.advanceTimersByTimeAsync(30_000);
    await sending;
  });

  it("gives up the chain check at a press, so the action ends and the queue goes on", async () => {
    vi.useFakeTimers();
    const chain = new Chain();
    const provider: Eip1193Provider = { request: (args) => (args.method === "eth_chainId" ? never : chain.request(args)) };
    const checking = expect(new ProviderWallet(ACCOUNT, "Test", provider, CHAIN, { wait: async () => undefined }).ensureChain()).rejects.toThrow("did not answer in time");
    await vi.advanceTimersByTimeAsync(30_000);
    await checking;
  });

  it("gives a claim's receipt up, which says nothing of the payment", async () => {
    vi.useFakeTimers();
    const chain = new Chain();
    const provider: Eip1193Provider = { request: (args) => (args.method === "eth_getTransactionReceipt" ? never : chain.request(args)) };
    const sending = new ProviderExit(ACCOUNT, CHAIN, serialized(provider), async () => "0xhash").send({ kind: "claim" });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(sending).resolves.toEqual({ hash: "0xhash", paid: null });
  });
});

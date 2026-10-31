/** Tests for the wallet over an EIP-1193 provider: chain, signatures against the engine's vectors, deposits and claims. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "../fixed";
import vectors from "./eip712-vectors.json";
import { orderTypedData, requestDomain } from "./eip712";
import { InjectedConnector } from "./injected";
import { normaliseSignature, ProviderWallet } from "./provider-wallet";
import { CHAIN, decode, USDC, wallet } from "./provider-wallet-fixtures";
import type { OrderRequest, SignedWithdrawal } from "./types";
import { ACCOUNT, StubProvider } from "./wallet-kit";

const VAULT = vectors.vault;

/** The first entry of a recorded call's array params; undefined for an object param such as watchAsset's. */
const firstParam = (call: { params: readonly unknown[] | object } | undefined): unknown =>
  call !== undefined && Array.isArray(call.params) ? call.params[0] : undefined;

const order = vectors.requests[0];
if (!order) throw new Error("no order vector");
const typed = orderTypedData(requestDomain(vectors.chain_id, VAULT), order.body as unknown as OrderRequest, { nonce: order.nonce, expiresAt: order.expires_at });

describe("signing", () => {
  it("signs through eth_signTypedData_v4 to exactly the engine's vector signature", async () => {
    const { provider, wallet: w } = wallet();
    expect(await w.sign({ summary: "buy", typed })).toBe(order.signature);
    expect(firstParam(provider.calls.find((c) => c.method === "eth_signTypedData_v4"))).toBe(ACCOUNT);
  });

  it("refuses a request for another chain or vault without asking the wallet", async () => {
    const { provider, wallet: w } = wallet();
    for (const domain of [requestDomain(1, VAULT), requestDomain(vectors.chain_id, USDC)]) {
      await expect(w.sign({ summary: "buy", typed: { ...typed, domain } })).rejects.toThrow("another chain or vault");
    }
    expect(provider.calls).toEqual([]);
  });

  it("refuses a signature that recovers to another account than the connected one", async () => {
    const { wallet: w } = wallet({ key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
    await expect(w.sign({ summary: "buy", typed })).rejects.toThrow("another account");
  });

  it("says the user declined when the wallet refuses with code 4001", async () => {
    const { wallet: w } = wallet({ fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    await expect(w.sign({ summary: "buy", typed })).rejects.toThrow("You declined to sign in your wallet.");
  });

  it("normalises a recovery id of 0 or 1 to 27 or 28 and refuses other shapes", () => {
    const body = `0x${"11".repeat(64)}`;
    expect(normaliseSignature(`${body}00`)).toBe(`${body}1b`);
    expect(normaliseSignature(`${body}01`)).toBe(`${body}1c`);
    expect(normaliseSignature(`${body}1c`)).toBe(`${body}1c`);
    expect(() => normaliseSignature(`${body}02`)).toThrow("unknown recovery id");
    expect(() => normaliseSignature(`${body}1b00`)).toThrow("not 65 bytes");
  });
});

describe("the chain", () => {
  it("switches a wallet on another chain before it signs", async () => {
    const { provider, wallet: w } = wallet({ chainId: 1 });
    await w.sign({ summary: "buy", typed });
    expect(provider.calls.map((c) => c.method)).toEqual(["eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_signTypedData_v4"]);
  });

  it("offers to add a chain the wallet does not know when the build names its RPC URL, and fails when it names none", async () => {
    const unknown = { fail: { wallet_switchEthereumChain: { code: 4902, message: "Unrecognized chain" } }, chainId: 1 };
    const { provider, wallet: w } = wallet(unknown);
    await w.ensureChain();
    expect(firstParam(provider.calls.find((c) => c.method === "wallet_addEthereumChain"))).toMatchObject({ chainId: "0x7a69", rpcUrls: ["http://127.0.0.1:8545/"] });
    await expect(wallet(unknown, { ...CHAIN, add: null }).wallet.ensureChain()).rejects.toThrow("could not switch to chain 31337");
  });

  it("offers to add the chain when a wallet answers an unknown chain as a -32603 server error", async () => {
    const serverError = { fail: { wallet_switchEthereumChain: { code: -32603, message: "Unrecognized chain ID 31337" } }, chainId: 1 };
    const { provider, wallet: w } = wallet(serverError);
    await w.ensureChain();
    const methods = provider.calls.map((c) => c.method);
    expect(methods).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]);
    expect(provider.chainId).toBe(31337);
    // A server error that names nothing about a chain is a refusal, not an unknown chain.
    const other = { fail: { wallet_switchEthereumChain: { code: -32603, message: "internal error" } }, chainId: 1 };
    await expect(wallet(other).wallet.ensureChain()).rejects.toThrow("could not switch to chain 31337: internal error");
    // A server error that names a chain without reporting it unknown is a refusal, not an unknown chain.
    const unavailable = { fail: { wallet_switchEthereumChain: { code: -32603, message: "Chain RPC is unavailable" } }, chainId: 1 };
    const tried = wallet(unavailable);
    await expect(tried.wallet.ensureChain()).rejects.toThrow("could not switch to chain 31337: Chain RPC is unavailable");
    expect(tried.provider.calls.some((c) => c.method === "wallet_addEthereumChain")).toBe(false);
    // A generic failure that says neither is a refusal, not an unknown chain.
    const generic = { fail: { wallet_switchEthereumChain: { code: -32603, message: "Unknown error" } }, chainId: 1 };
    const genericTried = wallet(generic);
    await expect(genericTried.wallet.ensureChain()).rejects.toThrow("could not switch to chain 31337: Unknown error");
    expect(genericTried.provider.calls.some((c) => c.method === "wallet_addEthereumChain")).toBe(false);
  });

  it("refuses to go on when the wallet stays on another chain", async () => {
    const provider = new StubProvider({ chainId: 1 });
    provider.request = async ({ method }) => (method === "eth_chainId" ? "0x1" : null);
    const w = new ProviderWallet(ACCOUNT, "Test wallet", provider, CHAIN, { wait: async () => {} });
    await expect(w.ensureChain()).rejects.toThrow("Your wallet is on chain 1; switch it to chain 31337");
  });
});

describe("deposits", () => {
  it("approves the vault for exactly the amount, then deposits it, when the allowance is short", async () => {
    const { provider, wallet: w } = wallet({ balance: 5_000_000_000n, allowance: 0n });
    await w.deposit(fixedFromInt(1_000));
    const [approve, deposit] = provider.sent;
    expect(approve?.to).toBe(USDC);
    expect(approve && decode(approve.data)).toEqual({ functionName: "approve", args: [expect.stringMatching(new RegExp(VAULT, "i")), 1_000_000_000n] });
    expect(deposit?.to).toBe(VAULT);
    expect(deposit && decode(deposit.data)).toEqual({ functionName: "deposit", args: [1_000_000_000n] });
  });

  it("names the chain on every transaction, and puts a wallet that moved to another chain back before sending", async () => {
    const { provider, wallet: w } = wallet({ balance: 5_000_000_000n, allowance: 0n });
    const request = provider.request.bind(provider);
    provider.request = async (args) => {
      const answer = await request(args);
      // Another tab moves the wallet to chain 1 once the allowance has been read.
      if (args.method === "eth_call" && provider.calls.filter((c) => c.method === "eth_call").length === 2) provider.chainId = 1;
      return answer;
    };
    await w.deposit(fixedFromInt(1_000));
    const methods = provider.calls.map((c) => c.method);
    expect(methods.slice(methods.indexOf("eth_call") + 2, methods.indexOf("eth_sendTransaction"))).toEqual(["eth_getTransactionReceipt", "eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
    expect(provider.calls.filter((c) => c.method === "eth_sendTransaction").map((c) => (firstParam(c) as { chainId: string }).chainId)).toEqual(["0x7a69", "0x7a69"]);
  });

  it("says what each transaction waits for: the user's confirmation, then the chain", async () => {
    const { wallet: w } = wallet({ balance: 5_000_000_000n, allowance: 0n });
    const heard: string[] = [];
    await w.deposit(fixedFromInt(10), (waitingFor) => heard.push(waitingFor));
    expect(heard).toEqual([
      "Confirm in your wallet: approve the vault.", "Waiting for the transaction to approve the vault to be mined.",
      "Confirm in your wallet: deposit.", "Waiting for the transaction to deposit to be mined.",
    ]);
  });

  it("deposits without an approval when the allowance covers the amount", async () => {
    const { provider, wallet: w } = wallet({ balance: 5_000_000_000n, allowance: 1_000_000_000n });
    await w.deposit(fixedFromInt(1_000));
    expect(provider.sent.map((t) => decode(t.data).functionName)).toEqual(["deposit"]);
  });

  it("refuses an amount the wallet does not hold, or finer than a USDC base unit, before sending anything", async () => {
    const { provider, wallet: w } = wallet({ balance: 999_999_999n });
    await expect(w.deposit(fixedFromInt(1_000))).rejects.toThrow("less USDC");
    await expect(w.deposit(1n)).rejects.toThrow("whole number of USDC base units");
    await expect(wallet({}, { ...CHAIN, usdc: null }).wallet.deposit(fixedFromInt(10))).rejects.toThrow("names no USDC token");
    expect(provider.sent).toEqual([]);
  });

  it("sends nothing to a wallet that cannot return receipts, and says a sent transaction is unconfirmed when its receipt cannot be read", async () => {
    const noReceipts = wallet({ balance: 5_000_000_000n, allowance: 5_000_000_000n, fail: { eth_getTransactionReceipt: { code: -32601, message: "method not allowed" } } });
    await expect(noReceipts.wallet.deposit(fixedFromInt(10))).rejects.toThrow("Your wallet could not read transaction receipts, so the console did not ask it to deposit: method not allowed");
    expect(noReceipts.provider.sent).toEqual([]);
    const { provider, wallet: w } = wallet({ balance: 5_000_000_000n, allowance: 5_000_000_000n });
    const request = provider.request.bind(provider);
    provider.request = async (args) => {
      if (args.method === "eth_getTransactionReceipt" && provider.sent.length > 0) throw new Error("relay closed");
      return request(args);
    };
    await expect(w.deposit(fixedFromInt(10))).rejects.toThrow(/^The transaction to deposit was sent \(0x0+1\) but its receipt could not be read: relay closed\. Check it in your wallet before trying again\.$/);
  });

  it("polls a pending receipt, waiting between polls, until the transaction is mined", async () => {
    const provider = new StubProvider({ balance: 5_000_000_000n, allowance: 5_000_000_000n, pendingReceipts: 3 });
    const waits: number[] = [];
    const w = new ProviderWallet(ACCOUNT, "Test wallet", provider, CHAIN, { wait: async (ms) => void waits.push(ms) });
    await w.deposit(fixedFromInt(10));
    expect(waits).toEqual([1_000, 1_000, 1_000]);
    expect(provider.calls.filter((c) => c.method === "eth_getTransactionReceipt" && firstParam(c) !== `0x${"0".repeat(64)}`)).toHaveLength(4);
  });

  it("says a transaction is sent but not confirmed once it stays pending through every poll", async () => {
    const provider = new StubProvider({ balance: 5_000_000_000n, allowance: 5_000_000_000n, pendingReceipts: Number.POSITIVE_INFINITY });
    let waits = 0;
    const w = new ProviderWallet(ACCOUNT, "Test wallet", provider, CHAIN, { wait: async () => void (waits += 1) });
    await expect(w.deposit(fixedFromInt(10))).rejects.toThrow(/^The transaction to deposit was sent \(0x0+1\) but is not confirmed yet\. Check it in your wallet before trying again\.$/);
    expect(waits).toBe(180);
  });

  it("fails a deposit whose transaction reverts", async () => {
    const { wallet: w } = wallet({ balance: 5_000_000_000n, allowance: 5_000_000_000n, receiptStatus: "0x0" });
    await expect(w.deposit(fixedFromInt(10))).rejects.toThrow("The transaction to deposit failed on chain");
  });
});

describe("claims", () => {
  const signed: SignedWithdrawal = {
    account: ACCOUNT, amount: "10.5", nonce: 3, chain_id: vectors.chain_id, vault: VAULT, signature: `0x${"22".repeat(65)}`, approved_seq: 40,
    authorization: { signer: "0x5975c152fe58cdcb7e25586a3c9b994a16dbb615", signer_epoch: 1, issued_at: 1_000, expires_at: 87_400, checkpoint_seq: 64, checkpoint_root: `0x${"33".repeat(32)}`, siblings: [`0x${"44".repeat(32)}`] },
  };

  it("sends the vault's withdraw with the authorization, its proof and the node's signature", async () => {
    const { provider, wallet: w } = wallet();
    await w.claim(signed);
    const [claim] = provider.sent;
    expect(claim?.to).toBe(VAULT);
    expect(claim && decode(claim.data)).toEqual({
      functionName: "withdraw",
      args: [
        { account: expect.stringMatching(new RegExp(ACCOUNT, "i")), amount: 10_500_000n, nonce: 3n, approvedSeq: 40n, signerEpoch: 1n, issuedAt: 1_000n, expiresAt: 87_400n },
        64n, [`0x${"44".repeat(32)}`], `0x${"22".repeat(65)}`,
      ],
    });
  });

  it("refuses an authorization for another account or vault, or none", async () => {
    const { provider, wallet: w } = wallet();
    await expect(w.claim({ ...signed, account: USDC })).rejects.toThrow("another account or deployment");
    await expect(w.claim({ ...signed, vault: USDC })).rejects.toThrow("another account or deployment");
    await expect(w.claim({ ...signed, authorization: undefined })).rejects.toThrow("no authorization");
    expect(provider.sent).toEqual([]);
  });

  it("reads whether the vault has paid a payout nonce, only on the deployment's chain and without asking to switch", async () => {
    expect(await wallet({ paid: true }).wallet.claimed(3)).toBe(true);
    expect(await wallet({ paid: false }).wallet.claimed(3)).toBe(false);
    const elsewhere = wallet({ paid: true, chainId: 1 });
    await expect(elsewhere.wallet.claimed(3)).rejects.toThrow("your wallet is on chain 1, not chain 31337");
    expect(elsewhere.provider.calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });

  it("ends the connection it was given on disconnect, and does nothing without one", async () => {
    let ended = 0;
    const w = new ProviderWallet(ACCOUNT, "Test wallet", new StubProvider(), CHAIN, { wait: async () => {}, disconnect: async () => void (ended += 1) });
    await w.disconnect();
    expect(ended).toBe(1);
    await expect(wallet().wallet.disconnect()).resolves.toBeUndefined();
  });
});

describe("suggesting the vault's USDC", () => {
  it("asks the wallet to watch the token with the asset object as the param, on the deployment's chain, and resolves true when added", async () => {
    const { provider, wallet: w } = wallet({ chainId: 1 });
    await expect(w.suggestUsdc()).resolves.toBe(true);
    const watchAt = provider.calls.findIndex((c) => c.method === "wallet_watchAsset");
    const movedAt = provider.calls.findIndex((c) => c.method === "wallet_switchEthereumChain");
    // The wallet is put on the deployment's chain before the import is offered.
    expect(provider.chainId).toBe(31337);
    expect(movedAt).toBeGreaterThanOrEqual(0);
    expect(watchAt).toBeGreaterThan(movedAt);
    expect(provider.calls[watchAt]?.params).toEqual({ type: "ERC20", options: { address: USDC, symbol: "USDC", decimals: 6 } });
  });

  it("resolves false when the wallet answers that it did not add the token", async () => {
    const { provider, wallet: w } = wallet({ chainId: 1, watchAsset: false });
    await expect(w.suggestUsdc()).resolves.toBe(false);
    expect(provider.calls.some((c) => c.method === "wallet_watchAsset")).toBe(true);
  });

  it("resolves false without asking when the build names no USDC, and when the wallet refuses or cannot watch assets", async () => {
    const noToken = wallet({}, { ...CHAIN, usdc: null });
    await expect(noToken.wallet.suggestUsdc()).resolves.toBe(false);
    expect(noToken.provider.calls).toEqual([]);
    const declined = wallet({ fail: { wallet_watchAsset: { code: 4001, message: "User rejected" } } });
    await expect(declined.wallet.suggestUsdc()).resolves.toBe(false);
    const unsupported = wallet({ fail: { wallet_watchAsset: { code: -32601, message: "the method wallet_watchAsset does not exist" } } });
    await expect(unsupported.wallet.suggestUsdc()).resolves.toBe(false);
  });

  it("refuses an array-wrapped watchAsset param, so the request shape cannot regress", async () => {
    const { provider } = wallet({ chainId: 1 });
    await expect(provider.request({ method: "wallet_watchAsset", params: [{ type: "ERC20", options: {} }] })).rejects.toThrow("asset object");
  });
});

describe("InjectedConnector", () => {
  it("connects the page's provider on its first account, lowercased, and puts it on the chain", async () => {
    const provider = new StubProvider({ chainId: 1 });
    const connected = await new InjectedConnector(() => provider, CHAIN, { wait: async () => {} }).connect();
    expect(connected.address).toBe(ACCOUNT);
    expect(provider.chainId).toBe(31337);
  });

  it("says how to get a wallet when the page has none, and fails when the wallet shares no account", async () => {
    await expect(new InjectedConnector(() => undefined, CHAIN, { wait: async () => {} }).connect()).rejects.toThrow("No browser wallet was found");
    const declining = new StubProvider({ fail: { eth_requestAccounts: { code: 4001, message: "User rejected" } } });
    await expect(new InjectedConnector(() => declining, CHAIN, { wait: async () => {} }).connect()).rejects.toThrow("did not share an account");
  });
});

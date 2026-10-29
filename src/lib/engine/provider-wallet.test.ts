/** Tests for the wallet over an EIP-1193 provider: chain, signatures against the engine's vectors, deposits and claims. */

import { decodeFunctionData, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { fixedFromInt } from "../fixed";
import vectors from "./eip712-vectors.json";
import { orderTypedData, requestDomain } from "./eip712";
import { InjectedConnector } from "./injected";
import { normaliseSignature, ProviderWallet, type WalletChain } from "./provider-wallet";
import type { OrderRequest, SignedWithdrawal } from "./types";
import { ACCOUNT, StubProvider, type StubOptions } from "./wallet-kit";

const VAULT = vectors.vault;
const USDC = "0x00000000000000000000000000000000000000cc";
const CHAIN: WalletChain = { chainId: vectors.chain_id, vault: VAULT, usdc: USDC, add: { name: "Anvil", rpcUrl: "http://127.0.0.1:8545/" } };
const ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit(uint256 amount) returns (uint256)",
  "struct Withdrawal { address account; uint256 amount; uint64 nonce; uint64 approvedSeq; uint64 signerEpoch; uint64 issuedAt; uint64 expiresAt; }",
  "function withdraw(Withdrawal withdrawal, uint64 checkpointSeq, bytes32[] siblings, bytes signature)",
]);

function wallet(options: StubOptions = {}, chain: WalletChain = CHAIN) {
  const provider = new StubProvider(options);
  return { provider, wallet: new ProviderWallet(ACCOUNT, "Test wallet", provider, chain, { wait: async () => {} }) };
}

const order = vectors.requests[0];
if (!order) throw new Error("no order vector");
const typed = orderTypedData(requestDomain(vectors.chain_id, VAULT), order.body as unknown as OrderRequest, { nonce: order.nonce, expiresAt: order.expires_at });
const decode = (data: Hex) => decodeFunctionData({ abi: ABI, data });

describe("signing", () => {
  it("signs through eth_signTypedData_v4 to exactly the engine's vector signature", async () => {
    const { provider, wallet: w } = wallet();
    expect(await w.sign({ summary: "buy", typed })).toBe(order.signature);
    expect(provider.calls.find((c) => c.method === "eth_signTypedData_v4")?.params[0]).toBe(ACCOUNT);
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
    expect(provider.calls.find((c) => c.method === "wallet_addEthereumChain")?.params[0]).toMatchObject({ chainId: "0x7a69", rpcUrls: ["http://127.0.0.1:8545/"] });
    await expect(wallet(unknown, { ...CHAIN, add: null }).wallet.ensureChain()).rejects.toThrow("could not switch to chain 31337");
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

  it("reads whether the vault has paid a payout nonce", async () => {
    expect(await wallet({ paid: true }).wallet.claimed(3)).toBe(true);
    expect(await wallet({ paid: false }).wallet.claimed(3)).toBe(false);
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

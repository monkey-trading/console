/** Tests only: a stub EIP-1193 provider whose account is a fixed key, as a browser wallet answers the console. */

import { decodeFunctionData, encodeAbiParameters, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Eip1193Provider } from "./provider-wallet";

/** Anvil's public account 0, the key the engine's EIP-712 vectors sign with. */
export const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const ACCOUNT = privateKeyToAccount(KEY).address.toLowerCase();

const NUMERIC = /^u?int\d*$/;

/** Typed data as `eth_signTypedData_v4` carries it (integers as text), with its integers as bigints again for signing. */
function parseTyped(text: string): Parameters<ReturnType<typeof privateKeyToAccount>["signTypedData"]>[0] {
  const typed = JSON.parse(text) as { types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown>; domain: Record<string, unknown> };
  const fields = typed.types[typed.primaryType] ?? [];
  const message = Object.fromEntries(Object.entries(typed.message).map(([key, value]) => {
    const type = fields.find((f) => f.name === key)?.type ?? "";
    return [key, NUMERIC.test(type) ? BigInt(value as string | number) : value];
  }));
  // The JSON is viem's own serialization of a typed request, so its shape is viem's.
  return { ...typed, message } as unknown as Parameters<ReturnType<typeof privateKeyToAccount>["signTypedData"]>[0];
}

const ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function usedNonces(address, uint64) view returns (bool)",
]);

export interface StubOptions {
  chainId?: number;
  /** The key that signs; another than the connected account's makes the wallet sign for someone else. */
  key?: Hex;
  balance?: bigint;
  allowance?: bigint;
  paid?: boolean;
  /** Each receipt's status, `0x1` by default. */
  receiptStatus?: string;
  /** Answers a method with an error, such as `{ code: 4001 }` for a declined request. */
  fail?: Partial<Record<string, { code: number; message: string }>>;
}

/** A provider over a fixed key: it records each request, signs typed data, and mines every transaction at once. */
export class StubProvider implements Eip1193Provider {
  readonly calls: { method: string; params: readonly unknown[] }[] = [];
  chainId: number;

  constructor(private readonly options: StubOptions = {}) {
    this.chainId = options.chainId ?? 31337;
  }

  /** The transactions sent, in order. */
  get sent(): { to: string; data: Hex }[] {
    return this.calls.filter((c) => c.method === "eth_sendTransaction").map((c) => c.params[0] as { to: string; data: Hex });
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push({ method, params });
    const failure = this.options.fail?.[method];
    if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
    switch (method) {
      case "eth_requestAccounts": return [privateKeyToAccount(KEY).address];
      case "eth_chainId": return `0x${this.chainId.toString(16)}`;
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        this.chainId = Number((params[0] as { chainId: string }).chainId);
        return null;
      case "eth_signTypedData_v4": return privateKeyToAccount(this.options.key ?? KEY).signTypedData(parseTyped(String(params[1])));
      case "eth_sendTransaction": return `0x${String(this.sent.length).padStart(64, "0")}`;
      case "eth_getTransactionReceipt": return { status: this.options.receiptStatus ?? "0x1" };
      case "eth_call": return this.call((params[0] as { data: Hex }).data);
      default: throw new Error(`stub provider has no ${method}`);
    }
  }

  private call(data: Hex): Hex {
    const { functionName } = decodeFunctionData({ abi: ABI, data });
    if (functionName === "usedNonces") return encodeAbiParameters([{ type: "bool" }], [this.options.paid ?? false]);
    return encodeAbiParameters([{ type: "uint256" }], [functionName === "balanceOf" ? (this.options.balance ?? 0n) : (this.options.allowance ?? 0n)]);
  }
}

/** Tests only: a stub EIP-1193 provider whose account is a fixed key, as a browser wallet answers the console. */

import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Eip1193Provider } from "./provider-wallet";
import type { KeyStorage } from "./session-key-store";

/** Anvil's public account 0, the key the engine's EIP-712 vectors sign with. */
export const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const ACCOUNT = privateKeyToAccount(KEY).address.toLowerCase();

/** A browser storage in a map, with the map to look at; two stores given one share it as two tabs do. */
export function memoryStorage(): KeyStorage & { held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    keys: () => [...held.keys()],
  };
}

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
  "function emissionsClaimed(address) view returns (uint256)",
  "function latestSeq() view returns (uint64)",
]);

const DEPOSITED = parseAbi(["event Deposited(uint256 indexed id, address indexed account, address indexed from, uint256 amount)"]);

export interface StubOptions {
  chainId?: number;
  /** The key that signs; another than the connected account's makes the wallet sign for someone else. */
  key?: Hex;
  balance?: bigint;
  allowance?: bigint;
  paid?: boolean;
  /** What the vault has minted to the account against its MONKEY entitlement. */
  emissionsClaimed?: bigint;
  /** The vault's latest posted checkpoint seq. */
  latestSeq?: number;
  /** Each receipt's status, `0x1` by default. */
  receiptStatus?: string;
  /** How many times a sent transaction's receipt is not there yet (null) before it is mined. */
  pendingReceipts?: number;
  /** Answers a method with an error, such as `{ code: 4001 }` for a declined request. */
  fail?: Partial<Record<string, { code: number; message: string }>>;
  /** The vault's `Deposited` events, which `eth_getLogs` answers by the account topic, with the chain's latest block. */
  deposits?: { id: bigint; account: string; from: string; amount: bigint }[];
  blockNumber?: bigint;
  /** What `wallet_watchAsset` resolves; true by default. */
  watchAsset?: boolean;
}

/** A provider over a fixed key: it records each request, signs typed data, and mines every transaction at once. */
export class StubProvider implements Eip1193Provider {
  readonly calls: { method: string; params: readonly unknown[] | { type: string; options: Record<string, unknown> } }[] = [];
  chainId: number;
  private receiptPolls = 0;
  /** The vault's MONKEY record, read on each call; a test may move it between reads. */
  readonly vault: { claimed: bigint; latestSeq: number };

  constructor(readonly options: StubOptions = {}) {
    this.chainId = options.chainId ?? 31337;
    this.vault = { claimed: options.emissionsClaimed ?? 0n, latestSeq: options.latestSeq ?? 0 };
  }

  /** The transactions sent, in order. */
  get sent(): { to: string; data: Hex }[] {
    return this.calls.flatMap((c) => {
      if (c.method !== "eth_sendTransaction" || !Array.isArray(c.params)) return [];
      return [c.params[0] as { to: string; data: Hex }];
    });
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] | { type: string; options: Record<string, unknown> } }): Promise<unknown> {
    this.calls.push({ method, params });
    const list: readonly unknown[] = Array.isArray(params) ? params : [];
    const failure = this.options.fail?.[method];
    if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
    switch (method) {
      case "eth_requestAccounts": return [privateKeyToAccount(KEY).address];
      case "eth_chainId": return `0x${this.chainId.toString(16)}`;
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        this.chainId = Number((list[0] as { chainId: string }).chainId);
        return null;
      case "eth_signTypedData_v4": return privateKeyToAccount(this.options.key ?? KEY).signTypedData(parseTyped(String(list[1])));
      case "eth_sendTransaction": return `0x${String(this.sent.length).padStart(64, "0")}`;
      case "eth_getTransactionReceipt": {
        // The zero hash is the wallet's check that it can read receipts at all.
        const pending = String(list[0]) !== `0x${"0".repeat(64)}` && this.receiptPolls++ < (this.options.pendingReceipts ?? 0);
        return pending ? null : { status: this.options.receiptStatus ?? "0x1" };
      }
      case "eth_blockNumber": return `0x${(this.options.blockNumber ?? 1_000_000n).toString(16)}`;
      case "eth_getLogs": return this.logs((list[0] as { topics: (string | null)[] }).topics[2]);
      case "eth_call": return this.call((list[0] as { data: Hex }).data);
      case "wallet_watchAsset": {
        // The request contract is the asset object itself; an array-wrapped param is refused.
        if (typeof params !== "object" || params === null || Array.isArray(params)) throw new Error("wallet_watchAsset takes the asset object as its param");
        return this.options.watchAsset ?? true;
      }
      default: throw new Error(`stub provider has no ${method}`);
    }
  }

  /** The `Deposited` logs whose indexed account is `accountTopic`. */
  private logs(accountTopic: string | null | undefined) {
    return (this.options.deposits ?? []).flatMap((d) => {
      const topics = encodeEventTopics({ abi: DEPOSITED, eventName: "Deposited", args: { id: d.id, account: d.account as Hex, from: d.from as Hex } });
      return String(topics[2]).toLowerCase() === String(accountTopic).toLowerCase() ? [{ topics, data: encodeAbiParameters([{ type: "uint256" }], [d.amount]) }] : [];
    });
  }

  private call(data: Hex): Hex {
    const { functionName } = decodeFunctionData({ abi: ABI, data });
    if (functionName === "usedNonces") return encodeAbiParameters([{ type: "bool" }], [this.options.paid ?? false]);
    if (functionName === "latestSeq") return encodeAbiParameters([{ type: "uint64" }], [BigInt(this.vault.latestSeq)]);
    if (functionName === "emissionsClaimed") return encodeAbiParameters([{ type: "uint256" }], [this.vault.claimed]);
    return encodeAbiParameters([{ type: "uint256" }], [functionName === "balanceOf" ? (this.options.balance ?? 0n) : (this.options.allowance ?? 0n)]);
  }
}

/** A stub provider that also sends EIP-1193's events, as a browser wallet does when its user switches account or chain. */
export class EventfulProvider extends StubProvider {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, listener: (payload: unknown) => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? new Set()).add(listener));
  }

  removeListener(event: string, listener: (payload: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** How many listeners `event` has, so a test can see a follow stop. */
  heard(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Sends `event` to its listeners as the wallet would; a switch also changes what the wallet answers for its chain. */
  emit(event: string, payload: unknown): void {
    if (event === "chainChanged") this.chainId = Number(payload);
    [...(this.listeners.get(event) ?? [])].forEach((listener) => listener(payload));
  }
}

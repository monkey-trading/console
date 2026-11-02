/**
 * The engine's EIP-712 client requests as typed data for `eth_signTypedData_v4`, field for field as
 * `crates/core/src/eip712.rs` defines them (and `ReissueRequest` as `crates/node/src/api/reissue.rs`
 * does): amounts and prices are `int128` in `Fixed`'s raw units, `expiresAt` is Unix milliseconds,
 * and sides and order kinds are their JSON names. `CancelAllRequest` and `CloseAllRequest` (with its
 * `CloseEntry`) are the V44 batch forms.
 */

import { fixedFromWire } from "../fixed";
import type { Address, CancelAllRequest, CancelRequest, CloseAllRequest, EligibilityClass, OrderRequest } from "./types";

export const DOMAIN_NAME = "monkeytrading";
export const DOMAIN_VERSION = "1";

/** The statement each eligibility class signs, as `EligibilityClass::statement` defines it. */
export const STATEMENTS: Record<EligibilityClass, string> = {
  professional: "I attest that I am a professional client.",
  eligible_client: "I attest that I am an eligible client.",
};

const TYPES = {
  OrderRequest: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "clientId", type: "uint64" },
    { name: "market", type: "uint32" },
    { name: "side", type: "string" },
    { name: "qty", type: "int128" },
    { name: "kind", type: "string" },
    { name: "price", type: "int128" },
    { name: "hasMaxSlippage", type: "bool" },
    { name: "maxSlippageBps", type: "int64" },
    { name: "reduceOnly", type: "bool" },
  ],
  CancelRequest: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "orderId", type: "uint64" },
  ],
  CancelAllRequest: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
  ],
  CloseAllRequest: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "closes", type: "CloseEntry[]" },
    { name: "hasMaxSlippage", type: "bool" },
    { name: "maxSlippageBps", type: "int64" },
  ],
  CloseEntry: [
    { name: "market", type: "uint32" },
    { name: "quoted", type: "int128" },
  ],
  WithdrawalRequest: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "amount", type: "int128" },
  ],
  EligibilityRequest: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "statement", type: "string" },
  ],
  RegisterSessionKey: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "sessionKey", type: "address" },
    { name: "sessionExpiresAt", type: "int64" },
  ],
  RevokeSessionKey: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "expiresAt", type: "int64" },
    { name: "sessionKey", type: "address" },
  ],
  ReissueRequest: [
    { name: "account", type: "address" },
    { name: "payoutNonce", type: "uint64" },
    { name: "replacesExpiresAt", type: "uint64" },
  ],
} as const;

/** A request's primary type; `CloseEntry` is only ever nested in `CloseAllRequest`. */
export type RequestType = Exclude<keyof typeof TYPES, "CloseEntry">;

/** The deployment a signature is bound to: the custody chain and vault. */
export interface RequestDomain {
  name: typeof DOMAIN_NAME;
  version: typeof DOMAIN_VERSION;
  chainId: number;
  verifyingContract: `0x${string}`;
}

/** One request as typed data, ready for `eth_signTypedData_v4`: `types` holds the primary type's fields and any struct it nests. */
export interface TypedRequest {
  domain: RequestDomain;
  types: { readonly [name: string]: readonly { readonly name: string; readonly type: string }[] };
  primaryType: RequestType;
  message: Record<string, string | number | bigint | boolean | readonly { market: number; quoted: bigint }[]>;
}

/** A signature's nonce and expiry. */
export interface Terms {
  nonce: number;
  /** Unix milliseconds. */
  expiresAt: number;
}

/**
 * The domain every request on vault `vault` of chain `chainId` is signed under.
 * Error cases:
 * - `vault` is not a 20-byte `0x` address
 */
export function requestDomain(chainId: number, vault: string): RequestDomain {
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract: hexAddress(vault) };
}

function hexAddress(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`not a 20-byte 0x address: ${value}`);
  // The pattern above holds, so the text is `0x` hex.
  return value.toLowerCase() as `0x${string}`;
}

function typed(domain: RequestDomain, primaryType: RequestType, message: TypedRequest["message"]): TypedRequest {
  // A struct that nests another lists it beside the primary type, as the engine's fixtures do.
  const types: TypedRequest["types"] = primaryType === "CloseAllRequest" ? { [primaryType]: TYPES[primaryType], CloseEntry: TYPES.CloseEntry } : { [primaryType]: TYPES[primaryType] };
  return { domain, types, primaryType, message };
}

/** `order_hash`'s struct: a market order signs its quoted price, a limit or stop order its trigger price. */
export function orderTypedData(domain: RequestDomain, order: Omit<OrderRequest, "auth">, terms: Terms): TypedRequest {
  const { kind } = order;
  const price = kind.kind === "market" ? kind.quoted : kind.price;
  const slippage = kind.kind === "market" ? kind.max_slippage_bps : undefined;
  return typed(domain, "OrderRequest", {
    account: hexAddress(order.account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt), clientId: BigInt(order.client_id),
    market: order.market, side: order.side, qty: fixedFromWire(order.qty), kind: kind.kind, price: fixedFromWire(price),
    hasMaxSlippage: slippage !== undefined, maxSlippageBps: BigInt(slippage ?? 0), reduceOnly: order.reduce_only ?? false,
  });
}

/** `cancel_hash`'s struct. */
export function cancelTypedData(domain: RequestDomain, cancel: Omit<CancelRequest, "auth">, terms: Terms): TypedRequest {
  return typed(domain, "CancelRequest", { account: hexAddress(cancel.account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt), orderId: BigInt(cancel.order_id) });
}

/** `cancel_all_hash`'s struct. */
export function cancelAllTypedData(domain: RequestDomain, cancel: Omit<CancelAllRequest, "auth">, terms: Terms): TypedRequest {
  return typed(domain, "CancelAllRequest", { account: hexAddress(cancel.account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt) });
}

/**
 * `close_all_hash`'s struct: the entries are signed in the order given, each `quoted` as its raw
 * `Fixed` (the wire decimal times 10^9, so `"3000"` signs as 3000000000000); an omitted bound signs
 * `hasMaxSlippage` false and 0.
 */
export function closeAllTypedData(domain: RequestDomain, close: Omit<CloseAllRequest, "auth">, terms: Terms): TypedRequest {
  const bound = close.max_slippage_bps;
  return typed(domain, "CloseAllRequest", {
    account: hexAddress(close.account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt),
    closes: close.closes.map((entry) => ({ market: entry.market, quoted: fixedFromWire(entry.quoted) })),
    hasMaxSlippage: bound !== undefined, maxSlippageBps: BigInt(bound ?? 0),
  });
}

/** `withdrawal_hash`'s struct; `amount` is a wire decimal. */
export function withdrawalTypedData(domain: RequestDomain, account: Address, amount: string, terms: Terms): TypedRequest {
  return typed(domain, "WithdrawalRequest", { account: hexAddress(account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt), amount: fixedFromWire(amount) });
}

/** `eligibility_hash`'s struct: the declaration signs the class's exact statement. */
export function eligibilityTypedData(domain: RequestDomain, account: Address, cls: EligibilityClass, terms: Terms): TypedRequest {
  return typed(domain, "EligibilityRequest", { account: hexAddress(account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt), statement: STATEMENTS[cls] });
}

/** `session_key_registration_hash`'s struct: the account authorizes `sessionKey` to trade until `sessionExpiresAt`. */
export function registerSessionKeyTypedData(domain: RequestDomain, account: Address, sessionKey: Address, sessionExpiresAt: number, terms: Terms): TypedRequest {
  return typed(domain, "RegisterSessionKey", { account: hexAddress(account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt), sessionKey: hexAddress(sessionKey), sessionExpiresAt: BigInt(sessionExpiresAt) });
}

/** `session_key_revocation_hash`'s struct. */
export function revokeSessionKeyTypedData(domain: RequestDomain, account: Address, sessionKey: Address, terms: Terms): TypedRequest {
  return typed(domain, "RevokeSessionKey", { account: hexAddress(account), nonce: BigInt(terms.nonce), expiresAt: BigInt(terms.expiresAt), sessionKey: hexAddress(sessionKey) });
}

/**
 * `reissue_hash`'s struct: a fresh authorization for payout `payoutNonce`, replacing the one that
 * expires at `replacesExpiresAt` (Unix seconds; 0 when none was signed).
 */
export function reissueTypedData(domain: RequestDomain, account: Address, payoutNonce: number, replacesExpiresAt: number): TypedRequest {
  return typed(domain, "ReissueRequest", { account: hexAddress(account), payoutNonce: BigInt(payoutNonce), replacesExpiresAt: BigInt(replacesExpiresAt) });
}
